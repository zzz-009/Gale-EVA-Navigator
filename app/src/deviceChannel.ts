import { useEffect, useRef, useState } from 'react';
import type { HudState } from './fieldState';

export type DeviceSnapshot = HudState & { hudOn: boolean; mode: string; canLost: boolean; canReturn: boolean };
export type DeviceCommand = { action: 'hud' | 'health' | 'overview'; value: boolean } | { action: 'lost' } | { action: 'return' };
export type ChannelTransport = { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown): void; close(): void };
const PROTOCOL = 'gale-eva-devices/1';
const channel = (): ChannelTransport => new BroadcastChannel('gale-eva');
function commandFrom(value: unknown): DeviceCommand | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (c.action === 'lost' || c.action === 'return') return { action: c.action };
  if ((c.action === 'hud' || c.action === 'health' || c.action === 'overview') && typeof c.value === 'boolean') return { action: c.action, value: c.value };
  return null;
}

/** 基地だけが状態を持つ。子画面には表示用スナップショットを配る。 */
export class BaseDeviceChannel {
  readonly id = crypto.randomUUID();
  private snapshot: DeviceSnapshot | null = null;
  private seen = new Set<string>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private onCommand: (command: DeviceCommand) => void, private transport = channel()) {
    transport.onmessage = ({ data }) => {
      if (!data || data.protocol !== PROTOCOL) return;
      if (data.type === 'hello') { this.publish(); return; }
      if (data.type !== 'command' || data.target !== this.id || typeof data.id !== 'string' || this.seen.has(data.id)) return;
      const command = commandFrom(data.command);
      if (!command) return;
      this.seen.add(data.id);
      if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
      this.onCommand(command);
    };
    this.timer = setInterval(() => this.publish(), 200);
  }
  setSnapshot(snapshot: DeviceSnapshot | null): void { this.snapshot = snapshot; }
  private publish(): void {
    if (this.snapshot) this.transport.postMessage({ protocol: PROTOCOL, type: 'state', baseId: this.id, snapshot: this.snapshot });
  }
  close(): void { clearInterval(this.timer); this.transport.onmessage = null; this.transport.close(); }
}

export class RemoteDeviceChannel {
  private baseId: string | null = null;
  private lastReceived = 0;
  private timer: ReturnType<typeof setInterval>;
  constructor(private receive: (snapshot: DeviceSnapshot, connected: boolean) => void, private disconnected: () => void, private transport = channel()) {
    transport.onmessage = ({ data }) => {
      if (!data || data.protocol !== PROTOCOL || data.type !== 'state' || typeof data.baseId !== 'string' || !data.snapshot) return;
      // 複数の基地タブがある場合、最初に接続した基地を維持する。
      if (this.baseId && this.baseId !== data.baseId && Date.now() - this.lastReceived < 3500) return;
      this.baseId = data.baseId; this.lastReceived = Date.now();
      this.receive(data.snapshot as DeviceSnapshot, true);
    };
    this.hello();
    this.timer = setInterval(() => {
      if (Date.now() - this.lastReceived > 3500) { this.disconnected(); this.hello(); }
    }, 1000);
  }
  private hello(): void { this.transport.postMessage({ protocol: PROTOCOL, type: 'hello' }); }
  send(command: DeviceCommand): void {
    if (!this.baseId || Date.now() - this.lastReceived > 3500) return;
    this.transport.postMessage({ protocol: PROTOCOL, type: 'command', target: this.baseId, id: crypto.randomUUID(), command });
  }
  close(): void { clearInterval(this.timer); this.transport.onmessage = null; this.transport.close(); }
}

type Actions = { hud: (value: boolean) => void; health: (value: boolean) => void; overview: (value: boolean) => void; lost: () => void; return: () => void };
export function useBaseDeviceChannel(snapshot: DeviceSnapshot | null, actions: Actions): string | null {
  const latest = useRef({ snapshot, actions }); latest.current = { snapshot, actions };
  const bridge = useRef<BaseDeviceChannel | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') { setError('このブラウザは別ウィンドウ連携に対応していません。'); return; }
    const base = new BaseDeviceChannel((command) => {
      const { snapshot: state, actions: act } = latest.current;
      if (!state) return;
      if (command.action === 'lost') { if (state.canLost) act.lost(); }
      else if (command.action === 'return') { if (state.canReturn) act.return(); }
      else act[command.action](command.value);
    });
    bridge.current = base; base.setSnapshot(latest.current.snapshot);
    return () => { bridge.current = null; base.close(); };
  }, []);
  useEffect(() => { bridge.current?.setSnapshot(snapshot); }, [snapshot]);
  return error;
}

export function useRemoteDeviceChannel() {
  const [snapshot, setSnapshot] = useState<DeviceSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bridge = useRef<RemoteDeviceChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') { setError('このブラウザは別ウィンドウ連携に対応していません。'); return; }
    const remote = new RemoteDeviceChannel((state) => { setSnapshot(state); setConnected(true); }, () => setConnected(false));
    bridge.current = remote;
    return () => { bridge.current = null; remote.close(); };
  }, []);
  return { snapshot, connected, error, send: (command: DeviceCommand) => bridge.current?.send(command) };
}
