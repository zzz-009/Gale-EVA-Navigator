// とんぼ返り（来た道を引き返す）。設計書 docs/design/03_tracback.md の 5 章。
// 案内文は計算結果からテンプレートで作る（生成 AI は使わない）。

import {
  angleDiff,
  bearingXY,
  haversine,
  bearing,
  toLocal,
  MARS_RADIUS_M,
  type LatLon,
  type XY,
} from './geo';
import type { TrackPoint } from './track';
import { DEFAULT_V0, walkSpeed } from './walkSpeed';

export type Landmark = { id: string; name: string; lat: number; lon: number; kind?: string };

export type Maneuver = {
  index: number;
  at: [number, number]; // この案内が始まる地点 [lat, lon]
  bearing_deg: number;
  distance_m: number;
  grade_deg: number; // 正 = 登り
  landmark?: { id: string; name: string; side: 'left' | 'right' | 'ahead' };
  text: string;
};

export type TracBackPlan = {
  coords: [number, number][]; // 戻るルート（今の足あとの点 → 基地）
  maneuvers: Maneuver[];
  total_m: number;
  est_time_s: number;
};

export type TracBackOptions = {
  turnDeg?: number; // これ以上向きが変わる点を曲がり角にする（初期値 30）
  minTol_m?: number; // 線を単純化するときの許容幅の下限（初期値 5）
  maxTol_m?: number; // 同じく上限（初期値 15）。誤差が大きくても、道を大きく切り落とさないため
  landmarkRange_m?: number; // 案内に使う目印の範囲（初期値 300）
  v0?: number;
  R?: number;
};

/**
 * いちばん近い足あとの点。スコア = 距離 + 0.5 × その点の誤差の半径（位置が確かな点ほど選ばれやすい）。
 */
export function nearestBreadcrumb(
  pos: LatLon,
  track: TrackPoint[],
  R = MARS_RADIUS_M,
): { index: number; distance_m: number; bearing_deg: number } | null {
  let best = -1;
  let bestScore = Infinity;
  let bestDist = 0;
  for (let i = 0; i < track.length; i++) {
    const d = haversine(pos, track[i], R);
    const score = d + 0.5 * track[i].err_m;
    if (score < bestScore) {
      bestScore = score;
      best = i;
      bestDist = d;
    }
  }
  if (best < 0) return null;
  return { index: best, distance_m: bestDist, bearing_deg: bearing(pos, track[best]) };
}

/** 最後に位置を確定した点（src = 'fix'）の添字。なければ −1。 */
export function lastFixIndex(track: TrackPoint[]): number {
  for (let i = track.length - 1; i >= 0; i--) if (track[i].src === 'fix') return i;
  return -1;
}

/**
 * 線の単純化（Douglas–Peucker 法）。残す点の添字を返す。
 * 許容幅は区間ごとに clamp(その区間の最大の誤差, minTol, maxTol)。
 */
export function simplify(pts: XY[], err: number[], minTol = 5, maxTol = 15): number[] {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    if (b - a < 2) continue;
    let maxD = -1;
    let maxI = -1;
    let maxErr = 0;
    const dx = pts[b].x - pts[a].x;
    const dy = pts[b].y - pts[a].y;
    const len = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const d =
        len === 0
          ? Math.hypot(pts[i].x - pts[a].x, pts[i].y - pts[a].y)
          : Math.abs(dy * (pts[i].x - pts[a].x) - dx * (pts[i].y - pts[a].y)) / len;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
      if (err[i] > maxErr) maxErr = err[i];
    }
    const tol = Math.max(minTol, Math.min(maxTol, maxErr));
    if (maxD > tol) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** 進む向きに対して、目印が正面・右手・左手のどこにあるか。後ろなら null。 */
export function landmarkSide(headingDeg: number, bearingToLandmarkDeg: number): 'left' | 'right' | 'ahead' | null {
  const rel = angleDiff(headingDeg, bearingToLandmarkDeg);
  if (Math.abs(rel) <= 45) return 'ahead';
  if (rel > 45 && rel <= 135) return 'right';
  if (rel < -45 && rel >= -135) return 'left';
  return null;
}

const SIDE_TEXT = { left: '左手', right: '右手', ahead: '正面' } as const;

function maneuverText(m: Omit<Maneuver, 'text'>, isLast: boolean): string {
  const dist = `${Math.round(m.distance_m)} m`;
  const brg = `方位 ${Math.round(m.bearing_deg) % 360}°`;
  let s = m.landmark
    ? `${m.landmark.name}を${SIDE_TEXT[m.landmark.side]}に見て、${brg} へ ${dist}`
    : `${brg} へ ${dist}`;
  if (Math.abs(m.grade_deg) >= 3) {
    s += `。${m.grade_deg > 0 ? '登り' : '下り'} ${Math.abs(m.grade_deg).toFixed(0)}°`;
  }
  if (isLast) s += '。その先が基地です';
  return s;
}

/**
 * とんぼ返りのルートを作る。
 * track[0] が基地（出発点）。track[fromIndex] から基地へ、足あとを逆にたどる。
 * fromIndex より後の点（迷ってからの点）は使わない。
 */
