// 足あとの記録・推測航法の誤差・通信遮断モードの計算。設計書 02 の 5.2〜5.5。

import { haversine, pointToSegment, toLocal, type LatLon, MARS_RADIUS_M } from './geo';

export type TrackPoint = {
  id: string;
  t_utc: string;
  sol: number;
  lmst: string;
  lat: number;
  lon: number;
  elev_m: number | null;
  heading_deg: number;
  err_m: number; // 誤差の円の半径
  src: 'dr' | 'fix'; // 推測航法 / 目印で確定
  note?: string;
  sent: boolean;
  simulated: true; // デモではすべて true
};

export const DR_K = 0.03; // 進んだ距離に対する誤差の増え方（3%）
export const FIX_ERR_M = 5; // 位置を確定したときの誤差

/** 誤差の円の半径 = 確定したときの誤差 + k × 確定してから進んだ距離。 */
export function errRadius(distSinceFix_m: number, errAtFix_m = FIX_ERR_M, k = DR_K): number {
  return errAtFix_m + k * Math.max(0, distSinceFix_m);
}

export type TrackStats = {
  surface_m: number;
  planar_m: number;
  ascent_m: number;
  descent_m: number;
  elapsed_s: number;
  avg_speed_mps: number;
};

/** 足あとの集計（歩いた距離・登り下り・経過時間）。 */
export function trackStats(points: TrackPoint[], R = MARS_RADIUS_M): TrackStats {
  let surface = 0;
  let planar = 0;
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dh = haversine(a, b, R);
    const dz = a.elev_m != null && b.elev_m != null ? b.elev_m - a.elev_m : 0;
    planar += dh;
    surface += Math.hypot(dh, dz);
    if (dz > 0) ascent += dz;
    else descent -= dz;
  }
  const elapsed =
    points.length >= 2
      ? (Date.parse(points[points.length - 1].t_utc) - Date.parse(points[0].t_utc)) / 1000
      : 0;
  return {
    surface_m: surface,
    planar_m: planar,
    ascent_m: ascent,
    descent_m: descent,
    elapsed_s: elapsed,
    avg_speed_mps: elapsed > 0 ? surface / elapsed : 0,
  };
}

/** 点 p から、予定ルート（[lat, lon] の列）までの最短距離（m）。 */
export function deviationFromRoute(p: LatLon, route: [number, number][], R = MARS_RADIUS_M): number {
  if (route.length === 0) return Infinity;
  const pp = { x: 0, y: 0 };
  let best = Infinity;
  let prev = toLocal(p, { lat: route[0][0], lon: route[0][1] }, R);
  if (route.length === 1) return Math.hypot(prev.x, prev.y);
  for (let i = 1; i < route.length; i++) {
    const cur = toLocal(p, { lat: route[i][0], lon: route[i][1] }, R);
    best = Math.min(best, pointToSegment(pp, prev, cur));
    prev = cur;
  }
  return best;
}

export const OFF_ROUTE_M = 30; // これ以上離れたら「予定ルートから外れています」

// ---- 通信遮断モード ----

/** 新しい点を記録するときの sent の値。圏外なら false（ためておく）。 */
export function sentFlagFor(online: boolean): boolean {
  return online;
}

export function countUnsent(points: TrackPoint[]): number {
  let n = 0;
  for (const p of points) if (!p.sent) n++;
  return n;
}

/** 通信が戻ったとき、未送信の点を古い順に最大 batch 件「送信済み」にした新しい配列を返す。 */
export function flushUnsent(points: TrackPoint[], batch = Infinity): TrackPoint[] {
  let left = batch;
  return points.map((p) => {
    if (!p.sent && left > 0) {
      left--;
      return { ...p, sent: true };
    }
    return p;
  });
}

/**
 * 予定ルートに沿った、現在地から終点までの残りの距離（設計書 07 の V-3）。
 * 現在地に最も近いルート上の点を求め、そこから終点までの長さを返す。
 *   remaining_m: ルートに沿った残りの距離（m）
 *   offRoute_m:  現在地からルートまでの距離（m）
 *   progress:    0〜1（ルートのどこまで進んだか）
 */
export function remainingAlongRoute(
  p: LatLon,
  route: [number, number][],
  R = MARS_RADIUS_M,
): { remaining_m: number; offRoute_m: number; progress: number } {
  if (route.length < 2) {
    const d = route.length ? haversine(p, { lat: route[0][0], lon: route[0][1] }, R) : Infinity;
    return { remaining_m: d, offRoute_m: d, progress: route.length ? 1 : 0 };
  }
  const pts = route.map(([lat, lon]) => toLocal(p, { lat, lon }, R));
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(l);
    total += l;
  }
  let best = Infinity;
  let bestAlong = 0;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-a.x * dx - a.y * dy) / len2));
    const d = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (d < best) {
      best = d;
      bestAlong = acc + t * seg[i - 1];
    }
    acc += seg[i - 1];
  }
  return { remaining_m: total - bestAlong, offRoute_m: best, progress: total > 0 ? bestAlong / total : 1 };
}
