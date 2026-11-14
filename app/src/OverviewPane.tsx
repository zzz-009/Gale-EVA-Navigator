import { useEffect, useRef, useState, type RefObject } from 'react';
import L from 'leaflet';
import { MapController } from './mapController';
import type { World } from './world';
import { installRangeSelect, outsideRing } from './rangeSelect';
export type OverviewHandle = { controller: MapController; setViewport:(bounds:L.LatLngBounds)=>void };
type Props = {world:World; selection:L.LatLngBounds|null; onSelection:(bounds:L.LatLngBounds)=>void; onPoint?:(lat:number,lon:number)=>void; handle:RefObject<OverviewHandle|null>; visible:boolean};
export function OverviewPane({world,selection,onSelection,onPoint,handle,visible}:Props) {
 const el=useRef<HTMLDivElement>(null), active=useRef(false), selectionLayer=useRef<L.LayerGroup|null>(null);
 const [selecting,setSelecting]=useState(false), [notice,setNotice]=useState('');
 const callback=useRef(onSelection); callback.current=onSelection;
 const pointCallback = useRef(onPoint); pointCallback.current = onPoint;
 useEffect(()=>{
   if(!el.current)return;
   const c=new MapController(el.current,world.region,world.contours,world.hazards,(lat,lon)=>pointCallback.current?.(lat,lon),()=>{},()=>{});
   const pane=c.map.createPane('range');pane.style.zIndex='640';pane.style.pointerEvents='none';
   selectionLayer.current=L.layerGroup().addTo(c.map);
   const viewport=L.rectangle(c.map.getBounds(),{pane:'range',color:'#fff',weight:1,dashArray:'3 5',fill:false,interactive:false}).addTo(c.map);
   handle.current={controller:c,setViewport:b=>viewport.setBounds(b)};
   const uninstall=installRangeSelect(c.map,()=>active.current,b=>{
     active.current=false;setSelecting(false);
     if(b){setNotice('');callback.current(b);}else setNotice('もう少し大きく選んでください');
   });
   let needsInitialFit = !el.current.clientWidth || !el.current.clientHeight;
   const observer = new ResizeObserver((entries) => {
     if (entries.some((entry) => entry.contentRect.width > 0 && entry.contentRect.height > 0)) {
       c.map.invalidateSize({ pan: false });
       if (needsInitialFit) {
         const { south, west, north, east } = world.region;
         c.map.fitBounds([[south, west], [north, east]], { animate: false });
         needsInitialFit = false;
       }
     }
   });
   observer.observe(el.current);
   return ()=>{observer.disconnect();uninstall();handle.current=null;selectionLayer.current=null;c.destroy();};
 },[world,handle]);
 useEffect(()=>{
   const group=selectionLayer.current;
   if(!group || !selection)return;
   group.clearLayers();
   L.polygon(outsideRing(selection),{pane:'range',stroke:false,fillColor:'#000',fillOpacity:.25,fillRule:'evenodd',interactive:false}).addTo(group);
   L.rectangle(selection,{pane:'range',color:'#fff',weight:2,fill:false,interactive:false}).addTo(group);
 },[selection,world]);
 useEffect(()=>{if(!notice)return;const id=window.setTimeout(()=>setNotice(''),2000);return ()=>window.clearTimeout(id);},[notice]);
 return <section id="dashboard-overview" className={`overview-pane ${selecting ? 'range-selecting' : ''}`} hidden={!visible} aria-label="表示画面（全体図）">
   <div ref={el} className="map" />
   <div className="overview-tools"><b>表示画面（全体図）</b><button className={selecting?'on':''} aria-pressed={selecting} onClick={()=>{active.current=!active.current;setSelecting(active.current);}}>範囲を選ぶ</button><span>Shift＋ドラッグでも選択</span></div>
   {notice?<p className="range-notice" role="status">{notice}</p>:null}
 </section>;
}
