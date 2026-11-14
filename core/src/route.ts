// ルートの指標・EVA 安全スコア・選んだ理由の説明。設計書 01 の 5.5・5.6。
// 説明文は計算結果からテンプレートで作る（生成 AI は使わない）。

import { findPath, PRESETS, stepCost, type PathOptions, type RoutePreset } from './astar';
import { cellLatLon, idx, type Grid } from './grid';
import { DEFAULT_V0 } from './walkSpeed';

export type RouteSegment = {
  from: number; // coords の添字
  to: number;
  slopeClass: 0 | 1 | 2 | 3; // 0 安全 / 1 注意 / 2 制限 / 3 通行不可
  maxSlopeDeg: number;
};

export type Route = {
  id: string;
  preset: RoutePreset;
  coords: [number, number][]; // [lat, lon]
  cells: number[];
  surface_m: number;
  planar_m: number;
  ascent_m: number;
  descent_m: number;
  max_slope_deg: number;
  max_cross_deg: number;
  est_time_s: number;
  limited_zone_m: number; // 「制限」（limitedMinDeg 以上）のマスを通る長さ
  comm_out_m?: number;
  safety_score: number;
  explanation: string[];
  segments: RouteSegment[];
};

export type RouteOptions = {
  slopeMaxDeg?: number;
  limitedMinDeg?: number;
  v0?: number;
  activityLimit_s?: number; // 1回の活動の上限時間（初期値 6 時間）
};

/** 傾斜の4段階。境界は 5° / 15° / slopeMax。 */
export function slopeClass(slopeDeg: number, slopeMaxDeg = 20): 0 | 1 | 2 | 3 {
  if (slopeDeg > slopeMaxDeg) return 3;
  if (slopeDeg >= 15) return 2;
  if (slopeDeg >= 5) return 1;
  return 0;
}

/**
 * EVA 安全スコア（0〜100）。
 *   100 − 40×(制限エリアの長さ/全長) − 30×(最大傾斜/上限) − 20×(所要時間/活動の上限) − 10×(圏外の長さ/全長)
 */
export function safetyScore(
  r: Pick<Route, 'surface_m' | 'limited_zone_m' | 'max_slope_deg' | 'est_time_s' | 'comm_out_m'>,
  slopeMaxDeg = 20,
  activityLimit_s = 6 * 3600,
): number {
  const len = Math.max(r.surface_m, 1e-9);
  const score =
    100 -
    40 * Math.min(1, r.limited_zone_m / len) -
    30 * Math.min(1, r.max_slope_deg / slopeMaxDeg) -
    20 * Math.min(1, r.est_time_s / activityLimit_s) -
    10 * Math.min(1, (r.comm_out_m ?? 0) / len);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** マスの列からルートの指標を計算する。 */
export function buildRoute(
  g: Grid,
  slope: Float32Array,
  aspect: Float32Array,
  cells: number[],
  preset: RoutePreset,
  opt: RouteOptions = {},
): Route {
  const slopeMax = opt.slopeMaxDeg ?? 20;
  const limitedMin = opt.limitedMinDeg ?? 15;
  const v0 = opt.v0 ?? DEFAULT_V0;
  const w = PRESETS[preset];

  const coords: [number, number][] = cells.map((i) => {
    const p = cellLatLon(g, i % g.width, Math.floor(i / g.width));
    return [p.lat, p.lon];
  });

  let surface = 0;
  let planar = 0;
  let ascent = 0;
  let descent = 0;
  let maxSlope = cells.length ? slope[cells[0]] : 0;
  let maxCross = 0;
  let time = 0;
  let limited = 0;
  const segments: RouteSegment[] = [];

  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1];
    const b = cells[k];
    const dc = (b % g.width) - (a % g.width);
    const dr = Math.floor(b / g.width) - Math.floor(a / g.width);
    const heading = (Math.atan2(dc, -dr) * 180) / Math.PI;
    const st = stepCost(g, slope, aspect, a, b, dc !== 0 && dr !== 0, heading, w, slopeMax, v0);
    surface += st.d;
    planar += st.dh;
    time += st.time;
    const dz = g.elev[b] - g.elev[a];
    if (dz > 0) ascent += dz;
    else descent -= dz;
    maxSlope = Math.max(maxSlope, slope[b]);
    maxCross = Math.max(maxCross, st.cross);
    if (slope[b] >= limitedMin) limited += st.d;

    const cls = slopeClass(slope[b], slopeMax);
    const last = segments[segments.length - 1];
    if (last && last.slopeClass === cls) {
      last.to = k;
      last.maxSlopeDeg = Math.max(last.maxSlopeDeg, slope[b]);
    } else {
      segments.push({ from: k - 1, to: k, slopeClass: cls, maxSlopeDeg: slope[b] });
    }
  }

  const route: Route = {
    id: `route-${preset}`,
    preset,
    coords,
    cells,
    surface_m: surface,
    planar_m: planar,
    ascent_m: ascent,
    descent_m: descent,
    max_slope_deg: maxSlope,
    max_cross_deg: maxCross,
    est_time_s: time,
    limited_zone_m: limited,
    safety_score: 0,
    explanation: [],
    segments,
  };
  route.safety_score = safetyScore(route, slopeMax, opt.activityLimit_s);
  return route;
}

