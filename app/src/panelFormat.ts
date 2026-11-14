import type { LatLon } from '@core';
export const fmtKm = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
export const fmtDur = (s: number): string => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} 分`;
};
export const fmtLatLon = (p: LatLon): string => `${Math.abs(p.lat).toFixed(4)}°${p.lat < 0 ? 'S' : 'N'}, ${p.lon.toFixed(4)}°E`;
