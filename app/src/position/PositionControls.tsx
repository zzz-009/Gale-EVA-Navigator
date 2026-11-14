import type { usePositionFeed } from './usePositionFeed';
import { positionLabel } from './source';

export function PositionControls({ feed, planning, online }: { feed: ReturnType<typeof usePositionFeed>; planning: boolean; online: boolean }) {
  return <section className="position-controls">
    <label>位置の取得元 <select value={feed.kind} disabled={!planning} onChange={(e) => feed.setKind(e.target.value as 'simulation' | 'json')}>
      <option value="simulation">移動シミュレーション（迷う場面あり）</option><option value="json">JSON：衛星測位を仮定</option>
    </select></label>
    <label className="position-file">位置情報ファイルを読み込む<input type="file" accept=".json,application/json" disabled={!planning} onChange={(e) => { const file = e.target.files?.[0]; if (file) void feed.loadFile(file); e.target.value = ''; }} /></label>
    {feed.error ? <p role="alert">{feed.error}</p> : null}
    {feed.kind === 'json' ? <p>将来の火星の測位衛星を仮定したテストです。圏外では衛星の位置は届きません。{feed.feed ? ` ${feed.feed.positions.length}点を読み込み済み。` : ''}</p> : null}
    {!planning ? <p>{positionLabel(feed.fix?.source ?? (feed.kind === 'json' ? 'dead_reckoning' : 'simulation'), online)}{feed.fix ? ` / 誤差 ±${Math.round(feed.fix.accuracy_m)} m` : ''}</p> : null}
  </section>;
}
