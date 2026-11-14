// 実際の地形データ（app/public/data、前処理の出力）での確認。データがなければスキップする。
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cellLatLon,
  computeSlopeAspect,
  explainRoute,
  haversine,
  isBlocked,
  latLonToCell,
  planRoute,
  type Grid,
} from '../src';

const dir = resolve(__dirname, '../../app/public/data');
const has = existsSync(resolve(dir, 'region.json')) && existsSync(resolve(dir, 'elev.f32'));

describe.skipIf(!has)('実データ（Gale、HiRISE DTM）', () => {
  const meta = has ? JSON.parse(readFileSync(resolve(dir, 'region.json'), 'utf-8')) : null;
  const buf = has ? readFileSync(resolve(dir, 'elev.f32')) : Buffer.alloc(0);
  const elev = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const grid: Grid = { ...meta, elev };
  const { slope, aspect } = has ? computeSlopeAspect(grid) : { slope: new Float32Array(), aspect: new Float32Array() };

  it('グリッドの大きさと位置が region.json と合う', () => {
    expect(elev.length).toBe(meta.width * meta.height);
    const nw = cellLatLon(grid, 0, 0);
    const se = cellLatLon(grid, meta.width - 1, meta.height - 1);
    expect(nw.lat).toBeLessThan(meta.north);
    expect(se.lat).toBeGreaterThan(meta.south);
    expect(se.lon).toBeLessThan(meta.east);
    // 南北の端から端までが約 3 km
    expect(haversine({ lat: meta.north, lon: meta.west }, { lat: meta.south, lon: meta.west })).toBeGreaterThan(2900);
    expect(latLonToCell(grid, cellLatLon(grid, 123, 456))).toEqual({ c: 123, r: 456 });
  });

  it('尾根をはさんだ北西 → 南東のルートが 1 秒以内に計算でき、通行不可のマスを通らない', () => {
    const start = { c: 60, r: 60 };
    const goal = { c: 540, r: 540 };
    const t0 = performance.now();
    const safe = planRoute(grid, slope, aspect, start, goal, 'safe');
    const ms = performance.now() - t0;
    const short = planRoute(grid, slope, aspect, start, goal, 'short');
    expect(safe).not.toBeNull();
    expect(short).not.toBeNull();
    expect(ms).toBeLessThan(1000);
    for (const i of safe!.cells) expect(isBlocked(grid, slope, i, 20)).toBe(false);
    expect(safe!.max_slope_deg).toBeLessThanOrEqual(20);
    expect(short!.planar_m).toBeLessThanOrEqual(safe!.planar_m + 1e-6);
    console.log(
      `safe: ${(safe!.surface_m / 1000).toFixed(2)} km, ${(safe!.est_time_s / 3600).toFixed(1)} h, max ${safe!.max_slope_deg.toFixed(1)}°, score ${safe!.safety_score}, ${ms.toFixed(0)} ms`,
    );
    console.log(
      `short: ${(short!.surface_m / 1000).toFixed(2)} km, ${(short!.est_time_s / 3600).toFixed(1)} h, max ${short!.max_slope_deg.toFixed(1)}°, score ${short!.safety_score}`,
    );
    console.log(explainRoute(safe!, short!).join(' / '));
  });
});
