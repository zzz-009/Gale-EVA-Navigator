import { cellLatLon, haversine, idx, latLonToCell, riskAt, type Grid, type LatLon } from '@core';

export type HeatImage = { url: string; bounds: [[number, number], [number, number]] };
type HeatWorld = { grid: Grid; slope: Float32Array; region: { slope_max_deg: number } };

const BANDS = [
  { rgb: [93, 202, 165], alpha: 0.25 },
  { rgb: [250, 199, 117], alpha: 0.4 },
  { rgb: [239, 127, 98], alpha: 0.5 },
  { rgb: [226, 75, 74], alpha: 0.6 },
];

export function renderRiskHeat(world: HeatWorld, center: LatLon, radius_m: number): HeatImage | null {
  const { grid, slope } = world;
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon) || !(radius_m > 0)) return null;
  const cell = latLonToCell(grid, center);
  if (!cell) return null;
  const origin = cellLatLon(grid, cell.c, cell.r);
  const dx = haversine(origin, cellLatLon(grid, cell.c + 1, cell.r));
  const dy = haversine(origin, cellLatLon(grid, cell.c, cell.r + 1));
  const cols = Math.ceil(radius_m / dx);
  const rows = Math.ceil(radius_m / dy);
  const west = Math.max(0, cell.c - cols);
  const east = Math.min(grid.width - 1, cell.c + cols);
  const north = Math.max(0, cell.r - rows);
  const south = Math.min(grid.height - 1, cell.r + rows);
  const canvas = document.createElement('canvas');
  canvas.width = east - west + 1;
  canvas.height = south - north + 1;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let r = north; r <= south; r++) {
    for (let c = west; c <= east; c++) {
      const i = idx(grid, c, r);
      const risk = riskAt(grid, slope, i, world.region.slope_max_deg);
      if (!risk || risk.band === 0) continue;
      const distance = haversine(center, cellLatLon(grid, c, r));
      if (distance >= radius_m) continue;
      const band = BANDS[risk.band - 1];
      const fade = Math.min(1, (radius_m - distance) / (radius_m * 0.3));
      const offset = ((r - north) * canvas.width + c - west) * 4;
      pixels.data[offset] = band.rgb[0];
      pixels.data[offset + 1] = band.rgb[1];
      pixels.data[offset + 2] = band.rgb[2];
      pixels.data[offset + 3] = Math.round(255 * band.alpha * fade);
    }
  }
  context.putImageData(pixels, 0, 0);
  // Overlay の境界はマスの中心でなく外縁に合わせる。
  const nw = cellLatLon(grid, west - 0.5, north - 0.5);
  const se = cellLatLon(grid, east + 0.5, south + 0.5);
  return { url: canvas.toDataURL(), bounds: [[se.lat, nw.lon], [nw.lat, se.lon]] };
}
