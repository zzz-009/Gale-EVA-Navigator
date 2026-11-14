import L from 'leaflet';
import { describe, expect, it } from 'vitest';
import { CRS_MARS } from './crsMars';

describe('Mars geographic CRS', () => {
  it('uses the Mars radius for an equatorial degree and map scale', () => {
    const metres = CRS_MARS.distance(L.latLng(0, 0), L.latLng(0, 1));
    expect(metres).toBeCloseTo(59274.6975, 3);
    expect(CRS_MARS.R).toBe(3396190);
    expect(L.CRS.Earth.distance(L.latLng(0, 0), L.latLng(0, 1))).toBeGreaterThan(111000);
  });

  it('keeps the WMTS geographic tile layout', () => {
    expect(CRS_MARS.latLngToPoint(L.latLng(90, -180), 0)).toEqual(L.point(0, 0));
    expect(CRS_MARS.latLngToPoint(L.latLng(-90, 180), 0)).toEqual(L.point(512, 256));
  });
});
