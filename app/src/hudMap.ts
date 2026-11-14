import L from 'leaflet';
import { fromLocal, haversine, type LatLon, type Route, type TrackPoint } from '@core';
import { CRS_MARS } from './lib/crsMars';
import { BaseMap, type BaseMapMode } from './baseMap';
import { renderRiskHeat } from './heatmap';
import { ROUTE_COLOR } from './mapController';
import { ExplorerMarker } from './position/explorerMarker';
import type { HudWorld } from './fieldState';

export class HudMap {
  readonly map: L.Map;
  private background: BaseMap;
  private explorer: ExplorerMarker;
  private heat: L.ImageOverlay | null = null;
  private heatCenter: LatLon | null = null;
  private routes = L.layerGroup();
  private track = L.polyline([], { color: '#fff', weight: 3, interactive: false });
  private outline = L.polyline([], { color: '#000', weight: 6, interactive: false });
  private observer: ResizeObserver;
  private center: LatLon;
  constructor(el: HTMLElement, private world: HudWorld) {
    this.center = world.base;
    this.map = L.map(el, { crs: CRS_MARS, zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, zoomAnimation: false, fadeAnimation: false, zoomSnap: 0.1, maxZoom: 16 });
    try {
    this.map.setView([this.center.lat, this.center.lon], 15, { animate: false });
    this.background = new BaseMap(this.map);
    const pane = this.map.createPane('heat'); pane.style.zIndex = '350'; pane.style.pointerEvents = 'none';
    L.geoJSON(world.hazards, { interactive: false, style: { color: '#ef7f62', weight: 1, fillOpacity: 0.25, dashArray: '7 5' } }).addTo(this.map);
    this.routes.addTo(this.map); this.outline.addTo(this.map); this.track.addTo(this.map);
    this.explorer = new ExplorerMarker(this.map);
    this.fit();
    this.observer = new ResizeObserver(() => { this.map.invalidateSize(); this.fit(); });
    this.observer.observe(el);
    } catch (error) {
      this.map.remove();
      throw error;
    }
  }
  private fit(): void {
    const size = this.map.getSize();
    if (size.x <= 0 || size.y <= 0) return;
    // 回転用の箱は表示窓の√2倍。窓に見える半径を約300mにする。
    const sw = fromLocal(this.center, { x: -300 * Math.SQRT2, y: -300 * Math.SQRT2 });
    const ne = fromLocal(this.center, { x: 300 * Math.SQRT2, y: 300 * Math.SQRT2 });
    this.map.fitBounds([[sw.lat, sw.lon], [ne.lat, ne.lon]], { animate: false });
  }
  setPosition(position: LatLon | null, heading: number, accuracy: number): void {
    this.center = position ?? this.world.base; this.fit();
    this.explorer.update(position, accuracy, heading);
    if (this.heatCenter && haversine(this.heatCenter, this.center) < 20) return;
    this.heatCenter = this.center;
    const image = renderRiskHeat(this.world, this.center, 400);
    if (!image) { this.heat?.remove(); this.heat = null; return; }
    if (this.heat) this.heat.setBounds(L.latLngBounds(image.bounds)).setUrl(image.url);
    else this.heat = L.imageOverlay(image.url, image.bounds, { pane: 'heat', interactive: false }).addTo(this.map);
  }
  setRoute(route: Route | null): void {
    this.routes.clearLayers(); if (!route) return;
    L.polyline(route.coords, { color: '#000', weight: 7, interactive: false }).addTo(this.routes);
    L.polyline(route.coords, { color: ROUTE_COLOR[route.preset], weight: 4, interactive: false }).addTo(this.routes);
  }
  setTrack(points: TrackPoint[]): void {
    const coords = points.map((p): [number, number] => [p.lat, p.lon]); this.outline.setLatLngs(coords); this.track.setLatLngs(coords);
  }
  setBaseMap(mode: BaseMapMode): void { this.background.setMode(mode); }
  destroy(): void { this.observer.disconnect(); this.explorer.destroy(); this.map.remove(); }
}