export function buildTracBack(
  track: TrackPoint[],
  fromIndex: number,
  landmarks: Landmark[] = [],
  opt: TracBackOptions = {},
): TracBackPlan {
  const R = opt.R ?? MARS_RADIUS_M;
  const turnDeg = opt.turnDeg ?? 30;
  const v0 = opt.v0 ?? DEFAULT_V0;
  const range = opt.landmarkRange_m ?? 300;

  const back = track.slice(0, fromIndex + 1).reverse(); // 今の足あとの点 → 基地
  if (back.length < 2) {
    return {
      coords: back.map((p) => [p.lat, p.lon] as [number, number]),
      maneuvers: [],
      total_m: 0,
      est_time_s: 0,
    };
  }

  const origin: LatLon = back[back.length - 1]; // 基地
  const xy = back.map((p) => toLocal(origin, p, R));
  const kept = simplify(
    xy,
    back.map((p) => p.err_m),
    opt.minTol_m ?? 5,
    opt.maxTol_m ?? 15,
  );
  const v = kept.map((i) => back[i]);
  const vxy = kept.map((i) => xy[i]);
  const lmXY = landmarks.map((l) => toLocal(origin, l, R));

  // 区間（単純化した線の頂点の間）
  type Leg = { len: number; brg: number; dz: number };
  const legs: Leg[] = [];
  for (let i = 1; i < v.length; i++) {
    const a = v[i - 1];
    const b = v[i];
    legs.push({
      len: Math.hypot(vxy[i].x - vxy[i - 1].x, vxy[i].y - vxy[i - 1].y),
      brg: bearingXY(vxy[i - 1], vxy[i]),
      dz: a.elev_m != null && b.elev_m != null ? b.elev_m - a.elev_m : 0,
    });
  }

  // 向きが turnDeg 以上変わるところで案内を区切る
  const groups: [number, number][] = []; // [最初の区間, 最後の区間]
  let gStart = 0;
  for (let i = 1; i < legs.length; i++) {
    if (Math.abs(angleDiff(legs[i - 1].brg, legs[i].brg)) >= turnDeg) {
      groups.push([gStart, i - 1]);
      gStart = i;
    }
  }
  groups.push([gStart, legs.length - 1]);

  let total = 0;
  let time = 0;
  const maneuvers: Maneuver[] = groups.map(([a, b], gi) => {
    let dist = 0;
    let dz = 0;
    for (let i = a; i <= b; i++) {
      dist += legs[i].len;
      dz += legs[i].dz;
      const grade = legs[i].len > 0 ? legs[i].dz / legs[i].len : 0;
      time += Math.hypot(legs[i].len, legs[i].dz) / walkSpeed(grade, v0);
    }
    total += dist;
    const p0 = vxy[a];
    const p1 = vxy[b + 1];
    const brg = bearingXY(p0, p1);
    const mid: XY = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };

    let lm: Maneuver['landmark'];
    let bestD = range;
    for (let k = 0; k < landmarks.length; k++) {
      const d = Math.hypot(lmXY[k].x - mid.x, lmXY[k].y - mid.y);
      if (d > bestD) continue;
      const side = landmarkSide(brg, bearingXY(mid, lmXY[k]));
      if (!side) continue;
      bestD = d;
      lm = { id: landmarks[k].id, name: landmarks[k].name, side };
    }

    const base: Omit<Maneuver, 'text'> = {
      index: gi,
      at: [v[a].lat, v[a].lon],
      bearing_deg: brg,
      distance_m: dist,
      grade_deg: dist > 0 ? (Math.atan(dz / dist) * 180) / Math.PI : 0,
      landmark: lm,
    };
    return { ...base, text: maneuverText(base, gi === groups.length - 1) };
  });

  return {
    coords: v.map((p) => [p.lat, p.lon] as [number, number]),
    maneuvers,
    total_m: total,
    est_time_s: time,
  };
}

export type ReturnLimit = {
  t_back_min: number; // 余裕を含めた、戻りの所要時間（分）
  margin_min: number; // 戻り始めるまでに残っている時間（分）
  level: 'green' | 'amber' | 'red';
  text: string;
};

/**
 * 帰還の限界。戻りの所要時間 × 余裕（初期値 1.3）を、酸素・バッテリーの残り時間と比べる。
 * 残りが 30 分以上 = 緑、10〜30 分 = 黄、10 分未満 = 赤。
 */
export function returnLimit(
  est_time_s: number,
  o2_min: number,
  battery_min: number,
  safety = 1.3,
): ReturnLimit {
  const tBack = (est_time_s * safety) / 60;
  const margin = Math.min(o2_min, battery_min) - tBack;
  const level = margin >= 30 ? 'green' : margin >= 10 ? 'amber' : 'red';
  const text =
    level === 'red'
      ? 'すぐに戻り始めてください'
      : `あと ${Math.floor(margin)} 分以内に戻り始めてください`;
  return { t_back_min: tBack, margin_min: margin, level, text };
}
