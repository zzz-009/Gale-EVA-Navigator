import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import { afterEach, expect, it, vi } from 'vitest';
import { OverviewPane, type OverviewHandle } from './OverviewPane';
import type { World } from './world';

const emptyFeatures: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const world = {
  region: { south: -5.4, north: -4.4, west: 137.2, east: 137.7, slope_max_deg: 20, slope_limited_deg: 15, cell_m: 10 },
  contours: emptyFeatures,
  hazards: emptyFeatures,
} as World;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([true, false])('keeps the same map and selected range across hiding and showing (initially visible=%s)', async (initiallyVisible) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.closest('[hidden]') ? 0 : 600;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.closest('[hidden]') ? 0 : 450;
  });
  const svg = L.Browser.svg;
  Object.defineProperty(L.Browser, 'svg', { value: true, configurable: true });

  let notifyResize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      notifyResize = () => callback([
        { contentRect: { width: 600, height: 450 } } as ResizeObserverEntry,
      ], this as unknown as ResizeObserver);
    }
    observe() {}
    disconnect = disconnect;
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const handle = createRef<OverviewHandle>();
  const selection = L.latLngBounds([-4.6, 137.4], [-4.58, 137.43]);
  const render = (visible: boolean, bounds = selection) => act(async () => {
    root.render(<OverviewPane world={world} selection={bounds} onSelection={() => {}} handle={handle} visible={visible} />);
  });

  try {
    await render(initiallyVisible);
    const map = handle.current!.controller.map;
    await render(false);
    expect(container.querySelector('section')!.hidden).toBe(true);

    const nextSelection = L.latLngBounds([-4.55, 137.45], [-4.53, 137.48]);
    await render(false, nextSelection);
    await render(true, nextSelection);
    notifyResize();
    expect(container.querySelector('section')!.hidden).toBe(false);
    expect(handle.current!.controller.map).toBe(map);
    expect(map.getSize()).toEqual(L.point(600, 450));
    const regionBounds = L.latLngBounds([world.region.south, world.region.west], [world.region.north, world.region.east]);
    expect(map.getZoom()).toBe(map.getBoundsZoom(regionBounds));
    expect(map.getBounds().contains(regionBounds)).toBe(true);
    expect(container.querySelectorAll('.leaflet-range-pane path')).toHaveLength(3);
    const rectangles: L.Rectangle[] = [];
    map.eachLayer((layer) => {
      if (layer instanceof L.Rectangle) rectangles.push(layer);
    });
    expect(rectangles.some((rectangle) => rectangle.getBounds().equals(nextSelection))).toBe(true);

    const mapElement = container.querySelector<HTMLElement>('.map')!;
    const leafletClasses = mapElement.className;
    const selectButton = container.querySelector<HTMLButtonElement>('.overview-tools button')!;
    for (const selecting of [true, false]) {
      await act(async () => selectButton.click());
      expect(container.querySelector('section')!.classList.contains('range-selecting')).toBe(selecting);
      expect(mapElement.className).toBe(leafletClasses);
      expect(mapElement.classList.contains('leaflet-container')).toBe(true);
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
    Object.defineProperty(L.Browser, 'svg', { value: svg, configurable: true });
  }
  expect(handle.current).toBeNull();
  expect(disconnect).toHaveBeenCalledOnce();
});
