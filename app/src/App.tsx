import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildTracBack,
  cellLatLon,
  computeSlopeAspect,
  countUnsent,
  DEFAULT_V0,
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
  type Grid,
  type Landmark,
  type LatLon,
  type Route,
  type RoutePreset,
  type TrackPoint,
} from '@core';
import { MapController, ROUTE_COLOR, SLOPE_COLOR, type LayerKey, type Site } from './mapController';
import { densify, makeSimTrack, stamp } from './sim';
import { clearSession, loadSession, saveSession } from './store';
import { renderRiskHeat } from './heatmap';
import { MiniMap } from './miniMap';
import type { HazardSettings } from './hazardText';
import { RiskHelp } from './RiskHelp';
import { DustPanel, dustWarning } from './DustPanel';
import type { BaseMapMode } from './baseMap';

type Mode = 'plan' | 'traverse' | 'lost' | 'tracback';
type ViewScope = 'plan' | 'field';
type World = {
  grid: Grid;
  slope: Float32Array;
  aspect: Float32Array;
  region: HazardSettings & { north: number; south: number; west: number; east: number; source: { credit: string; product: string; note: string } };
  contours: GeoJSON.FeatureCollection;
  hazards: GeoJSON.FeatureCollection;
  base: Site;
  targets: Site[];
  landmarks: Landmark[];
};

const PRESETS: RoutePreset[] = ['safe', 'short'];
const PRESET_LABEL: Record<RoutePreset, string> = { safe: '安全優先ルート', short: '最短時間ルート', science: '科学探査ルート' };
const PRESET_TAG: Record<RoutePreset, string> = { safe: '推奨', short: '効率重視', science: '観測重視' };
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

