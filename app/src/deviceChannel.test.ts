import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseDeviceChannel, RemoteDeviceChannel, type ChannelTransport, type DeviceSnapshot } from './deviceChannel';

function bus() {
  const peers = new Set<ChannelTransport>();
  return () => {
    const peer: ChannelTransport = { onmessage: null,
      postMessage: (data) => { for (const other of peers) if (other !== peer) other.onmessage?.({ data: structuredClone(data) } as MessageEvent); },
      close: () => { peers.delete(peer); } };
    peers.add(peer); return peer;
  };
}
afterEach(() => vi.useRealTimers());
describe('基地・HUD・腕端末の連携', () => {
  it('遅れて開いた端末に状態を送り、腕の操作を基地経由でHUDに反映する', () => {
    vi.useFakeTimers();
    const connect = bus();
    const initial = { healthOn: false, hudOn: true } as DeviceSnapshot;
    const base = new BaseDeviceChannel((cmd) => {
      if (cmd.action === 'health') base.setSnapshot({ ...initial, healthOn: cmd.value });
    }, connect());
    base.setSnapshot(initial);
    const hud = vi.fn(), wrist = vi.fn();
    const display = new RemoteDeviceChannel(hud, vi.fn(), connect());
    const controls = new RemoteDeviceChannel(wrist, vi.fn(), connect());
    expect(hud).toHaveBeenLastCalledWith(initial, true);
    controls.send({ action: 'health', value: true });
    vi.advanceTimersByTime(200);
    expect(hud).toHaveBeenLastCalledWith({ ...initial, healthOn: true }, true);
    expect(wrist).toHaveBeenLastCalledWith({ ...initial, healthOn: true }, true);
    display.close(); controls.close(); base.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('基地が閉じたら切断を通知し、古い状態から操作を送らない', () => {
    vi.useFakeTimers();
    const connect = bus(), action = vi.fn(), disconnected = vi.fn();
    const base = new BaseDeviceChannel(action, connect());
    base.setSnapshot({ hudOn: true } as DeviceSnapshot);
    const remote = new RemoteDeviceChannel(vi.fn(), disconnected, connect());
    base.close(); vi.advanceTimersByTime(4000);
    expect(disconnected).toHaveBeenCalled();
    remote.send({ action: 'lost' }); expect(action).not.toHaveBeenCalled();
    remote.close(); expect(vi.getTimerCount()).toBe(0);
  });
});
