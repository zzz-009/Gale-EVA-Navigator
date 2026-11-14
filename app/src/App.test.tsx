import { act } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import { afterEach, expect, it, vi } from 'vitest';
import { cellLatLon, type Grid } from '@core';
import { App } from './App';
import { MapController } from './mapController';
import { loadWorld, type World } from './world';
import { loadSession, saveSession, type SavedSession } from './store';
import { useBaseDeviceChannel } from './deviceChannel';

vi.mock('./world', () => ({ loadWorld: vi.fn() }));
vi.mock('./store', () => ({ loadSession: vi.fn(), saveSession: vi.fn(), clearSession: vi.fn() }));
vi.mock('./deviceChannel', () => ({ useBaseDeviceChannel: vi.fn(() => null) }));
vi.mock('./heatmap', () => ({ renderRiskHeat: () => null }));

// Synthetic terrain used only for interaction tests.
function makeWorld(): World {
  const grid: Grid = { width: 70, height: 70, cell_m: 10, north: 1, west: 0, elev: new Float32Array(4900) };
  const southEast = cellLatLon(grid, 70, 70);
  return {
    grid, slope: new Float32Array(4900), aspect: new Float32Array(4900),
    region: { north: grid.north, west: grid.west, south: southEast.lat, east: southEast.lon, cell_m: 10,
      slope_max_deg: 20, slope_limited_deg: 15, source: { credit: 'test', product: 'test', note: 'synthetic terrain' } },
    contours: { type: 'FeatureCollection', features: [] }, hazards: { type: 'FeatureCollection', features: [] },
    base: { id: 'base', name: '基地', ...cellLatLon(grid, 10, 10) },
    targets: [{ id: 'T1', name: '目標A', ...cellLatLon(grid, 50, 40) }], landmarks: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('places sites from either map, replans from the new base, and restores sites with the recorded session', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(450);
  const svg = L.Browser.svg;
  Object.defineProperty(L.Browser, 'svg', { value: true, configurable: true });
  const world = makeWorld();
  vi.mocked(loadWorld).mockResolvedValue(world);
  vi.mocked(loadSession).mockResolvedValue(null);
  vi.mocked(saveSession).mockResolvedValue(true);
  const fetchFeed = vi.fn(async () => ({ ok: true, json: async () => ({ format: 'gale-eva-positions/1', positions: [
    { ...world.base, t_utc: '2026-11-15T00:00:00Z', accuracy_m: 5 },
  ] }) }));
  vi.stubGlobal('fetch', fetchFeed);
  const sites = vi.spyOn(MapController.prototype, 'setSites');
  const routeCalls = vi.spyOn(MapController.prototype, 'setRoutes');
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root = createRoot(container);
  const settle = (ms = 80) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  const clickButton = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);
    expect(button, text).toBeDefined();
    await act(async () => button!.click());
  };

  try {
    await act(async () => root.render(<App />));
    await settle();
    const controllers = [...new Set(sites.mock.contexts as MapController[])];
    const operation = controllers.find((controller) => !controller.map.getContainer().closest('#dashboard-overview'))!;
    const overview = controllers.find((controller) => controller !== operation)!;
    const newBase = cellLatLon(world.grid, 15, 15);
    await act(async () => operation.map.fire('click', { latlng: L.latLng(newBase.lat, newBase.lon) }));
    await clickButton('ここに基地を置く');
    await settle();
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    expect(sites.mock.calls.slice(-2).every(([base]) => base.lat === newBase.lat && base.lon === newBase.lon)).toBe(true);
    expect(routeCalls.mock.lastCall![0][0].coords[0]).toEqual([newBase.lat, newBase.lon]);

    const destination = cellLatLon(world.grid, 45, 45);
    await act(async () => overview.map.fire('click', { latlng: L.latLng(destination.lat, destination.lon) }));
    await clickButton('ここに目的地を追加');
    await settle();
    const added = sites.mock.lastCall![1].find((target) => target.id.startsWith('custom-'))!;
    expect(added).toMatchObject(destination);
    const selectedRoute = routeCalls.mock.lastCall![0][0];
    expect(selectedRoute.coords.at(-1)).toEqual([destination.lat, destination.lon]);
    expect(useBaseDeviceChannel).toHaveBeenLastCalledWith(expect.objectContaining({ base: expect.objectContaining(newBase) }), expect.anything());

    await clickButton('このルートで出発（シミュレーション）');
    await settle(300);
    await settle(1000);
    const saved = vi.mocked(saveSession).mock.lastCall![0];
    expect(saved.base).toMatchObject(newBase);
    expect(saved.targets).toContainEqual(added);
    expect(saved.track[0]).toMatchObject(newBase);

    vi.mocked(loadSession).mockResolvedValue({ ...saved, version: 1, savedAt: new Date().toISOString() } as SavedSession);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<App />));
    await settle();
    expect(sites.mock.lastCall![0]).toMatchObject(newBase);
    expect(sites.mock.lastCall![1]).toContainEqual(added);
    expect(sites.mock.lastCall![3]).toBe(added.id);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    Object.defineProperty(L.Browser, 'svg', { value: svg, configurable: true });
  }
});
