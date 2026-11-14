import { elevAt, type Grid, type TrackPoint } from '@core';
import { stamp } from '../sim';

export type PositionFix = {
  t_utc: string; lat: number; lon: number; heading_deg?: number; accuracy_m: number;
  source: 'satellite' | 'dead_reckoning' | 'simulation';
  trackPoint?: TrackPoint;
};
export interface PositionSource {
  start(onFix: (fix: PositionFix) => void): void;
  stop(): void;
}
export interface ReplaySource extends PositionSource {
  setSpeed(speed: number): void;
  setOnline(online: boolean): void;
}
export function fixToTrack(fix: PositionFix, grid: Grid, sent: boolean, id: string): TrackPoint {
  if (fix.trackPoint) return { ...fix.trackPoint, sent };
  return { id, ...stamp(Date.parse(fix.t_utc), fix.lon), lat: fix.lat, lon: fix.lon,
    elev_m: elevAt(grid, fix), heading_deg: fix.heading_deg ?? 0, err_m: fix.accuracy_m,
    src: fix.source === 'satellite' ? 'fix' : 'dr', sent, simulated: true,
    note: fix.source === 'satellite' ? '衛星測位（将来の測位衛星を仮定・テスト）' : '衛星未受信・推測航法（シミュレーション）' };
}

export function positionLabel(source: PositionFix['source'], online: boolean): string {
  if (source === 'simulation') return '移動シミュレーション';
  if (!online || source === 'dead_reckoning') return '推測航法（衛星未受信・測位衛星は仮定）';
  return '衛星測位（将来の測位衛星を仮定）';
}
