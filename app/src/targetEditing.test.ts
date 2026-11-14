import { describe, expect, it } from 'vitest';
import { cellLatLon, idx, latLonToCell, type Grid } from '@core';
import { snapTarget } from './targetEditing';

// 合成地形でのドラッグ補正。実際の活動地域の座標ではない。
function world() {
  const grid: Grid = { width: 70, height: 70, north: 1, west: 0, cell_m: 10, elev: new Float32Array(4900) };
  return { grid, slope: new Float32Array(4900), region: { slope_max_deg: 20 }, hazards: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection, targets: [] };
}
describe('目的地のドラッグ補正', () => {
  it('通行不可のマスを避け、30マス以内に候補がなければ拒否する', () => {
    const w = world(), point = cellLatLon(w.grid, 35, 35);
    w.slope[idx(w.grid, 35, 35)] = 25;
    const accepted = snapTarget(w, point)!;
    expect(accepted).not.toEqual(point);
    const cell = latLonToCell(w.grid, accepted)!;
    expect(w.slope[idx(w.grid, cell.c, cell.r)]).toBe(0);
    w.slope.fill(25); expect(snapTarget(w, point)).toBeNull();
    expect(snapTarget(world(), cellLatLon(w.grid, -31, 35))).toBeNull();
  });
  it('傾斜が緩くてもno_go多角形の中は目的地にしない', () => {
    const w = world(), point = cellLatLon(w.grid, 35, 35);
    const nw = cellLatLon(w.grid, 34, 34), se = cellLatLon(w.grid, 36, 36);
    w.hazards.features.push({ type: 'Feature', properties: { level: 'no_go' }, geometry: { type: 'Polygon', coordinates: [[[nw.lon, nw.lat], [se.lon, nw.lat], [se.lon, se.lat], [nw.lon, se.lat], [nw.lon, nw.lat]]] } });
    const accepted = snapTarget(w, point)!;
    expect(accepted).not.toBeNull();
    expect(accepted.lon < nw.lon || accepted.lon > se.lon || accepted.lat > nw.lat || accepted.lat < se.lat).toBe(true);
  });
});
