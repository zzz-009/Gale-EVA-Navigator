import { bearing, haversine, type LatLon, type TrackPoint } from '@core';
import type { HealthState } from './health';
import type { PositionFix } from './position/source';

export const COMM_SIMULATION = { peak_kbps: 2000, minimum_ratio: 0.1, range_m: 3000, base_latency_ms: 50, latency_distance_m: 100 } as const;

export function simulateComm(distance_m: number, online: boolean) {
  const c = COMM_SIMULATION;
  return { simulated: true as const, online,
    downlink_kbps: online ? Math.round(c.peak_kbps * Math.max(c.minimum_ratio, 1 - distance_m / c.range_m)) : 0,
    latency_ms: online ? Math.round(c.base_latency_ms + distance_m / c.latency_distance_m) : null };
}

export function measurementFrom(point: TrackPoint, base: LatLon, online: boolean, health: HealthState, source: PositionFix['source']) {
  const distance = haversine(base, point);
  return {
    t_utc: point.t_utc, sol: point.sol, lmst: point.lmst.slice(0, 5),
    lat: Number(point.lat.toFixed(6)), lon: Number(point.lon.toFixed(6)), elev_m: point.elev_m,
    accuracy_m: Math.round(point.err_m), position_source: source,
    distance_from_base_m: Math.round(distance), bearing_from_base_deg: Math.round(bearing(base, point)) % 360,
    comm: simulateComm(distance, online),
    health: { ...health, simulated: true as const, warnings: [...health.warnings] },
  };
}

export type Measurement = ReturnType<typeof measurementFrom>;
type ExportMeta = { exported_utc: string; terrain: string; base: LatLon; health_display_on: boolean };
export function exportDocument(records: readonly Measurement[], meta: ExportMeta) {
  const c = COMM_SIMULATION;
  return {
    format: 'gale-eva-measurements/1', app: 'Gale EVA Navigator', exported_utc: meta.exported_utc,
    notes: {
      position: '衛星測位は将来の測位衛星を仮定。圏外では推測航法（誤差は 5 m + 進んだ距離の 3%）。移動シミュレーションも含む',
      comm: `通信速度はシミュレーション（基地の近くの中継局を仮定。実測ではない）: 通信可のとき ${c.peak_kbps} kbps × max(${c.minimum_ratio}, 1 − 距離/${c.range_m})、遅れ ${c.base_latency_ms} ms + 距離/${c.latency_distance_m}`,
      health: '健康状態はシミュレーション。注意の目安は仮の値で、医療的な判定ではない',
    },
    terrain: meta.terrain, base: { lat: Number(meta.base.lat.toFixed(6)), lon: Number(meta.base.lon.toFixed(6)) },
    health_display_on: meta.health_display_on, count: records.length, records: [...records],
  };
}

// The only side-effectful helper: serialization and browser download happen on request.
export function downloadJson(doc: ReturnType<typeof exportDocument>, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
