import type { LatLngBoundsLiteral } from 'leaflet';

// Sources: docs/TODO_case10.md §4.1 and docs/ui_spec_map.md §§1, 7.
export const MARS_GALE = {
  body: 'mars',
  radius_m: 3396190,
  crs: 'geographic',
  baseTiles: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0//default/default028mm/{z}/{y}/{x}.jpg',
  detailTiles: 'https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0//default/default028mm/{z}/{y}/{x}.png',
  detailBounds: [[-4.925, 137.122], [-4.249, 137.730]] satisfies LatLngBoundsLiteral,
  maxZoom: 16,
  baseMaxNativeZoom: 7, // Viking の背景はズーム 0〜7 まで（WMTS の設定で確認）
  initial: { lat: -4.59, lon: 137.44, z: 12 },
  attribution: 'NASA/JPL-Caltech Mars Trek, HiRISE: NASA/JPL/University of Arizona',
};
