import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { cellLatLon, idx, isBlocked, latLonToCell, type Grid, type LatLon } from '@core';
import type { Site } from './mapController';

type TargetWorld = { grid: Grid; slope: Float32Array; region: { slope_max_deg: number }; hazards: GeoJSON.FeatureCollection; targets: Site[] };

function inRing(p: LatLon, ring: GeoJSON.Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p.lat) !== (b[1] > p.lat) && p.lon < (b[0] - a[0]) * (p.lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function snapTarget(world: TargetWorld, point: LatLon): LatLon | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  const { grid, slope } = world;
  const allowed = (c: number, r: number): boolean => {
    if (c < 0 || r < 0 || c >= grid.width || r >= grid.height || isBlocked(grid, slope, idx(grid, c, r), world.region.slope_max_deg)) return false;
    const p = cellLatLon(grid, c, r);
    return !world.hazards.features.some((f) => {
      if (f.properties?.level !== 'no_go') return false;
      const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
      return polygons.some((rings) => inRing(p, rings[0]) && !rings.slice(1).some((ring) => inRing(p, ring)));
    });
  };
  const cell = latLonToCell(grid, point);
  if (cell && allowed(cell.c, cell.r)) return cellLatLon(grid, cell.c, cell.r);
  const origin = cellLatLon(grid, 0, 0), step = cellLatLon(grid, 1, 1);
  const c0 = Math.round((point.lon - origin.lon) / (step.lon - origin.lon));
  const r0 = Math.round((point.lat - origin.lat) / (step.lat - origin.lat));
  const candidates: { c: number; r: number; distance: number }[] = [];
  for (let dr = -30; dr <= 30; dr++) for (let dc = -30; dc <= 30; dc++) {
    const distance = dc * dc + dr * dr;
    if (distance <= 30 * 30) candidates.push({ c: c0 + dc, r: r0 + dr, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const found = candidates.find(({ c, r }) => allowed(c, r));
  return found ? cellLatLon(grid, found.c, found.r) : null;
}

export function useTargetEditing(world: TargetWorld | null, planning: boolean, setTargets: Dispatch<SetStateAction<Site[]>>, select: (id: string) => void, notify: (text: string) => void) {
  const move = useCallback((id: string, point: LatLon): LatLon | null => {
    if (!world || !planning) return null;
    const snapped = snapTarget(world, point);
    if (!snapped) { notify('ここには置けません。30マス以内に通れる地点がありません。'); return null; }
    setTargets((targets) => targets.map((t) => t.id === id ? { ...t, ...snapped, name: `${t.name.split('（')[0]}（移動済み）`, note: 'ドラッグで変更した目的地です' } : t));
    select(id);
    notify('目的地を移動しました。通れるマスに合わせてルートを再計算します。');
    return snapped;
  }, [world, planning, setTargets, select, notify]);
  const reset = useCallback(() => {
    if (!world || !planning) return;
    setTargets(world.targets);
    select(world.targets[0].id);
    notify('目的地を元の位置に戻しました。');
  }, [world, planning, setTargets, select, notify]);
  return { move, reset };
}
