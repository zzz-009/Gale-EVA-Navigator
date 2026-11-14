// Leaflet の地図をまとめて扱うクラス。React からは、状態が変わるたびに set〜 を呼ぶだけにする。
import L from 'leaflet';
import { haversine, type Landmark, type Route, type RoutePreset, type TracBackPlan, type TrackPoint } from '@core';
import { MARS_GALE } from './config/body';
import { CRS_MARS } from './lib/crsMars';
import type { HeatImage } from './heatmap';
import { hazardText, type HazardProperties, type HazardSettings } from './hazardText';
import { BaseMap, type BaseMapMode } from './baseMap';

export type LayerKey = 'hillshade' | 'slope' | 'contours' | 'hazard' | 'heat';
export type Site = { id: string; name: string; lat: number; lon: number; note?: string };
export type RegionMeta = { north: number; south: number; west: number; east: number };

export const ROUTE_COLOR: Record<RoutePreset, string> = { safe: '#ff4fd8', short: '#4cc9f0', science: '#afa9ec' };
export const SLOPE_COLOR = ['#5dcaa5', '#fac775', '#ef7f62', '#e24b4a'];

// L.circle は半径を地球の半径で計算するので、火星の半径に合わせて補正する。
const circleRadius = (m: number): number => m * (6371000 / MARS_GALE.radius_m);

const dot = (color: string, size = 14, ring = '#0b1418'): L.DivIcon =>
  L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid ${ring};box-sizing:border-box"></div>`,
  });

export class MapController {
  readonly map: L.Map;
  private readonly baseMap: BaseMap;
  private overlays: Record<LayerKey, L.Layer>;
  private sites = L.layerGroup();
  private routes = L.layerGroup();
  private track = L.layerGroup();
  private back = L.layerGroup();
  private hints = L.layerGroup();
  private explorer = L.layerGroup();
  private temp = L.layerGroup();
  private heat = L.layerGroup();
  private heatImage: L.ImageOverlay | null = null;
  private contourLabels = L.layerGroup();

