import {useEffect,useState} from 'react';
import {marsTime,type DustForecast} from '@core';
import {DustMap,dustWarning} from './DustPanel';
import type {RegionMeta} from './mapController';
export function DustForecastStrip({forecast,region,baseMs}:{forecast:DustForecast;region:RegionMeta;baseMs:number}) {
 const [open,setOpen]=useState(true),[hour,setHour]=useState(0),[playing,setPlaying]=useState(false);
 const last=forecast.frames.length-1;
 useEffect(()=>{
   if(!open || hour>=last){setPlaying(false);return;}
   if(!playing)return;
   const id=window.setTimeout(()=>setHour(h=>Math.min(h+1,last)),1000);
   return ()=>window.clearTimeout(id);
 },[open,hour,last,playing]);
 const ls=marsTime(new Date(baseMs+hour*3600000)).ls;
 const warning=dustWarning(forecast);
 return <section className="dust-strip">
   <div className="dust-strip-heading"><b>砂嵐の予報（シミュレーション）</b><span>季節 Ls {ls.toFixed(0)}°{ls>=180?'（砂嵐が起きやすい季節）':''}</span><button aria-label={open?'砂嵐の帯を折りたたむ':'砂嵐の帯を開く'} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'−':'＋'}</button></div>
   {open?<><div className="dust-strip-body"><div className="dust-timeline"><div className="dust-hours">{forecast.nearest_km.map((km,i)=><button key={i} aria-pressed={hour===i} className={`${km===0?'arrived':''} ${hour===i?'selected':''}`} onClick={()=>{setPlaying(false);setHour(i);}}><span>{i===0?'現在':`+${i}h`}</span><strong>{km>=30?'○':km>=15?'◔':km>=5?'◑':km>0?'◕':'●'}</strong><span>{km===0?'到達':`${Math.round(km)}km`}</span></button>)}</div>
   <button aria-label={playing?'予報の再生を停止':'予報を1秒ごとに1時間進める'} onClick={()=>{if(!playing && hour>=last)setHour(0);setPlaying(v=>!v);}}>{playing?'Ⅱ':'▶'}</button>
   {warning?<p className="dust-warning">{warning}</p>:null}</div><div className="dust-strip-map"><DustMap forecast={forecast} region={region} hour={hour}/></div></div>
   <p className="muted small">※ 訓練用のシミュレーションです（実際の予報ではありません）。茶色: 砂嵐・白枠: 活動地域・矢印: 移動方向。</p></>:null}
 </section>;
}
