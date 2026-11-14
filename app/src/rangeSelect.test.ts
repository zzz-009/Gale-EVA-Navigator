import {describe,it,expect,vi,afterEach} from 'vitest';
import L from 'leaflet';
import {routeBounds,largeEnough,followSelection,outsideRing,installRangeSelect} from './rangeSelect';
import {CRS_MARS} from './lib/crsMars';

describe('dashboard selection on Mars',()=>{
 it('pads route latitude/longitude by 150 metres on each side',()=>{
   const b=routeBounds([[-4.59,137.44],[-4.58,137.45]]);
   expect(CRS_MARS.distance(L.latLng(-4.59,137.44),L.latLng(b.getSouth(),137.44))).toBeCloseTo(150,4);
   expect(CRS_MARS.distance(L.latLng(-4.585,137.44),L.latLng(-4.585,b.getWest()))).toBeCloseTo(150,3);
   expect(b.contains([-4.59,137.44])).toBe(true);
   expect(b.contains([-4.58,137.45])).toBe(true);
 });
 it('rejects either edge shorter than 100 Mars metres, including a click',()=>{
   expect(largeEnough(L.latLngBounds([0,0],[.001,.01]))).toBe(false);
   expect(largeEnough(L.latLngBounds([0,0],[.01,.001]))).toBe(false);
   expect(largeEnough(L.latLngBounds([0,0],[0,0]))).toBe(false);
   expect(largeEnough(L.latLngBounds([0,0],[.002,.002]))).toBe(true);
 });
 it('keeps the range fixed within the inner 70 percent',()=>{
   const b=L.latLngBounds([-5,137],[-4,138]);
   expect(followSelection(b,{lat:-4.5,lon:137.5})).toBe(b);
   expect(followSelection(b,{lat:-4.84,lon:137.84})).toBe(b);
 });
 it.each([{lat:-4.9,lon:137.5},{lat:-4.1,lon:137.5},{lat:-4.5,lon:137.1},{lat:-4.5,lon:137.9},{lat:-3,lon:139}])('recenters near every edge or outside, retaining size: %o',p=>{
   const b=L.latLngBounds([-5,137],[-4,138]);
   const next=followSelection(b,p);
   expect(next.getCenter().lat).toBeCloseTo(p.lat);
   expect(next.getCenter().lng).toBeCloseTo(p.lon);
   expect(next.getNorth()-next.getSouth()).toBeCloseTo(1);
   expect(next.getEast()-next.getWest()).toBeCloseTo(1);
 });
 it('makes an outside mask with a hole matching the selected bounds',()=>{
   const b=L.latLngBounds([-5,137],[-4,138]);
   const rings=outsideRing(b);
   expect(rings).toHaveLength(2);
   expect(rings[1]).toEqual([b.getSouthWest(),b.getNorthWest(),b.getNorthEast(),b.getSouthEast()]);
 });
});

