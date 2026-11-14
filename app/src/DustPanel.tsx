import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { bearing, marsTime, type DustForecast } from '@core';
import { MARS_GALE } from './config/body';
import { CRS_MARS } from './lib/crsMars';
import type { RegionMeta } from './mapController';
import { stamp } from './sim';

export const dustWarning = (forecast: DustForecast): string | null => forecast.arrival_hour === null ? null
  : `⚠ 約 ${forecast.arrival_hour} 時間後に砂嵐が活動地域に到達（シミュレーション）`;

function DustMap({ forecast, region, hour }: { forecast: DustForecast; region: RegionMeta; hour: number }) {
  const el = useRef<HTMLDivElement>(null);
  const storms = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, {
      crs: CRS_MARS, zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      touchZoom: false, boxZoom: false, keyboard: false,
      zoomAnimation: false, fadeAnimation: false, maxZoom: MARS_GALE.maxZoom,
    });
    // 出典はメイン地図に表示。背景URLは既存の確認済み設定を共有する。
    L.tileLayer(MARS_GALE.baseTiles, {
      noWrap: true, maxZoom: MARS_GALE.maxZoom, maxNativeZoom: MARS_GALE.baseMaxNativeZoom,
    }).addTo(map);
    map.fitBounds(forecast.bounds, { padding: [4, 4] });
    storms.current = L.layerGroup().addTo(map);
    // 砂嵐の塗りより上に活動地域を示す。
    map.createPane('activity').style.zIndex = '450';
    L.rectangle([[region.south, region.west], [region.north, region.east]], {
      color: '#ffffff', weight: 2, fill: false, interactive: false, pane: 'activity',
    }).addTo(map);
    L.DomEvent.disableClickPropagation(el.current);
    L.DomEvent.disableScrollPropagation(el.current);
    return () => {
      storms.current = null;
      map.remove();
    };
  }, [forecast, region]);

  useEffect(() => {
    const group = storms.current;
    const frame = forecast.frames[hour];
    if (!group || !frame) return;
    group.clearLayers();
    frame.cells.forEach((cell, i) => {
      L.circle([cell.lat, cell.lon], {
        radius: cell.radius_km * 1000 * (6371000 / MARS_GALE.radius_m),
        color: '#b5651d', weight: 1, opacity: 0.8,
        fillColor: '#b5651d', fillOpacity: 0.15 + 0.45 * cell.intensity, interactive: false,
      }).addTo(group);
      const next = forecast.frames[hour + 1]?.cells[i];
      const previous = forecast.frames[hour - 1]?.cells[i];
      const angle = next ? bearing(cell, next) : previous ? bearing(previous, cell) : 0;
      L.marker([cell.lat, cell.lon], { interactive: false, keyboard: false, icon: L.divIcon({
        className: 'dust-direction', iconSize: [20, 20], iconAnchor: [10, 10],
        html: `<span style="display:block;transform:rotate(${angle}deg)">↑</span>`,
      }) }).addTo(group);
    });
  }, [forecast, region, hour]);

  return <div ref={el} className="dust-map" role="img" aria-label={`Gale周辺約200kmの砂嵐シミュレーション、${hour}時間後。茶色の円は砂嵐、白い四角は活動地域、矢印は移動方向`} />;
}

type Props = { forecast: DustForecast; region: RegionMeta; open: boolean; onToggle: () => void; baseMs: number; lon: number };

export function DustPanel({ forecast, region, open, onToggle, baseMs, lon }: Props) {
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const lastHour = forecast.frames.length - 1;
  useEffect(() => {
    if (!open || hour >= lastHour) {
      setPlaying(false);
      return;
    }
    if (!playing) return;
    const timer = window.setTimeout(() => setHour((h) => Math.min(h + 1, lastHour)), 1000);
    return () => window.clearTimeout(timer);
  }, [playing, open, hour, lastHour]);

  const timeMs = baseMs + hour * 3600000;
  const clock = stamp(timeMs, lon);
  const ls = marsTime(new Date(timeMs)).ls;
  const near = forecast.nearest_km[hour];
  const nextNear = forecast.nearest_km[Math.min(hour + 1, lastHour)];
  const previousNear = forecast.nearest_km[Math.max(0, hour - 1)];
  const approaching = hour < lastHour ? nextNear < near : near < previousNear;
  const warning = dustWarning(forecast);

  return <section className={`dust-panel ${open ? '' : 'collapsed'}`} aria-label="砂嵐の予報（シミュレーション）">
    <button type="button" className="dust-heading" aria-expanded={open} aria-controls="dust-content" onClick={onToggle}>
      <span>砂嵐の予報（シミュレーション）</span><span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open ? <div id="dust-content">
      <DustMap forecast={forecast} region={region} hour={hour} />
      <div className="dust-content">
        <p className="muted">約200km四方｜茶色: 砂嵐（濃いほど強い）・白枠: 活動地域・矢印: 移動方向</p>
        <label htmlFor="dust-hour">予報時刻: {hour === 0 ? '現在' : `+${hour}h`}</label>
        <div className="dust-controls">
          <input id="dust-hour" type="range" min={0} max={lastHour} step={1} value={hour} aria-valuetext={`${hour}時間後`} onChange={(e) => { setPlaying(false); setHour(Number(e.target.value)); }} />
          <button type="button" aria-label={playing ? '予報の再生を停止' : '予報を1秒ごとに1時間進める'} onClick={() => {
            if (!playing && hour >= lastHour) setHour(0);
            setPlaying((v) => !v);
          }}>{playing ? 'Ⅱ' : '▶'}</button>
        </div>
        <p>+{hour}h: 活動地域まで {near.toFixed(0)} km（{near === 0 ? '到達' : approaching ? '接近中' : '離れています'}）</p>
        <p>Sol {clock.sol}・LMST {clock.lmst}</p>
        <p>季節: Ls {ls.toFixed(0)}°{ls >= 180 && ls < 360 ? '（砂嵐が起きやすい季節）' : ''}</p>
        {warning ? <p className="dust-warning">{warning}</p> : null}
        <p className="muted">※ {forecast.note}</p>
      </div>
    </div> : null}
  </section>;
}