/** 出発マスから目的マスまでのルートを1本計算する。通れなければ null。 */
export function planRoute(
  g: Grid,
  slope: Float32Array,
  aspect: Float32Array,
  start: { c: number; r: number },
  goal: { c: number; r: number },
  preset: RoutePreset,
  opt: RouteOptions & Pick<PathOptions, 'useHeuristic'> = {},
): Route | null {
  const res = findPath(g, slope, aspect, start, goal, {
    weights: PRESETS[preset],
    slopeMaxDeg: opt.slopeMaxDeg,
    v0: opt.v0,
    useHeuristic: opt.useHeuristic,
  });
  return res ? buildRoute(g, slope, aspect, res.cells, preset, opt) : null;
}

const PRESET_NAME: Record<RoutePreset, string> = { safe: '安全', short: '最短', science: '科学' };

const fmtKm = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const fmtMin = (s: number): string => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} 時間 ${min % 60} 分` : `${min} 分`;
};

/**
 * ルートを選んだ理由（テンプレート）。reference（ふつうは最短ルート）があれば差を説明する。
 */
export function explainRoute(route: Route, reference?: Route): string[] {
  const out: string[] = [];
  out.push(
    `${PRESET_NAME[route.preset]}ルート: 距離 ${fmtKm(route.surface_m)}、所要 ${fmtMin(route.est_time_s)}、最大傾斜 ${route.max_slope_deg.toFixed(0)}°。`,
  );
  if (reference && reference.id !== route.id) {
    const dLen = route.surface_m - reference.surface_m;
    const refName = PRESET_NAME[reference.preset];
    const parts: string[] = [];
    if (Math.abs(dLen) >= 10) {
      parts.push(`${refName}ルートより ${fmtKm(Math.abs(dLen))} ${dLen > 0 ? '長い' : '短い'}`);
    }
    if (Math.abs(reference.max_slope_deg - route.max_slope_deg) >= 1) {
      parts.push(
        `最大傾斜は ${reference.max_slope_deg.toFixed(0)}° → ${route.max_slope_deg.toFixed(0)}°`,
      );
    }
    const dLim = reference.limited_zone_m - route.limited_zone_m;
    if (Math.abs(dLim) >= 10) {
      parts.push(`急な区間（15° 以上）は ${fmtKm(Math.abs(dLim))} ${dLim > 0 ? '減る' : '増える'}`);
    }
    if (parts.length) out.push(`${parts.join('。')}。`);
  }
  if (route.limited_zone_m < 1) out.push('急な区間（15° 以上）を通りません。');
  return out;
}

/** マスの添字（列・行）→ idx の再エクスポート用の小さな補助。 */
export const cellIndex = idx;
