import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { cellLatLon, haversine, idx } from '@core';
import { loadWorld } from './world';

const directory = resolve(process.cwd(), 'public/data');
const region = JSON.parse(readFileSync(resolve(directory, 'region.json'), 'utf8'));
afterEach(() => vi.unstubAllGlobals());

// Claude replaces the dataset later; this historical cell-index comparison applies only to the 3 km grid.
it.skipIf(region.width !== 600 || region.height !== 600)('keeps all four sites at the previous freeCell locations in the existing 3 km dataset', async () => {
  vi.stubGlobal('fetch', async (url) => {
    const bytes = readFileSync(resolve(directory, url.replace('/data/', '')));
    return { ok: true, json: async () => JSON.parse(bytes.toString()), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  });
  const world = await loadWorld();
  expect(world.grid.width).toBe(600);
  expect(world.grid.height).toBe(600);
  const oldCells = [[70, 80], [546, 220], [380, 300], [540, 460]];
  const expected = oldCells.map(([c, r]) => {
    for (let radius = 0; radius < 40; radius++) {
      for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
        const x = c + dc, y = r + dr;
        if (x >= 0 && y >= 0 && x < world.grid.width && y < world.grid.height && world.slope[idx(world.grid, x, y)] < 8) {
          return cellLatLon(world.grid, x, y);
        }
      }
    }
    return cellLatLon(world.grid, c, r);
  });
  [world.base, ...world.targets].forEach((site, index) => expect({ lat: site.lat, lon: site.lon }).toEqual(expected[index]));
  expect(world.landmarks.every((landmark) => haversine(world.base, landmark) <= 3000)).toBe(true);
});

