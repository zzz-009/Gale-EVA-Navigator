import { useEffect, useState } from 'react';
import { useRemoteDeviceChannel } from './deviceChannel';
import { loadWorld, type World } from './world';
import { HudView } from './HudView';
import { WristView } from './WristView';

export function DeviceView({ view }: { view: 'hud' | 'wrist' }) {
  const remote = useRemoteDeviceChannel();
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (view !== 'hud') return;
    let active = true;
    loadWorld().then((data) => { if (active) setWorld(data); }).catch((e) => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [view]);
  const state = remote.snapshot;
  return <>
    {view === 'wrist' ? <WristView state={state} connected={remote.connected} send={remote.send} /> : state && world && state.hudOn ?
      <HudView world={world} state={state} /> : <main className="device-wait"><h1>ヘルメット表示</h1><p>{state && !state.hudOn ? 'HUD 表示 OFF' : '基地の画面と地形データを待っています'}</p><button disabled={!remote.connected} onClick={() => remote.send({ action: 'hud', value: true })}>HUD 表示 ON</button></main>}
    {!remote.connected || error || remote.error ? <div className="device-connection" role="status">{error ?? remote.error ?? '基地との連携待ち。基地画面を同じブラウザで開いてください。表示は更新されていません。'}</div> : null}
  </>;
}

function deviceUrl(view: 'hud' | 'wrist'): string {
  const url = new URL(window.location.href); url.searchParams.set('view', view); return url.toString();
}
export function DeviceLinks({ onHudOpen }: { onHudOpen: () => void }) {
  return <div className="device-links"><a href={deviceUrl('hud')} target="gale-hud" rel="noopener" onClick={onHudOpen}>HUDを別ウィンドウで開く</a><a href={deviceUrl('wrist')} target="gale-wrist" rel="noopener">腕の端末を開く</a><small>同じパソコン・同じブラウザで連携</small></div>;
}
