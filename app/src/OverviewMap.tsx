import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { fromLocal } from '@core';
import { MiniMap } from './miniMap';
import { ROUTE_COLOR } from './mapController';
import type { HudState, HudWorld } from './fieldState';

export function OverviewMap({ world, state }: { world: HudWorld; state: HudState }) {
  const el = useRef<HTMLDivElement>(null);
  const overview = useRef<MiniMap | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const map = new MiniMap(el.current, world.region, () => {}); overview.current = map;
    return () => { overview.current = null; map.destroy(); };
  }, [world]);
  useEffect(() => { overview.current?.setSites(world.base, state.targets); }, [world, state.targets]);
  useEffect(() => { overview.current?.setRoute(state.route?.coords ?? [], ROUTE_COLOR[state.route?.preset ?? 'safe']); }, [world, state.route]);
  useEffect(() => { overview.current?.setTrack(state.track); }, [world, state.track]);
  useEffect(() => { overview.current?.setBaseMap(state.baseMapMode); }, [world, state.baseMapMode]);
  useEffect(() => {
    overview.current?.setExplorer(state.position);
    const center = state.position ?? world.base;
    const sw = fromLocal(center, { x: -300, y: -300 }), ne = fromLocal(center, { x: 300, y: 300 });
    overview.current?.setViewport(L.latLngBounds([sw.lat, sw.lon], [ne.lat, ne.lon]));
  }, [world, state.position?.lat, state.position?.lon]);
  return <div ref={el} className="hud-overview" aria-label="活動地域の全体図" />;
}
