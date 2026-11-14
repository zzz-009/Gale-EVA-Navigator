// 球面上の距離・方位の計算。半径の初期値は火星（地図の座標系 CRS_MARS と同じ値）。

export const MARS_RADIUS_M = 3396190;
export const MOON_RADIUS_M = 1737400;

export type LatLon = { lat: number; lon: number };
export type XY = { x: number; y: number }; // x = 東向き（m）、y = 北向き（m）

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** 大円距離（m）。 */
export function haversine(a: LatLon, b: LatLon, R = MARS_RADIUS_M): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** a から b への方位（度）。北 = 0、時計回り、0〜360。 */
export function bearing(a: LatLon, b: LatLon): number {
  const p1 = a.lat * D2R;
  const p2 = b.lat * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** 方位の差 b − a（度）。−180〜180。正 = 時計回り（右）。 */
export function angleDiff(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** origin を原点にした平面座標（m）。数 km の範囲で使う近似。 */
export function toLocal(origin: LatLon, p: LatLon, R = MARS_RADIUS_M): XY {
  const x = (p.lon - origin.lon) * D2R * R * Math.cos(origin.lat * D2R);
  const y = (p.lat - origin.lat) * D2R * R;
  return { x, y };
}

export function fromLocal(origin: LatLon, xy: XY, R = MARS_RADIUS_M): LatLon {
  return {
    lat: origin.lat + (xy.y / R) * R2D,
    lon: origin.lon + (xy.x / (R * Math.cos(origin.lat * D2R))) * R2D,
  };
}

/** 平面上で、点 p から線分 ab までの最短距離（m）。 */
export function pointToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 平面座標での方位（度）。北 = 0、時計回り。 */
export function bearingXY(a: XY, b: XY): number {
  return (Math.atan2(b.x - a.x, b.y - a.y) * R2D + 360) % 360;
}
