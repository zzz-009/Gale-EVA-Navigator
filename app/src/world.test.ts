import { afterEach, expect, it, vi } from 'vitest';
import { cellLatLon, fromLocal, haversine, type Grid } from '@core';
import { loadWorld } from './world';

afterEach(() => vi.unstubAllGlobals());

function mockData(region: object, elevation: Float32Array, hazards: GeoJSON.FeatureCollection) {
  vi.stubGlobal('fetch', async (url: string) => ({
    ok: true,
    json: async () => url.endsWith('region.json') ? region : url.endsWith('hazard_zones.geojson') ? hazards : { type: 'FeatureCollection', features: [] },
    arrayBuffer: async () => url.endsWith('elev.f32') ? elevation.buffer : new Float32Array(elevation.length).buffer,
  }));
}

it('uses geographic positions on a larger grid and ranks only cliffs within 3 km', async () => {
  const region = { north: -4.65, south: -4.8, west: 137.3, east: 137.5, width: 200, height: 150, dlat_deg: .001, dlon_deg: .001, cell_m: 59.3 };
  const base = { lat: -4.6925, lon: 137.3705 };
  const features: GeoJSON.Feature[] = Array.from({ length: 8 }, (_, i) => {
    const p = fromLocal(base, { x: i === 7 ? 4000 : 100 * i, y: 0 });
    return { type: 'Feature', properties: { level: 'no_go', area_m2: i + 1 }, geometry: { type: 'Polygon', coordinates: [[[p.lon, p.lat], [p.lon, p.lat], [p.lon, p.lat], [p.lon, p.lat]]] } };
  });
  mockData(region, new Float32Array(30000), { type: 'FeatureCollection', features });
  const world = await loadWorld();
  expect(world.base.lat).toBeCloseTo(base.lat, 9);
  expect(world.base.lon).toBeCloseTo(base.lon, 9);
  expect(world.targets[0].lat).toBeCloseTo(-4.7045, 9);
  expect(world.targets[0].lon).toBeCloseTo(137.4105, 9);
  expect(world.landmarks).toHaveLength(6);
  expect(haversine(world.base, world.landmarks[0])).toBeCloseTo(600, 3);
  expect(haversine(world.base, world.landmarks[5])).toBeCloseTo(100, 3);
});

it('falls back to the central cell when the requested sites are outside the region', async () => {
  const region = { north: 1, west: 0, width: 10, height: 10, cell_m: 10 };
  const elevation = new Float32Array(100);
  mockData(region, elevation, { type: 'FeatureCollection', features: [] });
  const world = await loadWorld();
  const center = cellLatLon({ ...region, elev: elevation } as Grid, 5, 5);
  for (const site of [world.base, ...world.targets]) expect({ lat: site.lat, lon: site.lon }).toEqual(center);
});
