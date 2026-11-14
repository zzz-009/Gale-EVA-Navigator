import { haversine, type TrackPoint } from '@core';

// 訓練シナリオの仮の注意値。医療的な判定ではない。
export const HEALTH_LIMITS = { heartRate: 140, co2: 1, temperature: 38, battery: 20 };
export type HealthState = { simulated: true; heartRate: number; co2: number; temperature: number; oxygen_min: number; battery_pct: number; warnings: string[] };
export function simulateHealth(track: TrackPoint[], elapsed_s: number, oxygen_min: number, battery_pct: number, returnLevel?: string): HealthState {
  const last = track[track.length - 1], previous = track[track.length - 2];
  const distance = last && previous ? haversine(last, previous) : 0;
  const uphill = distance > 0 && last.elev_m != null && previous.elev_m != null ? Math.max(0, (last.elev_m - previous.elev_m) / distance) : 0;
  const hours = Math.max(0, elapsed_s) / 3600;
  const heartRate = Math.round(92 + Math.min(65, uphill * 180) + 4 * Math.sin(elapsed_s / 90));
  const co2 = Number((0.4 + Math.min(0.8, hours * 0.08 + uphill * 0.2)).toFixed(2));
  const temperature = Number((36.8 + Math.min(1.5, hours * 0.12 + uphill)).toFixed(1));
  const warnings: string[] = [];
  if (heartRate >= HEALTH_LIMITS.heartRate) warnings.push('心拍数が注意の目安以上');
  if (co2 >= HEALTH_LIMITS.co2) warnings.push('宇宙服のCO₂が注意の目安以上');
  if (temperature >= HEALTH_LIMITS.temperature) warnings.push('体温が注意の目安以上');
  if (battery_pct <= HEALTH_LIMITS.battery) warnings.push('バッテリー残量に注意');
  if (oxygen_min <= 0 || (returnLevel && returnLevel !== 'green')) warnings.push('酸素・帰還の限界を確認');
  return { simulated: true, heartRate, co2, temperature, oxygen_min, battery_pct, warnings };
}
