// 地形のグリッド。前処理（pipeline）が出力する region.json + *.f32 と同じ並び。
// 行 0 = 北の端、列 0 = 西の端。行優先（row-major）。

import { MARS_RADIUS_M, type LatLon } from './geo';

export type Grid = {
  width: number;
  height: number;
  cell_m: number; // マスの一辺（m）
  north: number; // 北の端の緯度（度）
  west: number; // 西の端の経度（度、東経）
  elev: Float32Array; // 標高（m）。値なしは NaN
  nogo?: Uint8Array; // 1 = 通行不可（危険エリアなど）
  rough?: Float32Array; // 起伏。0〜1 に正規化済み
  science?: Float32Array; // 科学的価値。0〜1
  radius_m?: number;
  dlat_deg?: number; // 1 マスの緯度の幅（度）。region.json にあればこれを使う（位置が正確になる）
  dlon_deg?: number; // 1 マスの経度の幅（度）
};

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const idx = (g: Grid, c: number, r: number): number => r * g.width + c;

function degPerCell(g: Grid): { dLat: number; dLon: number } {
  if (g.dlat_deg && g.dlon_deg) return { dLat: g.dlat_deg, dLon: g.dlon_deg };
  const R = g.radius_m ?? MARS_RADIUS_M;
  const dLat = (g.cell_m / R) * R2D;
  const midLat = g.north - (g.height / 2) * dLat;
  const dLon = (g.cell_m / (R * Math.cos(midLat * D2R))) * R2D;
  return { dLat, dLon };
}

/** マスの中心の緯度経度。 */
export function cellLatLon(g: Grid, c: number, r: number): LatLon {
  const { dLat, dLon } = degPerCell(g);
  return { lat: g.north - (r + 0.5) * dLat, lon: g.west + (c + 0.5) * dLon };
}

/** 緯度経度を含むマス。範囲外は null。 */
export function latLonToCell(g: Grid, p: LatLon): { c: number; r: number } | null {
  const { dLat, dLon } = degPerCell(g);
  const c = Math.floor((p.lon - g.west) / dLon);
  const r = Math.floor((g.north - p.lat) / dLat);
  if (c < 0 || r < 0 || c >= g.width || r >= g.height) return null;
  return { c, r };
}

/** 緯度経度の標高（最も近いマス）。範囲外・値なしは null。 */
export function elevAt(g: Grid, p: LatLon): number | null {
  const cell = latLonToCell(g, p);
  if (!cell) return null;
  const z = g.elev[idx(g, cell.c, cell.r)];
  return Number.isFinite(z) ? z : null;
}

/**
 * 傾斜（度）と、斜面の向き（最も急に下る方位。北 = 0、時計回り）。
 * 端のマスは片側の差分で計算する。標高が NaN のマスは傾斜も NaN。
 */
export function computeSlopeAspect(g: Grid): { slope: Float32Array; aspect: Float32Array } {
  const n = g.width * g.height;
  const slope = new Float32Array(n);
  const aspect = new Float32Array(n);
  const z = (c: number, r: number): number => g.elev[idx(g, c, r)];
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      const i = idx(g, c, r);
      const z0 = z(c, r);
      if (!Number.isFinite(z0)) {
        slope[i] = NaN;
        aspect[i] = NaN;
        continue;
      }
      const cW = c > 0 && Number.isFinite(z(c - 1, r)) ? c - 1 : c;
      const cE = c < g.width - 1 && Number.isFinite(z(c + 1, r)) ? c + 1 : c;
      const rN = r > 0 && Number.isFinite(z(c, r - 1)) ? r - 1 : r;
      const rS = r < g.height - 1 && Number.isFinite(z(c, r + 1)) ? r + 1 : r;
      const dzdx = cE === cW ? 0 : (z(cE, r) - z(cW, r)) / ((cE - cW) * g.cell_m); // 東向き
      const dzdy = rS === rN ? 0 : (z(c, rN) - z(c, rS)) / ((rS - rN) * g.cell_m); // 北向き
      slope[i] = Math.atan(Math.hypot(dzdx, dzdy)) * R2D;
      aspect[i] = (Math.atan2(-dzdx, -dzdy) * R2D + 360) % 360;
    }
  }
  return { slope, aspect };
}

/**
 * mask が 1 のマスまでの距離（m）。2 パスの面取り距離変換（8 方向）で求める近似値。
 */
export function distanceField(g: Grid, mask: Uint8Array): Float32Array {
  const { width: w, height: h } = g;
  const d = new Float32Array(w * h);
  const a = g.cell_m;
  const b = g.cell_m * Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : Infinity;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      let v = d[i];
      if (c > 0) v = Math.min(v, d[i - 1] + a);
      if (r > 0) {
        v = Math.min(v, d[i - w] + a);
        if (c > 0) v = Math.min(v, d[i - w - 1] + b);
        if (c < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let r = h - 1; r >= 0; r--) {
    for (let c = w - 1; c >= 0; c--) {
      const i = r * w + c;
      let v = d[i];
      if (c < w - 1) v = Math.min(v, d[i + 1] + a);
      if (r < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (c < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (c > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

/**
 * 科学的価値（0〜1）。急な崖の縁（地層がむき出しの露頭。傾斜 outcropDeg 以上）に近いほど高い。
 *   value = exp(−崖までの距離 / scale_m)
 * targets を渡すと、その近く（exp(−距離 / 200 m)）も高くする（大きい方を使う）。
 */
export function outcropScience(
  g: Grid,
  slope: Float32Array,
  outcropDeg = 15,
  scale_m = 60,
  targets: { c: number; r: number }[] = [],
): Float32Array {
  const mask = new Uint8Array(g.width * g.height);
  for (let i = 0; i < mask.length; i++) mask[i] = slope[i] >= outcropDeg ? 1 : 0;
  const dist = distanceField(g, mask);
  const out = new Float32Array(mask.length);
  for (let r = 0; r < g.height; r++) {
    for (let c = 0; c < g.width; c++) {
      const i = r * g.width + c;
      let v = Math.exp(-dist[i] / scale_m);
      for (const t of targets) v = Math.max(v, Math.exp((-Math.hypot(c - t.c, r - t.r) * g.cell_m) / 200));
      out[i] = v;
    }
  }
  return out;
}

/** 進む向き heading（度）に対する、横向きの傾き（度）。 */
export function crossSlopeDeg(slopeDeg: number, aspectDeg: number, headingDeg: number): number {
  const t = Math.tan(slopeDeg * D2R) * Math.abs(Math.sin((aspectDeg - headingDeg) * D2R));
  return Math.atan(t) * R2D;
}