const fmtKm = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const fmtDur = (s: number): string => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} 分`;
};
const fmtLatLon = (p: LatLon): string => `${Math.abs(p.lat).toFixed(4)}°${p.lat < 0 ? 'S' : 'N'}, ${p.lon.toFixed(4)}°E`;

/** (c, r) の近くで、傾斜が緩いマスを探す。 */
function freeCell(grid: Grid, slope: Float32Array, c: number, r: number): { c: number; r: number } {
  for (let rad = 0; rad < 40; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= grid.width || rr >= grid.height) continue;
        if (slope[idx(grid, cc, rr)] < 8) return { c: cc, r: rr };
      }
    }
  }
  return { c, r };
}

async function loadWorld(): Promise<World> {
  const get = async (name: string): Promise<Response> => {
    const res = await fetch(`/data/${name}`);
    if (!res.ok) throw new Error(`${name} を読み込めませんでした（${res.status}）`);
    return res;
  };
  const [region, elevBuf, roughBuf, contours, hazards] = await Promise.all([
    get('region.json').then((r) => r.json()),
    get('elev.f32').then((r) => r.arrayBuffer()),
    get('rough.f32').then((r) => r.arrayBuffer()),
    get('contours.geojson').then((r) => r.json()),
    get('hazard_zones.geojson').then((r) => r.json()),
  ]);
  const grid: Grid = { ...region, elev: new Float32Array(elevBuf), rough: new Float32Array(roughBuf) };
  const { slope, aspect } = computeSlopeAspect(grid);

  const site = (id: string, name: string, c: number, r: number, note?: string): Site => {
    const f = freeCell(grid, slope, c, r);
    return { id, name, ...cellLatLon(grid, f.c, f.r), note };
  };
  const base = site('base', '基地', 70, 80);
  // 目的地は、ルートの差が出る場所を実際に計算して選んだ
  const targets = [
    site('T1', '目標A（東の露頭）', 546, 220, '崖の縁にむき出しになった地層を調べる'),
    site('T2', '目標B（尾根の先）', 380, 300, '尾根の先の岩石を採取する'),
    site('T3', '目標C（崖の南）', 540, 460, '崖の下の堆積物を調べる（崖を越える必要がある）'),
  ];

  // 目印: 大きい急斜面のエリアの中心（公式の地名ではないので、仮の名前）
  const big = (hazards as GeoJSON.FeatureCollection).features
    .filter((f) => f.properties?.level === 'no_go')
    .sort((a, b) => (b.properties?.area_m2 ?? 0) - (a.properties?.area_m2 ?? 0))
    .slice(0, 6);
  const landmarks: Landmark[] = big.map((f, i) => {
    const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return { id: `L${i}`, name: `目印${'ABCDEF'[i]}`, lat, lon, kind: '急な崖' };
  });

  return { grid, slope, aspect, region, contours, hazards, base, targets, landmarks };
}

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('plan');
  const [baseMapMode, setBaseMapMode] = useState<BaseMapMode>('mono');
  const [layers, setLayers] = useState<Record<Exclude<LayerKey, 'heat'>, boolean>>({ contours: true, hazard: true, slope: false, hillshade: false });
  const [heatOn, setHeatOn] = useState<Record<ViewScope, boolean>>({ plan: false, field: true });
  const [riskHelpOpen, setRiskHelpOpen] = useState(false);
  const [miniOpen, setMiniOpen] = useState<Record<ViewScope, boolean>>(() => ({
    plan: false,
    field: !window.matchMedia('(max-width: 900px)').matches,
  }));
  const [dustOpen, setDustOpen] = useState<Record<ViewScope, boolean>>(() => ({
    plan: false,
    field: !window.matchMedia('(max-width: 900px), (max-height: 700px)').matches,
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
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);
  const [forcedOffline, setForcedOffline] = useState(false);
  const [backIdx, setBackIdx] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [temp, setTemp] = useState<LatLon | null>(null);
  const [restored, setRestored] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');

  const mapEl = useRef<HTMLDivElement>(null);
  const miniEl = useRef<HTMLDivElement>(null);
  const mini = useRef<MiniMap | null>(null);
  const coordEl = useRef<HTMLSpanElement>(null);
  const ctl = useRef<MapController | null>(null);
  const heatCenter = useRef<LatLon | null>(null);
  const heatRadius = useRef(400);
  const sim = useRef<TrackPoint[]>([]);
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
      sim.current = s.track;
      setTargetId(s.targetId === 'custom' ? 'T1' : s.targetId);
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
  const latest = useRef({ track, targetId, preset, forcedOffline });
  latest.current = { track, targetId, preset, forcedOffline };
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
      (lat, lon) => setTemp({ lat, lon }),
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
      (bounds) => mini.current?.setViewport(bounds),
    );
    ctl.current = c;
    const observer = new ResizeObserver(() => c.map.invalidateSize());
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
    if (!world || !target) return;
    setRoutes(null);
    const id = window.setTimeout(() => {
      const s = latLonToCell(world.grid, world.base);
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
  }, [world, target]);

  const route = routes?.find((r) => r.preset === preset) ?? routes?.[0] ?? null;

  // ---- 02 足あとの記録（シミュレーションの再生）----
  const online = !forcedOffline;
  const onlineRef = useRef(online);
  onlineRef.current = online;

  // 再生は「経過した実時間 × 速さ」で進める。タブが裏に回ってタイマーが間引かれても、進み方は変わらない。
  const POINTS_PER_SEC = 6;
  useEffect(() => {
    if (mode !== 'traverse' || !playing) return;
    const t0 = performance.now();
    let base = -1;
    const id = window.setInterval(() => {
      setTrack((t) => {
        if (base < 0) base = t.length;
        const want = Math.min(sim.current.length, base + Math.floor(((performance.now() - t0) / 1000) * POINTS_PER_SEC * speed));
        if (want >= sim.current.length) setPlaying(false);
        if (want <= t.length) return t;
        const sent = onlineRef.current;
        return [...t, ...sim.current.slice(t.length, want).map((p) => ({ ...p, sent }))];
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [mode, playing, speed]);

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
  const simEnded = mode === 'traverse' && !playing && track.length > 0 && track.length >= sim.current.length;

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

  // ---- ミニマップ ----
  useEffect(() => {
    const c = ctl.current;
    if (!world || miniCollapsed || !miniEl.current || !c) return;
    const overview = new MiniMap(miniEl.current, world.region, (p) => c.map.panTo([p.lat, p.lon]));
    mini.current = overview;
    overview.setViewport(c.map.getBounds());
    return () => {
      mini.current = null;
      overview.destroy();
    };
  }, [world, miniCollapsed]);
  useEffect(() => {
    if (world) mini.current?.setSites(world.base, targets);
  }, [world, targets, miniCollapsed]);
  useEffect(() => {
    mini.current?.setRoute(route?.coords ?? [], ROUTE_COLOR[route?.preset ?? 'safe']);
  }, [world, route, miniCollapsed]);
  useEffect(() => {
    mini.current?.setTrack(track);
  }, [world, track, miniCollapsed]);
  useEffect(() => {
    mini.current?.setExplorer(backPos ?? pos);
  }, [world, backPos, pos, miniCollapsed]);

  // ---- 周辺の危険度 ----
  const explorerPos = backPos ?? pos;
  useEffect(() => {
    const c = ctl.current;
    if (!c || !world) return;
    const update = (center: LatLon, force: boolean): void => {
      if (!latLonToCell(world.grid, center)) {
        c.setHeat(null);
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
      c.setHeat(img);
    };
    if (!heatVisible) {
      c.setHeat(null);
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
      c.setHeat(null);
      heatCenter.current = null;
    }
  }, [world, mode, heatVisible, explorerPos?.lat, explorerPos?.lon]);

  // ---- 地図への反映 ----
  useEffect(() => {
    ctl.current?.setBaseMap(baseMapMode);
    mini.current?.setBaseMap(baseMapMode);
  }, [world, baseMapMode, miniCollapsed]);
  useEffect(() => {
    for (const l of LAYERS) ctl.current?.setLayer(l.key, l.key === 'heat' ? heatVisible : layers[l.key]);
  }, [layers, heatVisible, world]);
  useEffect(() => {
    if (world) ctl.current?.setSites(world.base, targets, world.landmarks, targetId, (id) => modeRef.current === 'plan' && setTargetId(id));
  }, [world, targets, targetId]);
  useEffect(() => {
    ctl.current?.setRoutes(routes ?? [], route?.preset ?? null, mode !== 'plan');
  }, [routes, route, mode, world]);
  useEffect(() => {
    ctl.current?.setTrack(track);
  }, [track, world]);
  useEffect(() => {
    const err = pos ? (backPos ? Math.max(5, pos.err_m * (1 - backProgress)) : pos.err_m) : 0;
    ctl.current?.setExplorer(backPos ?? pos, err, mode === 'traverse' || mode === 'tracback');
  }, [pos, backPos, mode, backProgress]);
  useEffect(() => {
    const c = ctl.current;
    if (!c) return;
    if (mode === 'lost' && lost && pos) {
      c.setHints(lost.fix, track[lost.nb.index], pos);
      c.setTracBack(null, null, 0);
    } else if (mode === 'tracback' && lost) {
      c.setHints(null, null, null);
      c.setTracBack(lost.plan, track[lost.nb.index] ? pos : null, nextManeuver);
    } else {
      c.setHints(null, null, null);
      c.setTracBack(null, null, 0);
    }
  }, [mode, lost, nextManeuver]);

  // 地図をクリックした地点の情報ウィンドウ
  useEffect(() => {
    const c = ctl.current;
    if (!c || !world) return;
    if (!temp) return c.setTemp(null, '');
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
      if (canGo) body += '<br><button class="popbtn">ここを目的地にする</button>';
    }
    c.setTemp(temp, `<b>選んだ地点</b><br>${fmtLatLon(temp)}<br>${body}`, () => {
      const custom: Site = { id: 'custom', name: '選んだ地点', ...temp };
      setTargets((ts) => [...ts.filter((t) => t.id !== 'custom'), custom]);
      setTargetId('custom');
      setTemp(null);
    });
  }, [temp, world, mode]);

  // ---- 操作 ----
  const depart = (): void => {
    if (!world || !route) return;
    startMs.current = Date.now();
    sim.current = makeSimTrack(route, world.grid, startMs.current);
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

  if (loadError) return <div className="fatal">データを読み込めませんでした。{loadError}</div>;

  const currentMs = startMs.current + (stats.elapsed_s + backElapsed) * 1000;
  const clock = world ? stamp(currentMs, world.base.lon) : null;
  const weatherWarning = forecast ? dustWarning(forecast) : null;
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
          { label: '位置の誤差', value: pos ? `±${Math.round(pos.err_m)} m` : '–', sub: '推測航法: 進んだ距離の 3%' },
          { label: '酸素の残り（シミュレーション）', value: fmtDur(o2 * 60), sub: `バッテリー ${Math.round((battery / BATTERY_START_MIN) * 100)}%（シミュレーション）` },
        ];

  return (
    <div className="app">
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
          <div className={`mapwrap ${miniCollapsed ? 'mini-closed' : 'mini-open'} ${dustOpen[scope] ? 'dust-open' : ''}`}>
            <div ref={mapEl} className="map" aria-label="Gale クレーターの地図。ドラッグで移動、ホイールでズーム、クリックで地点を選ぶ" />
            <div className="map-tools-left">
              <div className={`minimap ${miniCollapsed ? 'collapsed' : ''}`}>
                {miniCollapsed ? (
                  <button type="button" onClick={() => setMiniOpen((s) => ({ ...s, [scope]: true }))} aria-expanded={false}>全体図</button>
                ) : (
                  <>
                    <div ref={miniEl} className="minimap-map" aria-label="活動地域の全体図。クリックでメインの地図を移動" />
                    <button type="button" className="minimap-collapse" onClick={() => setMiniOpen((s) => ({ ...s, [scope]: false }))} aria-label="全体図を折りたたむ" aria-expanded={true}>—</button>
                  </>
                )}
              </div>
              {world && forecast ? <DustPanel forecast={forecast} region={world.region} open={dustOpen[scope]} onToggle={() => setDustOpen((s) => ({ ...s, [scope]: !s[scope] }))} baseMs={currentMs} lon={world.base.lon} /> : null}
            </div>
            {!world ? <div className="loading">地形データを読み込んでいます…</div> : null}
            <div className="layerbar">
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
                const p = backPos ?? pos ?? world?.base;
                if (p) ctl.current?.fly(p.lat, p.lon, 15);
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
          </div>
        </section>

        <aside className="side">
          {notice ? <div className="note ok">{notice}</div> : null}

          {mode === 'plan' ? (
            <>
              <h2>ルート候補を比較</h2>
              <label className="fld">
                <span>出発: 基地　→　目的地</span>
                <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              {target?.note ? <p className="muted small">科学目標: {target.note}</p> : null}
              {routes === null ? <p className="muted">ルートを計算しています…</p> : null}
              {routes && routes.length === 0 ? <div className="note warn">通れるルートが見つかりません。目的地を変えてください。</div> : null}
              {routes?.map((r) => (
                <button key={r.id} className={`rcard ${r.preset === route?.preset ? 'sel' : ''}`} onClick={() => setPreset(r.preset)}>
                  <div className="rc-h">
                    <span className="rc-line" style={{ background: ROUTE_COLOR[r.preset] }} />
                    <b>{PRESET_LABEL[r.preset]}</b>
                    <span className="tag">{PRESET_TAG[r.preset]}</span>
                  </div>
                  <div className="rc-n">
                    <span>{fmtKm(r.surface_m)}</span>
                    <span>
                      {r.safety_score}
                      <small> /100</small>
                    </span>
                    <span>{fmtDur(r.est_time_s)}</span>
                  </div>
                  <div className="muted small">
                    最大傾斜 {r.max_slope_deg.toFixed(0)}°・急な区間 {fmtKm(r.limited_zone_m)}
                  </div>
                </button>
              ))}
              {route ? (
                <>
                  <h3>ルートの解説</h3>
                  <div className="explain">
                    {route.explanation.map((s) => (
                      <p key={s}>{s}</p>
                    ))}
                    <p className="muted small">計算結果からテンプレートで作った文章です（生成 AI は使っていません）。</p>
                  </div>
                  <button className="primary" onClick={depart}>
                    このルートで出発（シミュレーション）
                  </button>
                </>
              ) : null}
              <details className="about">
                <summary>指標とデータの説明</summary>
                {world ? <p>周辺の危険度 = min(1, (傾斜 / {world.region.slope_max_deg}°)² + 0.5 × 起伏)。傾斜 {world.region.slope_max_deg}° 超は危険度 1。</p> : null}
                {world ? <p>EVA 安全スコア = 100 − 40×(急な区間の長さ/全長) − 30×(最大傾斜/{world.region.slope_max_deg}°) − 20×(所要時間/6 時間) − 10×(圏外の長さ/全長)</p> : null}
                {world ? <p>歩く速さ = {DEFAULT_V0} m/s × exp(−3.5×|勾配 + 0.05|)（Tobler の式を宇宙服向けに上限を下げたもの）。このアプリでは傾斜 {world.region.slope_max_deg}° 超は通行不可の設定です。</p> : null}
                <p>地形: {world?.region.source.credit}（{world?.region.source.product}）。{world?.region.source.note}。</p>
                <p>画像: NASA/JPL-Caltech Mars Trek、HiRISE: NASA/JPL/University of Arizona。目印の名前は仮のもので、公式の地名ではありません。</p>
              </details>
            </>
          ) : null}

          {mode === 'traverse' ? (
            <>
              <h2>足あとの記録</h2>
              <div className="note">火星には GPS がありません。位置は推測航法による<b>推定</b>で、青い円が誤差の範囲です。この移動は<b>シミュレーション</b>です。</div>
              {restored ? <p className="muted small">復元した記録です。続きの再生はできませんが、「迷った」から来た道を戻れます。</p> : null}
              <div className="row">
                <button onClick={() => setPlaying((p) => !p)} disabled={simEnded}>
                  {playing ? '一時停止' : '再開'}
                </button>
                <label className="inline">
                  再生速度
                  <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                    <option value={1}>×1</option>
                    <option value={3}>×3</option>
                    <option value={8}>×8</option>
                  </select>
                </label>
              </div>
              <label className="switch">
                <input type="checkbox" checked={forcedOffline} onChange={(e) => setForcedOffline(e.target.checked)} />
                通信遮断モード（圏外にする）
              </label>
              <p className="muted small">圏外の間も記録は端末にたまり、通信が戻ると古い順に送られます。記録 {track.length} 点・未送信 {unsent} 件。</p>
              {offRoute ? <div className="note warn">予定ルートから {Math.round(deviation)} m 外れています。</div> : <p className="muted small">予定ルートからのずれ: {Math.round(deviation)} m</p>}
              {simEnded && !restored ? <div className="note warn">周りの地形が予定と合いません。迷った可能性があります。</div> : null}
              <button className="danger" onClick={() => { setPlaying(false); setMode('lost'); }} disabled={track.length < 3}>
                迷った
              </button>
              <button className="ghost" onClick={reset}>計画に戻る</button>
            </>
          ) : null}

          {mode === 'lost' && lost && limit && pos ? (
            <>
              <h2>迷ったとき</h2>
              <div className={`limit ${limit.level}`}>
                <div className="small">帰還の限界</div>
                <b>{limit.text}</b>
                <div className="small">
                  戻りの所要 {Math.round(limit.t_back_min)} 分（余裕 1.3 倍込み）・酸素の残り {Math.round(o2)} 分
                </div>
              </div>
              <dl className="facts">
                <dt>今の推定位置</dt>
                <dd>{fmtLatLon(pos)}（誤差 ±{Math.round(pos.err_m)} m）</dd>
                <dt>いちばん近い足あと</dt>
                <dd>
                  方位 {Math.round(lost.nb.bearing_deg)}° へ {Math.round(lost.nb.distance_m)} m
                </dd>
                <dt>最後に位置を確定した地点</dt>
                <dd>{lost.fix ? `${lost.fix.lmst}（${lost.fix.note ?? '出発点'}）` : 'なし'}</dd>
                <dt>近くの目印</dt>
                <dd>{lost.near.map((n) => `${n.l.name}（${Math.round(n.d)} m）`).join('、')}</dd>
              </dl>
              <button className="primary big" onClick={startTracBack}>
                来た道を戻る
              </button>
              <p className="muted small">行きに通れた道は帰りも通れる可能性が高いので、知らない近道より来た道を優先します。通信がなくても動きます。</p>
              <button className="ghost" onClick={() => { setMode('traverse'); }}>記録に戻る</button>
            </>
          ) : null}

          {mode === 'tracback' && lost && limit ? (
            <>
              <h2>とんぼ返り</h2>
              <div className="nav">
                <div className="small muted">次の案内</div>
                <b>{backIdx * backStep_m < lost.nb.distance_m ? `足あとまで、方位 ${Math.round(lost.nb.bearing_deg)}° へ ${Math.round(lost.nb.distance_m)} m` : lost.plan.maneuvers[nextManeuver]?.text}</b>
              </div>
              <div className={`limit ${limit.level}`}>
                <div className="small">帰還の限界</div>
                <b>{limit.level === 'red' ? limit.text : `余裕 ${Math.floor(limit.margin_min)} 分`}</b>
                <div className="small">
                  残り {fmtKm((1 - backProgress) * (lost.plan.total_m + lost.nb.distance_m))}・約 {Math.round(limit.t_back_min)} 分
                </div>
              </div>
              <ol className="steps">
                {lost.plan.maneuvers.map((m, i) => (
                  <li key={m.index} className={i === nextManeuver ? 'cur' : i < nextManeuver ? 'done' : ''}>
                    {m.text}
                  </li>
                ))}
              </ol>
              <label className="inline">
                再生速度
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  <option value={1}>×1</option>
                  <option value={3}>×3</option>
                  <option value={8}>×8</option>
                </select>
              </label>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
