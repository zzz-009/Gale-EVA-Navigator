import { bearing, haversine, OFF_ROUTE_M, remainingAlongRoute, walkSpeed, type LatLon } from '@core';

export type DestinationInfo = { name: string; fromBase: boolean; straight_m: number; remaining_m: number | null; heading_deg: number; offRoute: boolean; eta_min: number; distance_m: number };
export function destinationInfo(position: LatLon | null, target: (LatLon & { name: string }) | null, coords: [number, number][] | null, fromBase: boolean): DestinationInfo | null {
  if (!position || !target) return null;
  const straight = haversine(position, target);
  const along = coords?.length ? remainingAlongRoute(position, coords) : null;
  const offRoute = !!along && along.offRoute_m >= OFF_ROUTE_M;
  const remaining = along && Number.isFinite(along.remaining_m) ? along.remaining_m : null;
  const distance = !offRoute && remaining !== null ? remaining : straight;
  return { name: target.name, fromBase, straight_m: straight, remaining_m: remaining, heading_deg: bearing(position, target), offRoute, eta_min: distance / walkSpeed(0) / 60, distance_m: distance };
}
export const distanceText = (metres: number): string => metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
