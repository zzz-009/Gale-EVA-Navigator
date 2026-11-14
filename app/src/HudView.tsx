import { useEffect, useRef } from 'react';
import { DestinationStatus } from './DestinationStatus';
import { positionLabel } from './position/source';
import { HudMap } from './hudMap';
import type { HudState, HudWorld } from './fieldState';
import { HealthStatus } from './HealthStatus';
import { OverviewMap } from './OverviewMap';

export function HudView({ world, state, onClose, onHealthToggle, onOverviewToggle }: { world: HudWorld; state: HudState; onClose?: () => void; onHealthToggle?: () => void; onOverviewToggle?: () => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const rotor = useRef<HTMLDivElement>(null);
  const controller = useRef<HudMap | null>(null);
  const angle = useRef(0);
  useEffect(() => {
    if (!mapEl.current) return;
    const map = new HudMap(mapEl.current, world); controller.current = map;
    return () => { controller.current = null; map.destroy(); };
  }, [world]);
  useEffect(() => {
    const delta = ((state.heading - angle.current + 540) % 360 + 360) % 360 - 180;
    angle.current += delta;
    if (rotor.current) rotor.current.style.transform = `translate(-50%, -50%) rotate(${-angle.current}deg)`;
    controller.current?.setPosition(state.position, state.heading, state.accuracy);
  }, [world, state.position?.lat, state.position?.lon, state.heading, state.accuracy]);
  useEffect(() => { controller.current?.setRoute(state.route); }, [world, state.route]);
  useEffect(() => { controller.current?.setTrack(state.track); }, [world, state.track]);
  useEffect(() => { controller.current?.setBaseMap(state.baseMapMode); }, [world, state.baseMapMode]);
  return <section className="hud" aria-label="ヘルメット表示">
    <div className="hud-viewport"><div className="hud-map-window"><div ref={rotor} className="hud-rotor"><div ref={mapEl} className="hud-map" /></div></div></div>
    <div className="hud-top"><DestinationStatus info={state.destination} /><div className="hud-actions">{onHealthToggle ? <button aria-pressed={state.healthOn} onClick={onHealthToggle}>健康状態 {state.healthOn ? 'OFFにする' : 'ONにする'}</button> : null}{onOverviewToggle ? <button aria-pressed={state.overviewOn} onClick={onOverviewToggle}>全体図を{state.overviewOn ? '隠す' : '表示'}</button> : null}{onClose ? <button onClick={onClose}>基地の画面へ戻る</button> : null}</div></div>
    {state.overviewOn ? <OverviewMap world={world} state={state} /> : null}
    {state.healthOn ? <HealthStatus health={state.health} /> : null}
    <div className="hud-position">{state.online ? '● 通信可' : '⚠ 圏外'}<br />{positionLabel(state.source, state.online)}<br />誤差 ±{Math.round(state.accuracy)} m{!state.position ? ' / 現在地を待っています' : ''}</div>
    <div className="hud-warning" role="status" title={state.warning ?? undefined}>{state.warning ?? '周囲の地形を確認して進んでください'}</div>
    <small className="hud-credit">画像: NASA/JPL-Caltech Mars Trek・HiRISE NASA/JPL/University of Arizona</small>
  </section>;
}
