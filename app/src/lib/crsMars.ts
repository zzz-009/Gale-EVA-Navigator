import L from 'leaflet';
import { MARS_GALE } from '../config/body';

// Keep EPSG4326's 2 × 1 tiles at z=0; Earth.distance reads this.R.
export const CRS_MARS: L.CRS & { R: number } = L.extend({}, L.CRS.EPSG4326, {
  R: MARS_GALE.radius_m,
  distance: L.CRS.Earth.distance,
});
