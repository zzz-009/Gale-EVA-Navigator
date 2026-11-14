import L from 'leaflet';
import type { LatLon } from '@core';
import { MARS_GALE } from './config/body';
import { CRS_MARS } from './lib/crsMars';
import type { RegionMeta, Site } from './mapController';
import { BaseMap, type BaseMapMode } from './baseMap';

export class MiniMap {
  private readonly map: L.Map;
  private readonly baseMap: BaseMap;
  private readonly route = L.polyline([], { weight: 2, interactive: false });
  private readonly routeOutline = L.polyline([], { color: '#0b1418', weight: 4, interactive: false });
  private readonly trackOutline = L.polyline([], { color: '#0b1418', weight: 4, interactive: false });
  private readonly track = L.polyline([], { color: '#ffffff', weight: 2, interactive: false });
  private readonly sites = L.layerGroup();
  private readonly explorer = L.layerGroup();
  private readonly viewport: L.Rectangle;

  constructor(el: HTMLElement, region: RegionMeta, onClick: (pos: LatLon) => void) {
    const bounds: L.LatLngBoundsLiteral = [[region.south, region.west], [region.north, region.east]];
    this.map = L.map(el, {
      crs: CRS_MARS, zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      touchZoom: false, boxZoom: false, keyboard: false,
      zoomAnimation: false, fadeAnimation: false, maxZoom: MARS_GALE.maxZoom,
    });
    // 出典はメインの地図に表示。
    this.baseMap = new BaseMap(this.map);
    this.map.fitBounds(bounds, { padding: [8, 8] });
    this.routeOutline.addTo(this.map);
    this.route.addTo(this.map);
    this.trackOutline.addTo(this.map);
    this.track.addTo(this.map);
    this.sites.addTo(this.map);
    this.explorer.addTo(this.map);
    this.viewport = L.rectangle(bounds, { color: '#ffffff', weight: 1, fill: false, interactive: false }).addTo(this.map);
    this.map.on('click', (event: L.LeafletMouseEvent) => onClick({ lat: event.latlng.lat, lon: event.latlng.lng }));
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }

  setRoute(coords: [number, number][], color: string): void {
    this.routeOutline.setLatLngs(coords);
    this.route.setLatLngs(coords).setStyle({ color });
  }

  setBaseMap(mode: BaseMapMode): void {
    this.baseMap.setMode(mode);
  }

  setTrack(points: LatLon[]): void {
    this.trackOutline.setLatLngs(points.map((p): [number, number] => [p.lat, p.lon]));
    this.track.setLatLngs(points.map((p): [number, number] => [p.lat, p.lon]));
  }

  setExplorer(pos: LatLon | null): void {
    this.explorer.clearLayers();
    if (!pos) return;
    L.circleMarker([pos.lat, pos.lon], {
      radius: 4, color: '#ffffff', weight: 1, fillColor: '#378add', fillOpacity: 1, interactive: false,
    }).addTo(this.explorer);
  }

  setViewport(bounds: L.LatLngBounds): void {
    this.viewport.setBounds(bounds);
  }

  setSites(base: Site, targets: Site[]): void {
    this.sites.clearLayers();
    for (const site of [base, ...targets]) {
      L.circleMarker([site.lat, site.lon], {
        radius: 3, color: site === base ? '#ffffff' : '#afa9ec', weight: 1, fillOpacity: 1, interactive: false,
      }).addTo(this.sites);
    }
  }

  destroy(): void {
    this.map.remove();
  }
}
