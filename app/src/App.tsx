import { measurementFrom, exportDocument, downloadJson, type Measurement } from './measurementLog';
import L from 'leaflet';
import { OverviewPane, type OverviewHandle } from './OverviewPane';
import { routeBounds, followSelection } from './rangeSelect';
import { DustForecastStrip } from './DustForecastStrip';
import { PlanPanels, DataPanel } from './PlanPanels';
import { FieldPanels } from './FieldPanels';
import { fmtKm, fmtDur, fmtLatLon } from './panelFormat';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildTracBack,
  countUnsent,
  deviationFromRoute,
  dustForecast,
  elevAt,
  explainRoute,
  flushUnsent,
  haversine,
  idx,
  lastFixIndex,
  latLonToCell,
  nearestBreadcrumb,
  OFF_ROUTE_M,
  planRoute,
  returnLimit,
  riskAt,
  RISK_BANDS,
  slopeClass,
  trackStats,
  type LatLon,
  type Route,
  type RoutePreset,
  type TrackPoint,
} from '@core';
import { MapController, ROUTE_COLOR, SLOPE_COLOR, type LayerKey, type Site } from './mapController';
import { densify, stamp } from './sim';
import { clearSession, loadSession, saveSession } from './store';
import { renderRiskHeat } from './heatmap';
import { loadWorld, type World } from './world';
import { RiskHelp } from './RiskHelp';
import { dustWarning } from './DustPanel';
import type { BaseMapMode } from './baseMap';
import { snapTarget, useTargetEditing } from './targetEditing';
import { destinationInfo } from './navigation';
import { DestinationStatus } from './DestinationStatus';
import { usePositionFeed } from './position/usePositionFeed';
import { PositionControls } from './position/PositionControls';
import { HudView } from './HudView';
import { useFieldDevices } from './useFieldDevices';
import { fieldPosition, fieldWarning, type HudState } from './fieldState';
import { simulateHealth } from './health';
import { useBaseDeviceChannel } from './deviceChannel';
import { DeviceLinks } from './DeviceView';

type Mode = 'plan' | 'traverse' | 'lost' | 'tracback';
type ViewScope = 'plan' | 'field';


const PRESETS: RoutePreset[] = ['safe', 'short'];
const SLOPE_NAME = ['安全', '注意', '制限', '通行不可'];
const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'heat', label: '周辺の危険度' },
  { key: 'contours', label: '等高線' },
  { key: 'hazard', label: '斜面リスク' },
  { key: 'slope', label: '傾斜の詳細' },
  { key: 'hillshade', label: '陰影' },
];
const O2_START_MIN = 420; // シミュレーション値
const BATTERY_START_MIN = 540; // シミュレーション値
const WALK_FLAT = 0.38; // 平地での歩く速さ（m/s）




