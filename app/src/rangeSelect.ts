import L from 'leaflet';
import type { LatLon } from '@core';
import { CRS_MARS } from './lib/crsMars';
import { MARS_GALE } from './config/body';

export function routeBounds(coords: [number, number][], paddingM = 150): L.LatLngBounds {
  const b = L.latLngBounds(coords);
  const dLat = paddingM / MARS_GALE.radius_m * 180 / Math.PI;
  const dLon = dLat / Math.cos(b.getCenter().lat * Math.PI / 180);
  return L.latLngBounds([b.getSouth()-dLat,b.getWest()-dLon],[b.getNorth()+dLat,b.getEast()+dLon]);
}
export function largeEnough(b: L.LatLngBounds): boolean {
  return CRS_MARS.distance(b.getSouthWest(), b.getNorthWest()) >= 100
    && CRS_MARS.distance(b.getSouthWest(), b.getSouthEast()) >= 100;
}
export function followSelection(b: L.LatLngBounds, p: LatLon): L.LatLngBounds {
  const h=b.getNorth()-b.getSouth(), w=b.getEast()-b.getWest();
  if(p.lat>b.getSouth()+h*.15 && p.lat<b.getNorth()-h*.15 && p.lon>b.getWest()+w*.15 && p.lon<b.getEast()-w*.15) return b;
  return L.latLngBounds([p.lat-h/2,p.lon-w/2],[p.lat+h/2,p.lon+w/2]);
}
export function outsideRing(b:L.LatLngBounds): L.LatLngExpression[][] {
 return [[[-90,-180],[-90,180],[90,180],[90,-180]], [b.getSouthWest(),b.getNorthWest(),b.getNorthEast(),b.getSouthEast()]];
}

/** Capture range gestures before Leaflet sees them; ordinary dragging remains Leaflet's. */
export function installRangeSelect(map:L.Map, enabled:()=>boolean, complete:(b:L.LatLngBounds|null)=>void) {
 const el=map.getContainer();
 let start:L.LatLng|null=null, preview:L.Rectangle|null=null, pointer:number|null=null;
 let dragging=false, suppressClick=false;
 const point=(e:PointerEvent)=>map.mouseEventToLatLng(e);
 const stop=(e:Event)=>{e.preventDefault();e.stopImmediatePropagation();};
 const cleanup=()=>{
   preview?.remove(); preview=null; start=null;
   if(pointer!==null && el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
   pointer=null;
   if(dragging) map.dragging.enable();
   dragging=false;
 };
 const down=(e:PointerEvent)=>{
   if(e.button!==0 || (!enabled() && !e.shiftKey) || (e.target as Element).closest('.leaflet-control')) return;
   stop(e); suppressClick=true; map.stop(); dragging=map.dragging.enabled(); map.dragging.disable();
   start=point(e); pointer=e.pointerId; el.setPointerCapture(pointer);
   preview=L.rectangle(L.latLngBounds(start,start),{color:'#fff',weight:2,fillOpacity:.08,interactive:false,pane:map.getPane('range')?'range':'overlayPane'}).addTo(map);
 };
 const move=(e:PointerEvent)=>{if(!start || pointer!==e.pointerId)return;stop(e);preview?.setBounds(L.latLngBounds(start,point(e)));};
 const up=(e:PointerEvent)=>{
   if(!start || pointer!==e.pointerId)return;stop(e);
   const b=L.latLngBounds(start,point(e)); cleanup(); complete(largeEnough(b)?b:null);
 };
 const cancel=()=>{if(start){cleanup();complete(null);}};
 const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};
 const swallow=(e:MouseEvent)=>{if(suppressClick || enabled() || e.shiftKey){suppressClick=false;stop(e);}};
 map.boxZoom.disable();
 el.addEventListener('pointerdown',down,true); el.addEventListener('pointermove',move,true); el.addEventListener('pointerup',up,true);
 el.addEventListener('pointercancel',cancel,true); el.addEventListener('click',swallow,true); window.addEventListener('keydown',key);
 return ()=>{cleanup();el.removeEventListener('pointerdown',down,true);el.removeEventListener('pointermove',move,true);el.removeEventListener('pointerup',up,true);el.removeEventListener('pointercancel',cancel,true);el.removeEventListener('click',swallow,true);window.removeEventListener('keydown',key);};
}
