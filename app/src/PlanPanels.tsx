import type { Route, RoutePreset } from '@core';
import { DEFAULT_V0 } from '@core';
import { ROUTE_COLOR, type Site } from './mapController';
import type { World } from './world';
import { fmtKm, fmtDur } from './panelFormat';
const PRESET_LABEL: Record<RoutePreset, string> = { safe: '安全優先ルート', short: '最短時間ルート', science: '科学探査ルート' };
const PRESET_TAG: Record<RoutePreset, string> = { safe: '推奨', short: '効率重視', science: '観測重視' };
type Props = {
 targets: Site[]; targetId: string; setTargetId: (id:string)=>void; target: Site|null;
 routes: Route[]|null; route: Route|null; setPreset: (preset:RoutePreset)=>void;
 speed:number; setSpeed:(speed:number)=>void; depart:()=>void; resetTargets:()=>void; jsonSource:boolean;
 resetBase:()=>void; baseMoved:boolean;
};
export function PlanPanels({targets,targetId,setTargetId,target,routes,route,setPreset,speed,setSpeed,depart,resetTargets,jsonSource,resetBase,baseMoved}:Props) {
 return <>
              <section className="panel-card"><h2>ルート候補を比較</h2>
              <p className="muted small">地図をドラッグで移動し、置きたい地点をクリックすると基地・目的地を配置できます。</p>
              <button onClick={resetBase} disabled={!baseMoved}>基地を元の位置に戻す</button>
              <button onClick={resetTargets}>目的地を元の位置に戻す</button>
              <label className="fld">
                <span>出発: 基地　→　目的地</span>
                <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              {target?.note ? <p className="muted small">科学目標: {target.note}</p> : null}
              {routes === null ? <p className="muted">ルートを計算しています…</p> : null}
              {routes && routes.length === 0 ? <div className="note warn">通れるルートが見つかりません。目的地を変えてください。</div> : null}
              {routes?.map((r) => (
                <button key={r.id} className={`rcard ${r.preset === route?.preset ? 'sel' : ''}`} onClick={() => setPreset(r.preset)}>
                  <div className="rc-h">
                    <span className="rc-line" style={{ background: ROUTE_COLOR[r.preset] }} />
                    <b>{PRESET_LABEL[r.preset]}</b>
                    <span className="tag">{PRESET_TAG[r.preset]}</span>
                  </div>
                  <div className="rc-n">
                    <span>{fmtKm(r.surface_m)}</span>
                    <span>
                      {r.safety_score}
                      <small> /100</small>
                    </span>
                    <span>{fmtDur(r.est_time_s)}</span>
                  </div>
                  <div className="muted small">
                    最大傾斜 {r.max_slope_deg.toFixed(0)}°・急な区間 {fmtKm(r.limited_zone_m)}
                  </div>
                </button>
              ))}
              </section>
              {route ? (
                <section className="panel-card">                  <button className="primary" onClick={depart}>
                    このルートで出発（シミュレーション）
                  </button>
                  <h3>ルートの解説</h3>
                  <div className="explain">
                    {route.explanation.map((s) => (
                      <p key={s}>{s}</p>
                    ))}
                    <p className="muted small">計算結果からテンプレートで作った文章です（生成 AI は使っていません）。</p>
                  </div>
                  <label className="inline">再生速度（シミュレーション）
                    <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                      <option value={1}>×1</option><option value={3}>×3</option><option value={8}>×8</option>
                    </select>
                  </label>
                  {jsonSource ? <p className="muted small">JSONの時刻間隔もこの速度で再生します（30秒間隔なら×8で約3.75秒ごと）。</p> : null}

                </section>
              ) : null}
 </>;
}
export function DataPanel({world}:{world:World|null}) { return <section className="panel-card">              <details className="about">
                <summary>指標とデータの説明</summary>
                {world ? <p>周辺の危険度 = min(1, (傾斜 / {world.region.slope_max_deg}°)² + 0.5 × 起伏)。傾斜 {world.region.slope_max_deg}° 超は危険度 1。</p> : null}
                {world ? <p>EVA 安全スコア = 100 − 40×(急な区間の長さ/全長) − 30×(最大傾斜/{world.region.slope_max_deg}°) − 20×(所要時間/6 時間) − 10×(圏外の長さ/全長)</p> : null}
                {world ? <p>歩く速さ = {DEFAULT_V0} m/s × exp(−3.5×|勾配 + 0.05|)（Tobler の式を宇宙服向けに上限を下げたもの）。このアプリでは傾斜 {world.region.slope_max_deg}° 超は通行不可の設定です。</p> : null}
                <p>地形: {world?.region.source.credit}（{world?.region.source.product}）。{world?.region.source.note}。</p>
                <p>画像: NASA/JPL-Caltech Mars Trek、HiRISE: NASA/JPL/University of Arizona。目印の名前は仮のもので、公式の地名ではありません。</p>
              </details>
            </section>; }