export function App() {
  const devices = useFieldDevices();
  const [world, setWorld] = useState<World | null>(null);
  const [baseOverride, setBaseOverride] = useState<Site | null>(null);
  const base = baseOverride ?? world?.base ?? null;
  const fieldWorld = useMemo(() => world && base ? { ...world, base } : null, [world, base]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('plan');
  const [baseMapMode, setBaseMapMode] = useState<BaseMapMode>('mono');
  const [layers, setLayers] = useState<Record<Exclude<LayerKey, 'heat'>, boolean>>({ contours: true, hazard: true, slope: false, hillshade: false });
  const [heatOn, setHeatOn] = useState<Record<ViewScope, boolean>>({ plan: false, field: true });
  const [riskHelpOpen, setRiskHelpOpen] = useState(false);
  const [overviewVisible, setOverviewVisible] = useState(true);
  const [miniOpen, setMiniOpen] = useState<Record<ViewScope, boolean>>(() => ({
    plan: false,
    field: !window.matchMedia('(max-width: 900px)').matches,
  }));
  const scope: ViewScope = mode === 'plan' ? 'plan' : 'field';
  const heatVisible = heatOn[scope];
  const miniCollapsed = !miniOpen[scope];
  const forecast = useMemo(() => world ? dustForecast({
    seed: 2,
    center: { lat: (world.region.north + world.region.south) / 2, lon: (world.region.west + world.region.east) / 2 },
  }) : null, [world]);
  const [targets, setTargets] = useState<Site[]>([]);
  const [targetId, setTargetId] = useState<string>('T1');
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [preset, setPreset] = useState<RoutePreset>('safe');
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const measurements = useRef<Measurement[]>([]);
  const measuredPoints = useRef(0);
  const [measurementCount, setMeasurementCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);
  const [forcedOffline, setForcedOffline] = useState(false);
  const [backIdx, setBackIdx] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [temp, setTemp] = useState<(LatLon & { source: 'operation' | 'overview' }) | null>(null);
  const [restored, setRestored] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const targetEditing = useTargetEditing(world, mode === 'plan', setTargets, setTargetId, setNotice);

  const mapEl = useRef<HTMLDivElement>(null);
  const overview = useRef<OverviewHandle | null>(null);
  const [selection, setSelection] = useState<L.LatLngBounds | null>(null);
  const coordEl = useRef<HTMLSpanElement>(null);
  const ctl = useRef<MapController | null>(null);
  const heatCenter = useRef<LatLon | null>(null);
  const heatRadius = useRef(400);
  const backPath = useRef<LatLon[]>([]);
  const startMs = useRef(Date.now());
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    loadWorld()
      .then((w) => {
        setWorld(w);
        setTargets(w.targets);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  // ---- 端末に保存した前回の記録を復元する ----
  useEffect(() => {
    if (!world) return;
    loadSession().then((s) => {
      if (!s) return;
      startMs.current = s.startMs;
      const restoredTargets = s.targets ?? world.targets;
      setTargets(restoredTargets);
      setBaseOverride(s.base ?? null);
      setTargetId(restoredTargets.some((t) => t.id === s.targetId) ? s.targetId : world.targets[0].id);
      setPreset(s.preset === 'science' ? 'safe' : s.preset);
      setForcedOffline(s.forcedOffline);
      lastSaved.current = s.track;
      setSaveState('saved');
      setTrack(s.track);
      setPlaying(false);
      setRestored(true);
      setMode('traverse');
      setNotice(`前回の記録を復元しました（${s.track.length} 点、${new Date(s.savedAt).toLocaleString('ja-JP')} に保存）。`);
    });
  }, [world]);

  // ---- 記録を端末へ保存する。変わり続けていても、最大 1 秒ごとに保存する（待つだけのタイマーだと、再生中はずっと保存されない）----
  const latest = useRef({ track, targetId, preset, forcedOffline, base: base ?? undefined, targets });
  latest.current = { track, targetId, preset, forcedOffline, base: base ?? undefined, targets };
  const lastSaved = useRef<TrackPoint[] | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const cur = latest.current;
      if (cur.track.length === 0 || lastSaved.current === cur.track) return;
      lastSaved.current = cur.track;
      saveSession({ ...cur, startMs: startMs.current }).then((ok) => setSaveState(ok ? 'saved' : 'failed'));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // ---- 地図の作成 ----
  useEffect(() => {
    if (!world || !mapEl.current) return;
    const c = new MapController(
      mapEl.current,
      world.region,
      world.contours,
      world.hazards,
      (lat, lon) => setTemp({ lat, lon, source: 'operation' }),
      (lat, lon) => {
        if (!coordEl.current) return;
        const point = { lat, lon };
        let text = fmtLatLon(point);
        const cell = latLonToCell(world.grid, point);
        const z = elevAt(world.grid, point);
        if (cell && z !== null && Number.isFinite(z)) {
          text += `｜標高 ${Math.round(z).toLocaleString()} m`;
          const slope = world.slope[idx(world.grid, cell.c, cell.r)];
          if (Number.isFinite(slope)) text += `｜傾斜 ${slope.toFixed(0)}°`;
        }
        coordEl.current.textContent = text;
      },
      (bounds) => overview.current?.setViewport(bounds),
      { zoomSnap: 0, zoomDelta: 0.5 },
    );
    ctl.current = c;
    const observer = new ResizeObserver(() => c.resize());
    observer.observe(mapEl.current);
    return () => {
      observer.disconnect();
      c.destroy();
      ctl.current = null;
    };
  }, [world]);

  // ---- 01 ルートの計画 ----
  const target = targets.find((t) => t.id === targetId) ?? null;
  useEffect(() => {
    if (!world || !base || !target) return;
    setRoutes(null);
    const id = window.setTimeout(() => {
      const s = latLonToCell(world.grid, base);
      const g = latLonToCell(world.grid, target);
      if (!s || !g) return setRoutes([]);
      const found = PRESETS.map((p) => planRoute(world.grid, world.slope, world.aspect, s, g, p, {
        slopeMaxDeg: world.region.slope_max_deg,
        limitedMinDeg: world.region.slope_limited_deg,
      })).filter((r): r is Route => r !== null);
      const ref = found.find((r) => r.preset === 'short');
      for (const r of found) r.explanation = explainRoute(r, ref);
      setRoutes(found);
    }, 30);
    return () => window.clearTimeout(id);
  }, [world, base, target]);

  const route = routes?.find((r) => r.preset === preset) ?? routes?.[0] ?? null;

  // ---- 02 足あとの記録（シミュレーションの再生）----
  const online = !forcedOffline;
  const positionFeed = usePositionFeed({ world: fieldWorld, mode, playing, speed, online, setTrack, setPlaying });
  const POINTS_PER_SEC = 6;

  // 通信が戻ったら、たまった記録を古い順に送る
  const unsent = useMemo(() => countUnsent(track), [track]);
  useEffect(() => {
    if (!online || unsent === 0) return;
    const id = window.setInterval(() => setTrack((t) => flushUnsent(t, 4)), 90);
    return () => window.clearInterval(id);
  }, [online, unsent === 0]);

  const stats = useMemo(() => trackStats(track), [track]);
  const pos = track.length ? track[track.length - 1] : null;
  const deviation = useMemo(() => (pos && route ? deviationFromRoute(pos, route.coords) : 0), [pos, route]);
  const offRoute = deviation > OFF_ROUTE_M;
  const simEnded = mode === 'traverse' && (positionFeed.ended || restored);

  // ---- 03 とんぼ返り ----
  const lost = useMemo(() => {
    if (!world || !route || !pos || (mode !== 'lost' && mode !== 'tracback')) return null;
    // 予定ルートの近く（30 m 以内）にいた最後の点までを「信頼できる足あと」とする
    let onRoute = 0;
    for (let i = 0; i < track.length; i++) if (deviationFromRoute(track[i], route.coords) <= OFF_ROUTE_M) onRoute = i;
    const nb = nearestBreadcrumb(pos, track.slice(0, onRoute + 1));
    if (!nb) return null;
    const plan = buildTracBack(track, nb.index, world.landmarks);
    const fix = lastFixIndex(track);
    const near = world.landmarks
      .map((l) => ({ l, d: haversine(pos, l) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    return { nb, plan, fix: fix >= 0 ? track[fix] : null, near, approach_s: nb.distance_m / WALK_FLAT };
  }, [world, route, mode, track.length]);

  const backStep_m = 12;
  const backElapsed = mode === 'tracback' ? (backIdx * backStep_m) / WALK_FLAT : 0;
  const elapsedMin = (stats.elapsed_s + backElapsed) / 60;
  const o2 = Math.max(0, O2_START_MIN - elapsedMin);
  const battery = Math.max(0, BATTERY_START_MIN - elapsedMin);
  const limit = lost ? returnLimit(Math.max(0, lost.plan.est_time_s + lost.approach_s - backElapsed), o2, battery) : null;
  const health = useMemo(() => simulateHealth(track, stats.elapsed_s + backElapsed, o2, battery / BATTERY_START_MIN * 100, limit?.level), [track, stats.elapsed_s, backElapsed, o2, battery, limit?.level]);

  useEffect(() => {
    if (!track.length) {
      measurements.current = [];
      measuredPoints.current = 0;
      setMeasurementCount(0);
      return;
    }
    // Persisted tracks have no historical communication/health samples. Do not invent them.
    if (restored) { measuredPoints.current = track.length; return; }
    if (!base) return;
    for (let i = measuredPoints.current; i < track.length; i++) {
      const point = track[i];
      const source = positionFeed.kind === 'simulation' ? 'simulation' : point.src === 'fix' ? 'satellite' : 'dead_reckoning';
      measurements.current.push(measurementFrom(point, base, online, health, source));
    }
    measuredPoints.current = track.length;
    setMeasurementCount(measurements.current.length);
  }, [track, base, online, health, restored, positionFeed.kind]);

  useEffect(() => {
    if (mode !== 'tracback') return;
    const t0 = performance.now();
    let base = -1;
    const id = window.setInterval(() => {
      setBackIdx((i) => {
        if (base < 0) base = i;
        const last = backPath.current.length - 1;
        const want = Math.min(last, base + Math.floor(((performance.now() - t0) / 1000) * POINTS_PER_SEC * 1.5 * speed));
        if (want >= last) {
          window.clearInterval(id);
          setMode('plan');
          setForcedOffline(false);
          setNotice('基地に戻りました。たまっていた記録を送信しています。');
        }
        return want;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [mode, speed]);

  const backPos = mode === 'tracback' ? backPath.current[Math.min(backIdx, backPath.current.length - 1)] ?? null : null;
  const backProgress = backPath.current.length > 1 ? backIdx / (backPath.current.length - 1) : 0;
  const field = fieldPosition(pos, backPos, backPath.current, backIdx, backProgress);
  const destination = useMemo(() => destinationInfo(mode === 'plan' ? base : backPos ?? pos, target, route?.coords ?? null, mode === 'plan'), [mode, base, backPos, pos, target, route]);
  const nextManeuver = useMemo(() => {
    if (!lost || mode !== 'tracback') return 0;
    const done = backIdx * backStep_m - lost.nb.distance_m;
    let acc = 0;
    for (let i = 0; i < lost.plan.maneuvers.length; i++) {
      acc += lost.plan.maneuvers[i].distance_m;
      if (done < acc) return i;
    }
    return lost.plan.maneuvers.length - 1;
  }, [lost, mode, backIdx]);

  // Route selection establishes the range; field tracking only translates it.
  useEffect(() => {
    if (route?.coords.length) setSelection(routeBounds(route.coords));
    else if (world) setSelection(L.latLngBounds([world.region.south, world.region.west], [world.region.north, world.region.east]));
  }, [route, world]);
  useEffect(() => {
    const p = backPos ?? pos;
    if (mode !== 'plan' && p) setSelection(b => b ? followSelection(b, p) : b);
  }, [mode, backPos?.lat, backPos?.lon, pos?.lat, pos?.lon]);
  useEffect(() => { if (selection) ctl.current?.setSelection(selection, true, false); }, [selection, world]);

  // ---- 周辺の危険度 ----
  const explorerPos = backPos ?? pos;
  useEffect(() => {
    const c = ctl.current;
    if (!c || !world) return;
    const update = (center: LatLon, force: boolean): void => {
      if (!latLonToCell(world.grid, center)) {
        c.setHeat(null); overview.current?.controller.setHeat(null);
        heatCenter.current = null;
        return;
      }
      if (!force && heatCenter.current && haversine(heatCenter.current, center) < 20) return;
      const start = performance.now();
      let img = renderRiskHeat(world, center, heatRadius.current);
      if (performance.now() - start > 100 && heatRadius.current > 300) {
        heatRadius.current = 300;
        img = renderRiskHeat(world, center, 300);
      }
      heatCenter.current = center;
      c.setHeat(img); overview.current?.controller.setHeat(img);
    };
    if (!heatVisible) {
      c.setHeat(null); overview.current?.controller.setHeat(null);
      heatCenter.current = null;
      return;
    }
    if (mode === 'plan') {
      const onMoveEnd = (): void => {
        const center = c.map.getCenter();
        update({ lat: center.lat, lon: center.lng }, true);
      };
      onMoveEnd();
      c.map.on('moveend', onMoveEnd);
      return () => { c.map.off('moveend', onMoveEnd); };
    }
    if (explorerPos) update(explorerPos, false);
    else {
      c.setHeat(null); overview.current?.controller.setHeat(null);
      heatCenter.current = null;
    }
  }, [world, mode, heatVisible, explorerPos?.lat, explorerPos?.lon]);

  // ---- 地図への反映 ----
  useEffect(() => {
    ctl.current?.setBaseMap(baseMapMode);
    overview.current?.controller.setBaseMap(baseMapMode);
  }, [world, baseMapMode, miniCollapsed]);
  useEffect(() => {
    for (const c of [ctl.current, overview.current?.controller]) for (const l of LAYERS) c?.setLayer(l.key, l.key === 'heat' ? heatVisible : layers[l.key]);
  }, [layers, heatVisible, world]);
  useEffect(() => {
    if (!world || !base) return;
    ctl.current?.setSites(base, targets, world.landmarks, targetId, (id) => modeRef.current === 'plan' && setTargetId(id), mode === 'plan' ? targetEditing.move : undefined);
    overview.current?.controller.setSites(base, targets, world.landmarks, targetId, (id) => modeRef.current === 'plan' && setTargetId(id));
  }, [world, base, targets, targetId, mode, targetEditing.move]);
  useEffect(() => {
    ctl.current?.setRoutes(routes ?? [], route?.preset ?? null, mode !== 'plan');
    overview.current?.controller?.setRoutes(routes ?? [], route?.preset ?? null, mode !== 'plan');
  }, [routes, route, mode, world]);
  useEffect(() => {
    ctl.current?.setTrack(track);
    overview.current?.controller?.setTrack(track);
  }, [track, world]);
  useEffect(() => {
    const err = pos ? (backPos ? Math.max(5, pos.err_m * (1 - backProgress)) : pos.err_m) : 0;
    ctl.current?.setExplorer(backPos ?? pos, err, field.heading);
    overview.current?.controller?.setExplorer(backPos ?? pos, err, field.heading);
  }, [pos, backPos, mode, backProgress, field.heading]);
  useEffect(() => {
    const c = ctl.current;
    if (!c) return;
    if (mode === 'lost' && lost && pos) {
      c.setHints(lost.fix, track[lost.nb.index], pos);
      overview.current?.controller.setHints(lost.fix, track[lost.nb.index], pos);
      c.setTracBack(null, null, 0);
      overview.current?.controller.setTracBack(null, null, 0);
    } else if (mode === 'tracback' && lost) {
      c.setHints(null, null, null);
      overview.current?.controller.setHints(null, null, null);
      c.setTracBack(lost.plan, track[lost.nb.index] ? pos : null, nextManeuver);
      overview.current?.controller.setTracBack(lost.plan, track[lost.nb.index] ? pos : null, nextManeuver);
    } else {
      c.setHints(null, null, null);
      overview.current?.controller.setHints(null, null, null);
      c.setTracBack(null, null, 0);
      overview.current?.controller.setTracBack(null, null, 0);
    }
  }, [mode, lost, nextManeuver]);

  // 地図をクリックした地点の情報ウィンドウ
  useEffect(() => {
    ctl.current?.setTemp(null, '');
    overview.current?.controller.setTemp(null, '');
    if (!temp || !world) return;
    const c = temp.source === 'overview' ? overview.current?.controller : ctl.current;
    if (!c) return;
    const cell = latLonToCell(world.grid, temp);
    const z = elevAt(world.grid, temp);
    let body = '<span class="muted">この範囲は計算対象外です（地形データなし）</span>';
    let canGo = false;
    if (cell && z != null) {
      const i = idx(world.grid, cell.c, cell.r);
      const s = world.slope[i];
      const k = slopeClass(s, world.region.slope_max_deg);
      const risk = riskAt(world.grid, world.slope, i, world.region.slope_max_deg);
      canGo = !!risk && !risk.blocked && mode === 'plan';
      body = `標高 ${Math.round(z).toLocaleString()} m`;
      if (risk) {
        const rough = world.grid.rough?.[i];
        const roughLabel = rough !== undefined && Number.isFinite(rough) ? rough.toFixed(2) : 'データなし（0扱い）';
        body += `・傾斜 ${s.toFixed(0)}°（${SLOPE_NAME[k]}）<br><b>危険度 ${risk.risk.toFixed(2)}（${RISK_BANDS[risk.band].label}）</b><br>傾斜 ${s.toFixed(1)}° による ${risk.slopeTerm.toFixed(2)} + 起伏 ${roughLabel} による ${risk.roughTerm.toFixed(2)}<br>合計は最大 1（表示値は丸めています）`;
        if (risk.blocked) body += `<br>傾斜が上限 ${world.region.slope_max_deg}° を超えるため、通行不可・危険度 1`;
      }
    }
    const placement = canGo ? snapTarget(world, temp) : null;
    if (placement) body += '<br><button class="popbtn">ここに目的地を追加</button> <button class="popbtn" data-action="base">ここに基地を置く</button>';
    c.setTemp(temp, `<b>選んだ地点</b><br>${fmtLatLon(temp)}<br>${body}`, () => {
      if (!placement || modeRef.current !== 'plan') return;
      const custom: Site = {
        id: `custom-${crypto.randomUUID()}`,
        name: `追加した目的地 ${targets.filter((t) => t.id.startsWith('custom')).length + 1}`,
        ...placement,
        note: '地図をクリックして追加した目的地です',
      };
      setTargets((ts) => [...ts, custom]);
      setTargetId(custom.id);
      setNotice('目的地を追加しました。通れるマスに合わせてルートを再計算します。');
      setTemp(null);
    }, () => {
      if (!placement || modeRef.current !== 'plan') return;
      setBaseOverride({ ...world.base, ...placement, name: '基地（配置済み）' });
      setNotice('基地を配置しました。通れるマスに合わせてルートを再計算します。');
      setTemp(null);
    });
  }, [temp, world, mode, targets]);

  // ---- 操作 ----
  const depart = (): void => {
    if (!world || !route) return;
    const start = positionFeed.prepare(route, Date.now());
    if (start === null) return;
    startMs.current = start;
    setTrack([]);
    setBackIdx(0);
    setNotice(null);
    setTemp(null);
    setRestored(false);
    setMode('traverse');
    setPlaying(true);
  };
  const startTracBack = (): void => {
    if (!lost || !pos) return;
    backPath.current = densify([[pos.lat, pos.lon], ...lost.plan.coords], backStep_m);
    setBackIdx(0);
    setMode('tracback');
  };
  const reset = (): void => {
    void clearSession();
    lastSaved.current = null;
    setSaveState('idle');
    setRestored(false);
    setMode('plan');
    setTrack([]);
    setPlaying(false);
    setForcedOffline(false);
    setNotice(null);
    setBackIdx(0);
  };

  const currentMs = startMs.current + (stats.elapsed_s + backElapsed) * 1000;
  const clock = base ? stamp(currentMs, base.lon) : null;
  const saveMeasurements = (): void => {
    if (!world || !base || !clock || !measurements.current.length) return;
    downloadJson(exportDocument(measurements.current, {
      exported_utc: new Date().toISOString(), terrain: `HiRISE DTM ${world.region.source.product}`,
      base, health_display_on: devices.healthOn,
    }), `gale-eva-measurements-sol${clock.sol}-${clock.lmst.slice(0, 5).replace(':', '')}.json`);
  };
  const weatherWarning = forecast ? dustWarning(forecast) : null;
  const hudState: HudState = { ...field, health, healthOn: devices.healthOn, overviewOn: !miniCollapsed, online, source: backPos ? 'dead_reckoning' : positionFeed.fix?.source ?? 'simulation', destination,
    warning: fieldWarning(destination?.offRoute ?? false, weatherWarning, limit, health), baseMapMode, route, track, targets, base: base ?? undefined };
  const channelError = useBaseDeviceChannel(world ? { ...hudState, hudOn: devices.hudOn, mode, canLost: mode === 'traverse' && track.length >= 3, canReturn: mode === 'lost' && !!lost && !!pos } : null, {
    hud: devices.setHudOn, health: devices.setHealthOn, overview: (on) => setMiniOpen((s) => ({ ...s, [scope]: on })),
    lost: () => { setPlaying(false); setMode('lost'); }, return: startTracBack,
  });
  if (loadError) return <div className="fatal">データを読み込めませんでした。{loadError}</div>;
  const sciCount = route && world ? targets.filter((t) => deviationFromRoute(t, route.coords) < 150).length : 0;

  const kpis: { label: string; value: string; sub: string }[] =
    mode === 'plan'
      ? [
          { label: 'EVA 安全スコア', value: route ? `${route.safety_score}` : '–', sub: '/ 100（式は下の説明）' },
          { label: '移動距離（地表）', value: route ? fmtKm(route.surface_m) : '–', sub: route ? `登り +${Math.round(route.ascent_m)} m` : '' },
          { label: '所要時間（片道）', value: route ? fmtDur(route.est_time_s) : '–', sub: 'EVA 徒歩・傾斜で補正' },
          { label: '科学観測地点', value: `${sciCount}`, sub: 'ルートから 150 m 以内' },
        ]
      : [
          { label: '歩いた距離', value: fmtKm(stats.surface_m), sub: `登り +${Math.round(stats.ascent_m)} m / 下り −${Math.round(stats.descent_m)} m` },
          { label: '経過時間', value: fmtDur(stats.elapsed_s + backElapsed), sub: 'シミュレーション' },
          { label: '位置の誤差', value: pos ? `±${Math.round(pos.err_m)} m` : '–', sub: online && positionFeed.fix?.source === 'satellite' ? '衛星測位（仮定）' : '推測航法: 進んだ距離の 3%' },
          { label: '酸素の残り（シミュレーション）', value: fmtDur(o2 * 60), sub: `バッテリー ${Math.round((battery / BATTERY_START_MIN) * 100)}%（シミュレーション）` },
        ];

  return (
    <>
    {devices.localHudVisible && fieldWorld ? <HudView world={fieldWorld} state={hudState} onClose={devices.closeLocalHud} onHealthToggle={() => devices.setHealthOn((on) => !on)} onOverviewToggle={() => setMiniOpen((s) => ({ ...s, [scope]: !s[scope] }))} /> : null}
    <div className={`app layout-split ${devices.localHudVisible ? 'dashboard-hidden' : ''}`}>
      <header className="hdr">
        <div className="brand">
          <span className="planet" aria-hidden="true" />
          <div>
            <b>Gale EVA Navigator</b>
            <span className="muted"> / {mode === 'plan' ? 'ルートの計画' : mode === 'traverse' ? '足あとの記録' : mode === 'lost' ? '迷ったとき' : 'とんぼ返り'}</span>
          </div>
        </div>
        <div className="hdr-right">
          <span className={`chip ${online ? 'ok' : 'warn'}`} role="status">
            {online ? '● 通信可' : '⚠ 圏外'}
            {unsent > 0 ? `（未送信 ${unsent} 件）` : ''}
          </span>
          {track.length > 0 && saveState !== 'idle' ? (
            <span className={`chip ${saveState === 'failed' ? 'warn' : ''}`} role="status">
              {saveState === 'failed' ? '端末に保存できません' : '端末に保存済み'}
            </span>
          ) : null}
          <span className="chip">実データ: HiRISE</span>
          {weatherWarning ? <span className="chip warn dust-alert">{weatherWarning}</span> : null}
          {clock ? <span className="clock">Sol {clock.sol}・LMST {clock.lmst}</span> : null}
        </div>
      </header>

      <div className="body">
        <section className="main">
          <div className="kpis">
            {kpis.map((k) => (
              <div className="kpi" key={k.label}>
                <div className="kpi-l">{k.label}</div>
                <div className="kpi-v">{k.value}</div>
                <div className="kpi-s">{k.sub}</div>
              </div>
            ))}
          </div>
          <div className={`map-row ${overviewVisible ? '' : 'overview-hidden'}`}>
            {world ? <OverviewPane world={world} selection={selection} onSelection={(bounds) => { ctl.current?.setSelection(bounds); setSelection(bounds); }} onPoint={(lat, lon) => setTemp({ lat, lon, source: 'overview' })} handle={overview} visible={overviewVisible} /> : <section id="dashboard-overview" className="overview-pane" hidden={!overviewVisible}>地形データを読み込んでいます…</section>}
          <section className="mapwrap" aria-label="操作画面">
            <div ref={mapEl} className="map" aria-label="操作画面。選んだ範囲内を移動、ホイールでズーム、クリックで地点を選ぶ" />
            {!world ? <div className="loading">地形データを読み込んでいます…</div> : null}
            <div className="layerbar">
              <button
                type="button"
                className={`tog ${overviewVisible ? 'on' : ''}`}
                aria-expanded={overviewVisible}
                aria-controls="dashboard-overview"
                onClick={() => setOverviewVisible((visible) => !visible)}
              >
                {overviewVisible ? '表示画面を隠す' : '表示画面を表示'}
              </button>
              <button className="tog" onClick={devices.openLocalHud} disabled={!world}>HUD 表示</button>
              <button className={`tog ${devices.healthOn ? 'on' : ''}`} aria-pressed={devices.healthOn} onClick={() => devices.setHealthOn((on) => !on)}>健康状態 {devices.healthOn ? 'ON' : 'OFF'}</button>
              <div className="basemap-switch" role="group" aria-label="地図の背景">
                <button type="button" className={`tog ${baseMapMode === 'mono' ? 'on' : ''}`} aria-pressed={baseMapMode === 'mono'} onClick={() => setBaseMapMode('mono')}>白黒（詳細）</button>
                <button type="button" className={`tog ${baseMapMode === 'color' ? 'on' : ''}`} aria-pressed={baseMapMode === 'color'} onClick={() => setBaseMapMode('color')}>カラー（広域）</button>
              </div>
              {baseMapMode === 'color' ? <p className="basemap-note" role="status">Vikingのカラー画像（232 m/画素）。拡大すると粗く見えます。</p> : null}
              {LAYERS.map(({ key, label }) => {
                const on = key === 'heat' ? heatVisible : layers[key];
                return (
                  <button key={key} className={`tog ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => {
                    if (key === 'heat') setHeatOn((s) => ({ ...s, [scope]: !s[scope] }));
                    else setLayers((s) => ({ ...s, [key]: !s[key] }));
                  }}>
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              className="locate"
              aria-label="現在地（探査者の位置）へ移動"
              title="現在地（探査者の位置）"
              onClick={() => {
                ctl.current?.followCurrent(base ?? undefined);
              }}
            >
              ◎
            </button>
            <div className="legend">
              <span><i style={{ background: ROUTE_COLOR.safe }} />安全ルート</span>
              <span><i style={{ background: ROUTE_COLOR.short }} />最短ルート</span>
              {world ? <span><i className="steep-route" />ルート上の急な区間（{world.region.slope_limited_deg}°以上）</span> : null}
              <span><i style={{ background: '#ffffff' }} />足あと</span>
              <span><i style={{ background: '#00e5ff' }} />とんぼ返り</span>
              {SLOPE_NAME.map((n, i) => (
                <span key={n}>
                  <i style={{ background: SLOPE_COLOR[i] }} />
                  {n}
                </span>
              ))}
              <span>
                <i className="hz" />
                危険エリア
              </span>
              {heatVisible ? <span className="heat-legend">周辺の危険度: 低 <i className="heat-scale" /> 高 <button type="button" aria-label="危険度の決め方" aria-expanded={riskHelpOpen} aria-controls="risk-help" onClick={() => setRiskHelpOpen((v) => !v)}>?</button></span> : null}
              <span ref={coordEl} className="coord" />
            </div>
            {heatVisible && riskHelpOpen && world ? <RiskHelp slopeMax={world.region.slope_max_deg} onClose={() => setRiskHelpOpen(false)} /> : null}
          </section>
          </div>
          {world && forecast ? <DustForecastStrip forecast={forecast} region={world.region} baseMs={currentMs} /> : null}
        </section>

        <div className="panel-grid">
          <FieldPanels measurementCount={measurementCount} saveMeasurements={saveMeasurements} mode={mode} setMode={setMode} restored={restored} playing={playing} setPlaying={setPlaying} simEnded={simEnded} speed={speed} setSpeed={setSpeed} forcedOffline={forcedOffline} setForcedOffline={setForcedOffline} track={track} unsent={unsent} offRoute={offRoute} deviation={deviation} simulation={positionFeed.kind === 'simulation'} reset={reset} startTracBack={startTracBack} lost={lost} limit={limit} pos={pos} o2={o2} backIdx={backIdx} backStep_m={backStep_m} nextManeuver={nextManeuver} backProgress={backProgress} />
          <section className="panel-card"><DestinationStatus info={destination} /></section>
          {mode === 'plan' ? <PlanPanels targets={targets} targetId={targetId} setTargetId={setTargetId} target={target} routes={routes} route={route} setPreset={setPreset} speed={speed} setSpeed={setSpeed} depart={depart} resetTargets={targetEditing.reset} jsonSource={positionFeed.kind === 'json'} resetBase={() => { setBaseOverride(null); setNotice('基地を元の位置に戻しました。'); }} baseMoved={baseOverride !== null} /> : null}
          <section className="panel-card"><PositionControls feed={positionFeed} planning={mode === 'plan'} online={online} /></section>
          <section className="panel-card"><DeviceLinks onHudOpen={() => devices.setHudOn(true)} />{channelError ? <p role="alert">{channelError}</p> : null}</section>
          <DataPanel world={world} />
          {notice ? <div className="note ok" role="status">{notice}</div> : null}
        </div>
      </div>
      <div className="dashboard-actions" aria-label="現場の操作">
        {mode === 'plan' ? <button disabled={!route} onClick={depart}>このルートで出発（シミュレーション）</button> : null}
        {mode === 'traverse' ? <button disabled={track.length < 3} onClick={() => { setPlaying(false); setMode('lost'); }}>迷った</button> : null}
        {mode === 'lost' ? <button disabled={!lost || !pos} onClick={startTracBack}>来た道を戻る</button> : null}
      </div>
    </div>
    </>
  );
}
