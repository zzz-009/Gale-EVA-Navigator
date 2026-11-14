import { bearing, type Grid, type LatLon, type Route, type TrackPoint } from '@core';
import type { RegionMeta, Site } from './mapController';
import type { DestinationInfo } from './navigation';
import type { BaseMapMode } from './baseMap';
import type { PositionFix } from './position/source';
import type { HealthState } from './health';

export type HudWorld = { grid: Grid; slope: Float32Array; region: RegionMeta & { slope_max_deg: number }; hazards: GeoJSON.FeatureCollection; base: Site };
export type FieldPosition = { position: LatLon | null; heading: number; accuracy: number };
export type HudState = FieldPosition & {
  health: HealthState; healthOn: boolean;
  overviewOn: boolean;
  online: boolean; source: PositionFix['source']; destination: DestinationInfo | null; warning: string | null;
  baseMapMode: BaseMapMode; route: Route | null; track: TrackPoint[]; targets: Site[];
};
export function fieldPosition(pos: TrackPoint | null, backPos: LatLon | null, path: LatLon[], index: number, progress: number): FieldPosition {
  const previous = path[Math.max(0, index - 1)];
  return { position: backPos ?? pos, heading: backPos && previous ? bearing(previous, backPos) : pos?.heading_deg ?? 0,
    accuracy: pos ? (backPos ? Math.max(5, pos.err_m * (1 - progress)) : pos.err_m) : 0 };
}
export function fieldWarning(offRoute: boolean, weather: string | null, limit: { level: string; text: string } | null, health?: HealthState): string | null {
  if (health?.warnings.length) return `${limit && limit.level !== 'green' ? `${limit.text} / ` : ''}健康状態（シミュレーション・目安は仮の値）: ${health.warnings.join('、')}`;
  if (limit && limit.level !== 'green') return limit.text;
  if (offRoute) return 'ルートから外れています。足あとと地形を確認してください。';
  return weather;
}