// Real Leaflet maps in jsdom: exercise handler setup/teardown without network or a browser.
import {MapController} from './mapController';
const empty:GeoJSON.FeatureCollection={type:'FeatureCollection',features:[]};
const disposers:(()=>void)[]=[];
afterEach(()=>{disposers.splice(0).reverse().forEach(f=>f());vi.restoreAllMocks();});
function container() {
 const el=document.createElement('div');document.body.append(el);
 Object.defineProperties(el,{clientWidth:{value:600},clientHeight:{value:450},offsetWidth:{value:600},offsetHeight:{value:450}});
 el.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:600,bottom:450,width:600,height:450,toJSON:()=>({})});
 el.setPointerCapture=()=>{};el.hasPointerCapture=()=>false;
 const svg=L.Browser.svg;
 Object.defineProperty(L.Browser,'svg',{value:true,configurable:true});
 disposers.push(()=>Object.defineProperty(L.Browser,'svg',{value:svg,configurable:true}));
 disposers.push(()=>el.remove());return el;
}
it('selection constrains zoom and bounds and creates an opaque hole mask; resizing retains it',()=>{
 const el=container();
 vi.stubGlobal('matchMedia',()=>({matches:false}));
 disposers.push(()=>vi.unstubAllGlobals());
 const c=new MapController(el,{south:-4.7,north:-4.4,west:137.2,east:137.7,slope_max_deg:20,slope_limited_deg:15,cell_m:10},empty,empty,()=>{},()=>{},()=>{});
 disposers.push(()=>c.destroy());
 const b=L.latLngBounds([-4.6,137.4],[-4.58,137.43]);
 c.setSelection(b,false);
 expect(c.map.getMinZoom()).toBe(2);
 c.map.setZoom(2);expect(c.map.getZoom()).toBe(c.map.getMinZoom());
 expect(b.equals(c.map.options.maxBounds!)).toBe(true);
 const pane=c.map.getPane('selection-mask')!;
 expect(pane.style.zIndex).toBe('640');expect(pane.style.pointerEvents).toBe('none');
 expect(pane.querySelector('path')?.getAttribute('fill-opacity')).toBe('1');
 c.resize();expect(b.equals(c.map.options.maxBounds!)).toBe(true);
});
it('fits without padding and preserves manual zoom through resize and automatic range updates', () => {
  const el = container();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  disposers.push(() => vi.unstubAllGlobals());
  const controller = new MapController(el,
    { south: -4.7, north: -4.4, west: 137.2, east: 137.7, slope_max_deg: 20, slope_limited_deg: 15, cell_m: 10 },
    empty, empty, () => {}, () => {}, () => {}, { zoomSnap: 0, zoomDelta: 0.5 });
  disposers.push(() => controller.destroy());
  const bounds = L.latLngBounds([-4.6, 137.4], [-4.58, 137.43]);
  controller.setSelection(bounds, false);
  expect(controller.map.getZoom()).toBe(controller.map.getBoundsZoom(bounds));
  controller.map.setZoom(16, { animate: false });
  controller.resize();
  expect(controller.map.getZoom()).toBe(16);
  controller.setSelection(L.latLngBounds([-4.59, 137.41], [-4.57, 137.44]), false, false);
  expect(controller.map.getZoom()).toBe(16);
  controller.setSelection(bounds, false);
  expect(controller.map.getZoom()).toBe(controller.map.getBoundsZoom(bounds));
});
it.each([false,true])('range gestures use button mode or Shift, finish once, then restore ordinary drag (shift=%s)',shift=>{
 const el=container();
 const map=L.map(el,{crs:CRS_MARS,zoomAnimation:false}).setView([-4.59,137.44],15);
 disposers.push(()=>map.remove());
 let active=!shift;
 const complete=vi.fn(()=>{active=false;});
 const uninstall=installRangeSelect(map,()=>active,complete);disposers.push(uninstall);
 const pointer=(type:string,x:number,y:number,withShift=shift)=>{
   const e=new MouseEvent(type,{clientX:x,clientY:y,button:0,shiftKey:withShift,bubbles:true,cancelable:true});
   Object.defineProperty(e,'pointerId',{value:1});el.dispatchEvent(e);
 };
 expect(map.boxZoom.enabled()).toBe(false);
 pointer('pointerdown',50,50);expect(map.dragging.enabled()).toBe(false);
 pointer('pointermove',500,350);pointer('pointerup',500,350);
 expect(complete).toHaveBeenCalledTimes(1);expect(complete.mock.calls[0]).not.toEqual([null]);expect(map.dragging.enabled()).toBe(true);
 pointer('pointerdown',50,50,false);pointer('pointerup',500,350,false);
 expect(complete).toHaveBeenCalledTimes(1);
 uninstall();pointer('pointerdown',50,50,true);pointer('pointerup',500,350,true);
 expect(complete).toHaveBeenCalledTimes(1);
});
