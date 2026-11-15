import { afterEach, expect, it, vi } from 'vitest';
import { bearing, haversine, type TrackPoint } from '@core';
import { downloadJson, exportDocument, measurementFrom, simulateComm } from './measurementLog';
import type { HealthState } from './health';

const base = { lat: -4.69, lon: 137.37 };
const point: TrackPoint = { id: 'test', t_utc: '2026-11-15T02:35:00.000Z', sol: 5074, lmst: '10:32:15',
  lat: -4.70012345, lon: 137.38001234, elev_m: -4321.5, err_m: 12.4, heading_deg: 0, src: 'dr', sent: false, simulated: true };
const health: HealthState = { simulated: true, heartRate: 104, co2: .52, temperature: 37,
  oxygen_min: 402, battery_pct: 88, warnings: [] };
const meta = { exported_utc: point.t_utc, terrain: 'test DTM', base, health_display_on: false };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('simulates the specified communication rate, floor, latency and outage', () => {
  expect(simulateComm(1500, true)).toEqual({ simulated: true, online: true, downlink_kbps: 1000, latency_ms: 65 });
  for (const distance of [3000, 6000]) expect(simulateComm(distance, true).downlink_kbps).toBe(200);
  expect(simulateComm(1500, false)).toEqual({ simulated: true, online: false, downlink_kbps: 0, latency_ms: null });
});

it('records rounded Mars distance/bearing, position source and independent health values', () => {
  const record = measurementFrom(point, base, false, health, 'dead_reckoning');
  expect(record.distance_from_base_m).toBe(Math.round(haversine(base, point)));
  expect(record.bearing_from_base_deg).toBe(Math.round(bearing(base, point)) % 360);
  expect(record).toMatchObject({ lat: -4.700123, lon: 137.380012, accuracy_m: 12, lmst: '10:32', elev_m: -4321.5, position_source: 'dead_reckoning' });
  expect(record.comm.simulated).toBe(true);
  expect(record.health.simulated).toBe(true);
  expect(record.health.warnings).not.toBe(health.warnings);
});

it('exports health even when hidden and explicitly labels simulations', () => {
  const records = [measurementFrom(point, base, true, health, 'simulation')];
  const doc = exportDocument(records, meta);
  expect(doc).toMatchObject({ format: 'gale-eva-measurements/1', app: 'Gale EVA Navigator', count: 1, health_display_on: false, terrain: meta.terrain });
  expect(doc.notes.comm).toContain('シミュレーション');
  expect(doc.notes.health).toContain('シミュレーション');
  expect(doc.records[0].health).toEqual(health);
  records.push(records[0]);
  expect(doc.records).toHaveLength(1);
});

it('downloads JSON with the given filename and releases the object URL', () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:test');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('gale-eva-measurements-sol5074-1032.json');
    expect(this.href).toBe('blob:test');
    expect(this.isConnected).toBe(true);
  });
  downloadJson(exportDocument([], meta), 'gale-eva-measurements-sol5074-1032.json');
  expect(click).toHaveBeenCalledOnce();
  expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect(document.querySelector('a[download]')).toBeNull();
  vi.runAllTimers();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
});
