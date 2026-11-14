import type { Dispatch, SetStateAction } from 'react';
import type { TrackPoint, Landmark, nearestBreadcrumb, buildTracBack, returnLimit } from '@core';
import { fmtKm, fmtLatLon } from './panelFormat';
type Mode = 'plan'|'traverse'|'lost'|'tracback';
type Props = {
 mode:Mode; setMode:Dispatch<SetStateAction<Mode>>; restored:boolean; playing:boolean; setPlaying:Dispatch<SetStateAction<boolean>>; simEnded:boolean;
 speed:number; setSpeed:(speed:number)=>void; forcedOffline:boolean; setForcedOffline:(v:boolean)=>void;
 track:TrackPoint[]; unsent:number; offRoute:boolean; deviation:number; simulation:boolean; reset:()=>void; startTracBack:()=>void;
 lost:{nb:NonNullable<ReturnType<typeof nearestBreadcrumb>>;plan:ReturnType<typeof buildTracBack>;fix:TrackPoint|null;near:{l:Landmark;d:number}[]}|null;
 limit:ReturnType<typeof returnLimit>|null; pos:TrackPoint|null; o2:number; backIdx:number; backStep_m:number; nextManeuver:number; backProgress:number;
};
export function FieldPanels({mode,setMode,restored,playing,setPlaying,simEnded,speed,setSpeed,forcedOffline,setForcedOffline,track,unsent,offRoute,deviation,simulation,reset,startTracBack,lost,limit,pos,o2,backIdx,backStep_m,nextManeuver,backProgress}:Props) {
 if(mode === 'plan') return null;
 return <section className="panel-card field-panel">          {mode === 'traverse' ? (
            <>
              <h2>足あとの記録</h2>              <button className="danger" onClick={() => { setPlaying(false); setMode('lost'); }} disabled={track.length < 3}>
                迷った
              </button>
              <div className="note">火星には GPS がありません。位置は推測航法による<b>推定</b>で、青い円が誤差の範囲です。この移動は<b>シミュレーション</b>です。</div>
              {restored ? <p className="muted small">復元した記録です。続きの再生はできませんが、「迷った」から来た道を戻れます。</p> : null}
              <div className="row">
                <button onClick={() => setPlaying((p) => !p)} disabled={simEnded}>
                  {playing ? '一時停止' : '再開'}
                </button>
                <label className="inline">
                  再生速度
                  <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                    <option value={1}>×1</option>
                    <option value={3}>×3</option>
                    <option value={8}>×8</option>
                  </select>
                </label>
              </div>
              <label className="switch">
                <input type="checkbox" checked={forcedOffline} onChange={(e) => setForcedOffline(e.target.checked)} />
                通信遮断モード（圏外にする）
              </label>
              <p className="muted small">圏外の間も記録は端末にたまり、通信が戻ると古い順に送られます。記録 {track.length} 点・未送信 {unsent} 件。</p>
              {offRoute ? <div className="note warn">予定ルートから {Math.round(deviation)} m 外れています。</div> : <p className="muted small">予定ルートからのずれ: {Math.round(deviation)} m</p>}
              {simEnded && !restored ? <div className="note warn">{simulation ? '周りの地形が予定と合いません。迷った可能性があります。' : '位置情報ファイルの再生が終わりました。'}</div> : null}

              <button className="ghost" onClick={reset}>計画に戻る</button>
            </>
          ) : null}

          {mode === 'lost' && lost && limit && pos ? (
            <>
              <h2>迷ったとき</h2>              <button className="primary big" onClick={startTracBack}>
                来た道を戻る
              </button>
              <div className={`limit ${limit.level}`}>
                <div className="small">帰還の限界</div>
                <b>{limit.text}</b>
                <div className="small">
                  戻りの所要 {Math.round(limit.t_back_min)} 分（余裕 1.3 倍込み）・酸素の残り {Math.round(o2)} 分
                </div>
              </div>
              <dl className="facts">
                <dt>今の推定位置</dt>
                <dd>{fmtLatLon(pos)}（誤差 ±{Math.round(pos.err_m)} m）</dd>
                <dt>いちばん近い足あと</dt>
                <dd>
                  方位 {Math.round(lost.nb.bearing_deg)}° へ {Math.round(lost.nb.distance_m)} m
                </dd>
                <dt>最後に位置を確定した地点</dt>
                <dd>{lost.fix ? `${lost.fix.lmst}（${lost.fix.note ?? '出発点'}）` : 'なし'}</dd>
                <dt>近くの目印</dt>
                <dd>{lost.near.map((n) => `${n.l.name}（${Math.round(n.d)} m）`).join('、')}</dd>
              </dl>

              <p className="muted small">行きに通れた道は帰りも通れる可能性が高いので、知らない近道より来た道を優先します。通信がなくても動きます。</p>
              <button className="ghost" onClick={() => { setMode('traverse'); }}>記録に戻る</button>
            </>
          ) : null}

          {mode === 'tracback' && lost && limit ? (
            <>
              <h2>とんぼ返り</h2>
              <div className="nav">
                <div className="small muted">次の案内</div>
                <b>{backIdx * backStep_m < lost.nb.distance_m ? `足あとまで、方位 ${Math.round(lost.nb.bearing_deg)}° へ ${Math.round(lost.nb.distance_m)} m` : lost.plan.maneuvers[nextManeuver]?.text}</b>
              </div>
              <div className={`limit ${limit.level}`}>
                <div className="small">帰還の限界</div>
                <b>{limit.level === 'red' ? limit.text : `余裕 ${Math.floor(limit.margin_min)} 分`}</b>
                <div className="small">
                  残り {fmtKm((1 - backProgress) * (lost.plan.total_m + lost.nb.distance_m))}・約 {Math.round(limit.t_back_min)} 分
                </div>
              </div>
              <ol className="steps">
                {lost.plan.maneuvers.map((m, i) => (
                  <li key={m.index} className={i === nextManeuver ? 'cur' : i < nextManeuver ? 'done' : ''}>
                    {m.text}
                  </li>
                ))}
              </ol>
              <label className="inline">
                再生速度
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  <option value={1}>×1</option>
                  <option value={3}>×3</option>
                  <option value={8}>×8</option>
                </select>
              </label>
            </>
          ) : null}
</section>;
}
