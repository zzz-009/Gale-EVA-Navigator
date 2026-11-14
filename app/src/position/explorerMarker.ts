import L from 'leaflet';
import { fromLocal, type LatLon } from '@core';
import { MARS_GALE } from '../config/body';

export class ExplorerMarker {
  private group = L.layerGroup();
  private dot = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2, fillColor: '#378add', fillOpacity: 1, interactive: false });
  private error = L.circle([0, 0], { radius: 0, color: '#378add', weight: 1, fillOpacity: 0.18, interactive: false });
  private fan = L.polygon([], { color: '#378add', weight: 0, fillOpacity: 0.4, interactive: false });
  private frame: number | null = null;
  private shown: LatLon | null = null;
  private goal: LatLon | null = null;
  private heading = 0;
  private following = false;
  constructor(private map: L.Map) {
    this.group.addTo(map); this.error.addTo(this.group); this.fan.addTo(this.group); this.dot.addTo(this.group);
    this.map.on('dragstart', this.stopFollowing);
    this.group.remove();
  }
  private stopFollowing = (): void => { this.following = false; };
  follow(fallback?: LatLon): void {
    this.following = true;
    const point = this.shown ?? fallback;
    if (point) this.map.panTo([point.lat, point.lon]);
  }
  update(point: LatLon | null, error: number, heading: number): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!point) { this.group.remove(); this.shown = null; this.goal = null; return; }
    this.group.addTo(this.map);
    this.error.setRadius(error * 6371000 / MARS_GALE.radius_m);
    const start = this.shown ?? point;
    const oldHeading = this.heading;
    const turn = ((heading - oldHeading + 540) % 360) - 180;
    const moved = !this.goal || point.lat !== this.goal.lat || point.lon !== this.goal.lon;
    this.goal = point;
    const time = performance.now();
    const draw = (): void => {
      const fraction = moved ? Math.min(1, (performance.now() - time) / 300) : 1;
      this.shown = { lat: start.lat + (point.lat - start.lat) * fraction, lon: start.lon + (point.lon - start.lon) * fraction };
      this.heading = oldHeading + turn * fraction;
      const p = this.shown;
      const edge = (angle: number): [number, number] => {
        const rad = angle * Math.PI / 180;
        const position = fromLocal(p, { x: Math.sin(rad) * 40, y: Math.cos(rad) * 40 });
        return [position.lat, position.lon];
      };
      this.dot.setLatLng([p.lat, p.lon]); this.error.setLatLng([p.lat, p.lon]);
      this.fan.setLatLngs([[p.lat, p.lon], ...[-30, -15, 0, 15, 30].map((offset) => edge(this.heading + offset))]);
      if (this.following) this.map.panTo([p.lat, p.lon], { animate: false });
      this.frame = fraction < 1 ? requestAnimationFrame(draw) : null;
    };
    draw();
  }
  destroy(): void { if (this.frame !== null) cancelAnimationFrame(this.frame); this.map.off('dragstart', this.stopFollowing); this.group.remove(); }
}
