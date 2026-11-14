import L from 'leaflet';
import { MARS_GALE } from './config/body';

export type BaseMapMode = 'mono' | 'color';

/** 確認済みの背景画像を切り替える。危険度やルートの色には影響させない。 */
export class BaseMap {
  private readonly detail: L.TileLayer;

  constructor(private readonly map: L.Map) {
    L.tileLayer(MARS_GALE.baseTiles, {
      noWrap: true,
      maxZoom: MARS_GALE.maxZoom,
      maxNativeZoom: MARS_GALE.baseMaxNativeZoom,
      attribution: MARS_GALE.attribution,
    }).addTo(map);
    this.detail = L.tileLayer(MARS_GALE.detailTiles, {
      noWrap: true,
      maxZoom: MARS_GALE.maxZoom,
      bounds: MARS_GALE.detailBounds,
    });
    this.setMode('mono');
  }

  setMode(mode: BaseMapMode): void {
    const pane = this.map.getPane('tilePane');
    if (pane) pane.style.filter = mode === 'mono' ? 'grayscale(1)' : '';
    if (mode === 'mono') {
      if (!this.map.hasLayer(this.detail)) this.detail.addTo(this.map);
    } else {
      this.detail.remove();
    }
  }
}