  constructor(
    el: HTMLElement,
    region: RegionMeta & HazardSettings,
    contours: GeoJSON.FeatureCollection,
    hazards: GeoJSON.FeatureCollection,
    onClick: (lat: number, lon: number) => void,
    onMove: (lat: number, lon: number) => void,
    onView: (bounds: L.LatLngBounds) => void,
  ) {
    const bounds: L.LatLngBoundsLiteral = [[region.south, region.west], [region.north, region.east]];
    this.map = L.map(el, {
      crs: CRS_MARS,
      minZoom: 2,
      maxZoom: MARS_GALE.maxZoom,
      zoomControl: false,
      maxBounds: [[-90, -180], [90, 180]],
      maxBoundsViscosity: 1,
    });
    this.map.fitBounds(bounds);

    this.baseMap = new BaseMap(this.map);

    this.map.createPane('terrain').style.zIndex = '300';
    const heatPane = this.map.createPane('heat');
    heatPane.style.zIndex = '350';
    heatPane.style.pointerEvents = 'none';
    this.overlays = {
      heat: this.heat,
      hillshade: L.imageOverlay('/data/hillshade.png', bounds, { opacity: 0.75, pane: 'terrain' }),
      slope: L.imageOverlay('/data/slope_class.png', bounds, { opacity: 0.8, pane: 'terrain' }),
      contours: L.geoJSON(contours, {
        interactive: false,
        style: (f) => ({
          color: '#e8e2d6',
          weight: f?.properties?.index ? 1.6 : 0.7,
          opacity: f?.properties?.index ? 0.65 : 0.3,
        }),
      }),
      // 危険エリア: 半透明のオレンジ + 点線の縁取り（docs/ui_spec_map.md 3.6）
      hazard: L.geoJSON(hazards, {
        bubblingMouseEvents: false,
        style: (f) => {
          const noGo = f?.properties?.level === 'no_go';
          return {
            color: '#e89474',
            weight: 1.5,
            opacity: noGo ? 0.9 : 0.6,
            dashArray: '7 5',
            fillColor: '#ef7f62',
            fillOpacity: noGo ? 0.3 : 0.1,
          };
        },
        onEachFeature: (f, layer) => {
          const p = f.properties as HazardProperties;
          layer.bindTooltip(
            `${p.label}<br>最大 ${p.max_slope_deg}°・平均 ${p.mean_slope_deg}°<br>面積 ${(p.area_m2 / 10000).toFixed(2)} ha`,
            { sticky: true },
          );
          layer.bindPopup(hazardText(p, region), { maxWidth: 340 });
          layer.on('click', (event: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(event));
        },
      }),
    };

    for (const feature of contours.features) {
      if (!feature.properties?.index || !Number.isFinite(feature.properties.elev_m)) continue;
      const geometry = feature.geometry;
      const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
      for (const line of lines) {
        const lengths = line.slice(1).map((p, i) => haversine({ lat: line[i][1], lon: line[i][0] }, { lat: p[1], lon: p[0] }));
        const total = lengths.reduce((sum, n) => sum + n, 0);
        if (!(total > 0)) continue;
        let target = total < 400 ? total / 2 : 400;
        let distance = 0;
        for (let i = 0; i < lengths.length; i++) {
          const length = lengths[i];
          while (length > 0 && target <= distance + length && target <= total) {
            const ratio = (target - distance) / length;
            const lat = line[i][1] + (line[i + 1][1] - line[i][1]) * ratio;
            const lon = line[i][0] + (line[i + 1][0] - line[i][0]) * ratio;
            L.marker([lat, lon], { interactive: false, keyboard: false, icon: L.divIcon({
              className: 'contour-label', iconSize: [70, 18], iconAnchor: [35, 9],
              html: `${Math.round(feature.properties.elev_m).toLocaleString()} m`,
            }) }).addTo(this.contourLabels);
            target += 400;
          }
          distance += length;
        }
      }
    }
    this.map.on('zoomend', () => this.syncContourLabels());

    for (const g of [this.routes, this.track, this.back, this.hints, this.sites, this.explorer, this.temp]) g.addTo(this.map);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(this.map);
    this.map.on('click', (e) => onClick(e.latlng.lat, e.latlng.lng));
    const noMouse = window.matchMedia('(hover: none)');
    this.map.on('mousemove', (e) => {
      if (!noMouse.matches) onMove(e.latlng.lat, e.latlng.lng);
    });
    this.map.on('move', () => {
      onView(this.map.getBounds());
      if (noMouse.matches) {
        const center = this.map.getCenter();
        onMove(center.lat, center.lng);
      }
    });
    onView(this.map.getBounds());
    const center = this.map.getCenter();
    onMove(center.lat, center.lng);
  }

  destroy(): void {
    this.map.remove();
  }

  setBaseMap(mode: BaseMapMode): void {
    this.baseMap.setMode(mode);
  }

  setLayer(key: LayerKey, on: boolean): void {
    const layer = this.overlays[key];
    if (on && !this.map.hasLayer(layer)) layer.addTo(this.map);
    if (!on && this.map.hasLayer(layer)) layer.remove();
    if (key === 'contours') this.syncContourLabels();
  }

  private syncContourLabels(): void {
    if (this.map.getZoom() >= 15 && this.map.hasLayer(this.overlays.contours)) this.contourLabels.addTo(this.map);
    else this.contourLabels.remove();
  }

  setHeat(img: HeatImage | null): void {
    if (!img) {
      this.heat.clearLayers();
      this.heatImage = null;
      return;
    }
    if (this.heatImage) {
      this.heatImage.setBounds(L.latLngBounds(img.bounds)).setUrl(img.url);
    } else {
      this.heatImage = L.imageOverlay(img.url, img.bounds, { pane: 'heat', interactive: false }).addTo(this.heat);
    }
  }

  fly(lat: number, lon: number, zoom?: number): void {
    this.map.flyTo([lat, lon], zoom ?? this.map.getZoom(), { duration: 0.6 });
  }

  setSites(base: Site, targets: Site[], landmarks: Landmark[], selectedTarget: string | null, onTarget: (id: string) => void): void {
    this.sites.clearLayers();
    L.marker([base.lat, base.lon], { icon: dot('#ffffff', 18) }).bindTooltip(base.name, { permanent: true, direction: 'top', className: 'lbl' }).addTo(this.sites);
    for (const t of targets) {
      const sel = t.id === selectedTarget;
      L.marker([t.lat, t.lon], { icon: dot('#afa9ec', sel ? 18 : 13, sel ? '#ffffff' : '#0b1418') })
        .bindTooltip(t.name, { permanent: true, direction: 'top', className: 'lbl' })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onTarget(t.id);
        })
        .addTo(this.sites);
    }
    for (const l of landmarks) {
      L.marker([l.lat, l.lon], {
        interactive: false,
        icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div class="lm"></div>' }),
      })
        .bindTooltip(l.name, { permanent: true, direction: 'right', className: 'lbl lbl-lm' })
        .addTo(this.sites);
    }
  }

  setRoutes(routes: Route[], selected: RoutePreset | null, dim = false): void {
    this.routes.clearLayers();
    for (const r of routes) {
      if (r.preset === selected) continue;
      L.polyline(r.coords, { color: '#0b1418', weight: 5, opacity: 0.7, dashArray: '5 6', interactive: false }).addTo(this.routes);
      L.polyline(r.coords, { color: ROUTE_COLOR[r.preset], weight: 2, opacity: 0.45, dashArray: '5 6', interactive: false }).addTo(this.routes);
    }
    const sel = routes.find((r) => r.preset === selected);
    if (!sel) return;
    L.polyline(sel.coords, { color: '#0b1418', weight: dim ? 5 : 7, opacity: 0.7, interactive: false }).addTo(this.routes);
    L.polyline(sel.coords, { color: ROUTE_COLOR[sel.preset], weight: dim ? 2 : 4, opacity: dim ? 0.5 : 1, interactive: false }).addTo(this.routes);
    // 急な区間だけ白い短い点線を重ねる。
    for (const s of sel.segments) {
      if (s.slopeClass < 2) continue;
      L.polyline(sel.coords.slice(s.from, s.to + 1), { color: '#ffffff', weight: 2, dashArray: '2 6', interactive: false }).addTo(this.routes);
    }
  }

  setTrack(points: TrackPoint[]): void {
    this.track.clearLayers();
    if (points.length < 2) return;
    L.polyline(points.map((p) => [p.lat, p.lon] as [number, number]), { color: '#0b1418', weight: 6, opacity: 0.7, interactive: false }).addTo(this.track);
    L.polyline(points.map((p): [number, number] => [p.lat, p.lon]), { color: '#ffffff', weight: 3, interactive: false }).addTo(this.track);
    for (const p of points) {
      if (p.src === 'fix') L.circleMarker([p.lat, p.lon], { radius: 5, color: '#fff', weight: 2, fillColor: '#378add', fillOpacity: 1, interactive: false }).addTo(this.track);
    }
  }

  setExplorer(pos: { lat: number; lon: number } | null, err_m: number, follow: boolean): void {
    this.explorer.clearLayers();
    if (!pos) return;
    L.circle([pos.lat, pos.lon], { radius: circleRadius(err_m), color: '#378add', weight: 1, fillColor: '#378add', fillOpacity: 0.18, interactive: false }).addTo(this.explorer);
    L.marker([pos.lat, pos.lon], { icon: dot('#378add', 16, '#ffffff'), interactive: false }).addTo(this.explorer);
    if (follow && !this.map.getBounds().pad(-0.2).contains([pos.lat, pos.lon])) this.map.panTo([pos.lat, pos.lon]);
  }

  setTracBack(plan: TracBackPlan | null, from: { lat: number; lon: number } | null, next: number): void {
    this.back.clearLayers();
    if (!plan) return;
    const coords = from ? [[from.lat, from.lon] as [number, number], ...plan.coords] : plan.coords;
    L.polyline(coords, { color: '#0b1418', weight: 8, opacity: 0.7, interactive: false }).addTo(this.back);
    L.polyline(coords, { color: '#00e5ff', weight: 4, dashArray: '10 6', interactive: false }).addTo(this.back);
    plan.maneuvers.forEach((m, i) => {
      const angle = m.bearing_deg;
      L.marker(m.at, { interactive: false, icon: L.divIcon({ className: 'direction-icon', iconSize: [20, 20], iconAnchor: [10, 10],
        html: `<span style="display:block;color:#00e5ff;font-size:${i === next ? 20 : 16}px;transform:rotate(${angle}deg);text-shadow:0 0 3px #000">▲</span>`,
      }) }).addTo(this.back);
    });
  }

  setHints(lastFix: TrackPoint | null, nearest: TrackPoint | null, pos: { lat: number; lon: number } | null): void {
    this.hints.clearLayers();
    if (lastFix) {
      L.circleMarker([lastFix.lat, lastFix.lon], { radius: 9, color: '#ffffff', weight: 2, fillColor: '#378add', fillOpacity: 1 })
        .bindTooltip('最後に位置を確定した地点', { permanent: true, direction: 'bottom', className: 'lbl' })
        .addTo(this.hints);
    }
    if (nearest && pos) {
      L.polyline([[pos.lat, pos.lon], [nearest.lat, nearest.lon]], { color: '#ffffff', weight: 2, dashArray: '4 5', interactive: false }).addTo(this.hints);
      L.circleMarker([nearest.lat, nearest.lon], { radius: 7, color: '#0b1418', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
        .bindTooltip('いちばん近い足あと', { permanent: true, direction: 'left', className: 'lbl' })
        .addTo(this.hints);
    }
  }

  setTemp(pos: { lat: number; lon: number } | null, html: string, onAction?: () => void): void {
    this.temp.clearLayers();
    if (!pos) return;
    const box = document.createElement('div');
    box.innerHTML = html;
    const btn = box.querySelector('button');
    if (btn && onAction) btn.addEventListener('click', onAction);
    L.marker([pos.lat, pos.lon], { icon: dot('#ffffff', 16, '#0b1418') }).bindPopup(box, { autoPan: true }).addTo(this.temp).openPopup();
  }
}
