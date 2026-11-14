import type { DeviceCommand, DeviceSnapshot } from './deviceChannel';
import { DestinationStatus } from './DestinationStatus';

export function WristView({ state, connected, send }: { state: DeviceSnapshot | null; connected: boolean; send: (command: DeviceCommand) => void }) {
  return <main className="wrist">
    <h1>腕の端末</h1>
    <p role="status">{connected ? '基地と連携中' : '基地との接続待ち・操作できません'}</p>
    <DestinationStatus info={state?.destination ?? null} />
    <button disabled={!connected} aria-pressed={state?.hudOn ?? false} onClick={() => send({ action: 'hud', value: !state?.hudOn })}>HUD 表示 {state?.hudOn ? 'OFFにする' : 'ONにする'}</button>
    <button disabled={!connected} aria-pressed={state?.healthOn ?? false} onClick={() => send({ action: 'health', value: !state?.healthOn })}>健康状態 {state?.healthOn ? 'OFFにする' : 'ONにする'}</button>
    <button disabled={!connected} aria-pressed={state?.overviewOn ?? false} onClick={() => send({ action: 'overview', value: !state?.overviewOn })}>全体図を{state?.overviewOn ? '隠す' : '表示'}</button>
    <button className="wrist-danger" disabled={!connected || !state?.canLost} onClick={() => send({ action: 'lost' })}>迷った</button>
    <button disabled={!connected || !state?.canReturn} onClick={() => send({ action: 'return' })}>来た道を戻る</button>
    <small>同じパソコン・同じブラウザの基地画面と連携します。衛星測位は将来の衛星を仮定、健康状態はシミュレーションです。</small>
  </main>;
}
