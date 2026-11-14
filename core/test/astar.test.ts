import { describe, expect, it } from 'vitest';
import {
  buildRoute,
  computeSlopeAspect,
  explainRoute,
  findPath,
  idx,
  isBlocked,
  planRoute,
  PRESETS,
  safetyScore,
  walkSpeed,
  type Grid,
} from '../src';

function flatGrid(w: number, h: number, cell = 5): Grid {
  return { width: w, height: h, cell_m: cell, north: -4.5, west: 137.4, elev: new Float32Array(w * h) };
}

// 乱数（再現できるように種を固定）
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function hillyGrid(w: number, h: number, seed: number): Grid {
  const g = flatGrid(w, h);
  const r = rng(seed);
  const bumps = Array.from({ length: 6 }, () => ({
    c: r() * w,
    r: r() * h,
    a: 4 + r() * 10,
    s: 4 + r() * 6,
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let z = 0;
      for (const b of bumps) z += b.a * Math.exp(-((x - b.c) ** 2 + (y - b.r) ** 2) / (2 * b.s * b.s));
      g.elev[idx(g, x, y)] = z;
    }
  }
  return g;
}

describe('walkSpeed', () => {
  it('平らな地面で v0 の約 84%、緩い下りで最大', () => {
    expect(walkSpeed(0, 0.45)).toBeCloseTo(0.45 * Math.exp(-0.175), 6);
    expect(walkSpeed(-0.05, 0.45)).toBeCloseTo(0.45, 6);
    expect(walkSpeed(0.3, 0.45)).toBeLessThan(walkSpeed(0, 0.45));
  });
});

describe('findPath', () => {
  it('平らな格子では、対角線に沿ったまっすぐな道になる', () => {
    const g = flatGrid(10, 10);
    const { slope, aspect } = computeSlopeAspect(g);
    const res = findPath(g, slope, aspect, { c: 0, r: 0 }, { c: 9, r: 9 }, { weights: PRESETS.short });
    expect(res).not.toBeNull();
    expect(res!.cells.length).toBe(10);
    const route = buildRoute(g, slope, aspect, res!.cells, 'short');
    expect(route.planar_m).toBeCloseTo(9 * Math.SQRT2 * 5, 6);
    expect(route.max_slope_deg).toBe(0);
  });

  it('壁（通行不可）を迂回し、通行不可のマスを通らない', () => {
    const g = flatGrid(11, 11);
    g.nogo = new Uint8Array(11 * 11);
    for (let r = 0; r < 10; r++) g.nogo[idx(g, 5, r)] = 1; // 最下段だけ開いている壁
    const { slope, aspect } = computeSlopeAspect(g);
    const res = findPath(g, slope, aspect, { c: 0, r: 0 }, { c: 10, r: 0 }, { weights: PRESETS.short });
    expect(res).not.toBeNull();
    for (const i of res!.cells) expect(g.nogo[i]).toBe(0);
    expect(res!.cells).toContain(idx(g, 5, 10));
  });

  it('完全にふさがれていれば null', () => {
    const g = flatGrid(11, 11);
    g.nogo = new Uint8Array(11 * 11);
    for (let r = 0; r < 11; r++) g.nogo[idx(g, 5, r)] = 1;
    const { slope, aspect } = computeSlopeAspect(g);
    expect(findPath(g, slope, aspect, { c: 0, r: 0 }, { c: 10, r: 0 }, { weights: PRESETS.safe })).toBeNull();
  });

  it('斜め移動で壁の角をすり抜けない', () => {
    const g = flatGrid(3, 3);
    g.nogo = new Uint8Array(9);
    g.nogo[idx(g, 1, 0)] = 1;
    g.nogo[idx(g, 0, 1)] = 1;
    const { slope, aspect } = computeSlopeAspect(g);
    expect(findPath(g, slope, aspect, { c: 0, r: 0 }, { c: 2, r: 2 }, { weights: PRESETS.short })).toBeNull();
  });

  it('A* とダイクストラ法で、同じ最小コストになる（3つのプリセット × 起伏のある地形）', () => {
    for (const seed of [1, 7, 42]) {
      const g = hillyGrid(40, 40, seed);
      const { slope, aspect } = computeSlopeAspect(g);
      for (const preset of ['safe', 'short', 'science'] as const) {
        const o = { weights: PRESETS[preset], slopeMaxDeg: 25 };
        const a = findPath(g, slope, aspect, { c: 1, r: 1 }, { c: 38, r: 37 }, o);
        const d = findPath(g, slope, aspect, { c: 1, r: 1 }, { c: 38, r: 37 }, { ...o, useHeuristic: false });
        expect(a === null).toBe(d === null);
        if (a && d) {
          expect(a.cost).toBeCloseTo(d.cost, 6);
          expect(a.expanded).toBeLessThanOrEqual(d.expanded);
        }
      }
    }
  });

  it('傾斜の上限を超えるマスを通らない', () => {
    const g = hillyGrid(40, 40, 3);
    const { slope, aspect } = computeSlopeAspect(g);
    const res = findPath(g, slope, aspect, { c: 1, r: 1 }, { c: 38, r: 38 }, { weights: PRESETS.short, slopeMaxDeg: 12 });
    if (res) for (const i of res.cells) expect(isBlocked(g, slope, i, 12)).toBe(false);
  });

  it('安全ルートは最短ルートより急な区間が増えない', () => {
    const g = hillyGrid(60, 60, 11);
    const { slope, aspect } = computeSlopeAspect(g);
    const safe = planRoute(g, slope, aspect, { c: 2, r: 2 }, { c: 57, r: 57 }, 'safe', { slopeMaxDeg: 30 });
    const short = planRoute(g, slope, aspect, { c: 2, r: 2 }, { c: 57, r: 57 }, 'short', { slopeMaxDeg: 30 });
    expect(safe).not.toBeNull();
    expect(short).not.toBeNull();
    expect(short!.planar_m).toBeLessThanOrEqual(safe!.planar_m + 1e-6);
    expect(explainRoute(safe!, short!).length).toBeGreaterThan(0);
  });
});

describe('slope / route metrics', () => {
  it('一様な斜面の傾斜と向きが正しい', () => {
    const g = flatGrid(5, 5, 10);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) g.elev[idx(g, c, r)] = c * 10; // 東へ行くほど高い（45°）
    const { slope, aspect } = computeSlopeAspect(g);
    expect(slope[idx(g, 2, 2)]).toBeCloseTo(45, 4);
    expect(aspect[idx(g, 2, 2)]).toBeCloseTo(270, 4); // 西へ下る
  });

  it('登りのルートで、地表に沿った距離・登り・時間が合う', () => {
    const g = flatGrid(6, 1, 10);
    for (let c = 0; c < 6; c++) g.elev[c] = c * 1; // 勾配 0.1
    const { slope, aspect } = computeSlopeAspect(g);
    const route = buildRoute(g, slope, aspect, [0, 1, 2, 3, 4, 5], 'safe');
    expect(route.planar_m).toBeCloseTo(50, 6);
    expect(route.surface_m).toBeCloseTo(5 * Math.hypot(10, 1), 6);
    expect(route.ascent_m).toBeCloseTo(5, 6);
    expect(route.descent_m).toBe(0);
    expect(route.est_time_s).toBeCloseTo(route.surface_m / walkSpeed(0.1), 6);
  });

  it('EVA 安全スコアは 0〜100 で、条件が悪いほど下がる', () => {
    const good = safetyScore({ surface_m: 1000, limited_zone_m: 0, max_slope_deg: 4, est_time_s: 3600 });
    const bad = safetyScore({ surface_m: 1000, limited_zone_m: 600, max_slope_deg: 19, est_time_s: 20000, comm_out_m: 800 });
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeLessThanOrEqual(100);
    expect(bad).toBeGreaterThanOrEqual(0);
  });
});
