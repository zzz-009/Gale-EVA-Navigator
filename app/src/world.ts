import { cellLatLon, computeSlopeAspect, haversine, latLonToCell, idx, type Grid, type Landmark } from '@core';
import type { Site } from './mapController';
import type { HazardSettings } from './hazardText';

export type World = {
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

export async function loadWorld(): Promise<World> {
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

  const site = (id: string, name: string, lat: number, lon: number, note?: string): Site => {
    const { c, r } = latLonToCell(grid, { lat, lon }) ?? {
      c: Math.floor(grid.width / 2), r: Math.floor(grid.height / 2),
    };
    const f = freeCell(grid, slope, c, r);
    return { id, name, ...cellLatLon(grid, f.c, f.r), note };
  };
  const base = site('base', '基地', -4.692590, 137.370200);
  // 目的地は、ルートの差が出る場所を実際に計算して選んだ
  const targets = [
    site('T1', '目標A（東の露頭）', -4.704539, 137.410824, '崖の縁にむき出しになった地層を調べる'),
    site('T2', '目標B（尾根の先）', -4.711366, 137.396657, '尾根の先の岩石を採取する'),
    site('T3', '目標C（崖の南）', -4.725021, 137.410312, '崖の下の堆積物を調べる（崖を越える必要がある）'),
  ];

  // 目印: 大きい急斜面のエリアの中心（公式の地名ではないので、仮の名前）
  const nearbyCliffs = (hazards as GeoJSON.FeatureCollection).features
    .filter((feature) => feature.properties?.level === 'no_go' && feature.geometry.type === 'Polygon')
    .map((feature) => {
      const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0];
      const lon = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
      const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
      return { feature, lat, lon };
    })
    .filter((cliff) => haversine(base, cliff) <= 3000)
    .sort((a, b) => (b.feature.properties?.area_m2 ?? 0) - (a.feature.properties?.area_m2 ?? 0))
    .slice(0, 6);
  const landmarks: Landmark[] = nearbyCliffs.map(({ lat, lon }, i) => ({
    id: `L${i}`, name: `目印${'ABCDEF'[i]}`, lat, lon, kind: '急な崖',
  }));

  return { grid, slope, aspect, region, contours, hazards, base, targets, landmarks };
}
