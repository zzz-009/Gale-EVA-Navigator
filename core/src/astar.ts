// グリッド上の経路探索（A*）。設計書 docs/design/01_route_planner.md の 5.2〜5.4。
// コストの各項はすべて 0 以上。ヒューリスティックは「水平距離 × w_t」で、過大評価にならない。

import { crossSlopeDeg, idx, type Grid } from './grid';
import { DEFAULT_V0, walkSpeed } from './walkSpeed';

export type Weights = { w_t: number; w_r: number; w_s: number };
export type RoutePreset = 'safe' | 'short' | 'science';

export const PRESETS: Record<RoutePreset, Weights> = {
  safe: { w_t: 0.3, w_r: 1.0, w_s: 0 },
  short: { w_t: 1.0, w_r: 0.1, w_s: 0 },
  science: { w_t: 0.3, w_r: 0.3, w_s: 1.0 },
};

export type PathOptions = {
  weights: Weights;
  slopeMaxDeg?: number; // これを超えるマスは通行不可（初期値 20）
  v0?: number;
  useHeuristic?: boolean; // false にするとダイクストラ法（検証用）
};

export type PathResult = { cells: number[]; cost: number; expanded: number };

// [列の増分, 行の増分, 方位（度）]。行は南向きに増える。
const NEIGHBORS: [number, number, number][] = [
  [0, -1, 0],
  [1, -1, 45],
  [1, 0, 90],
  [1, 1, 135],
  [0, 1, 180],
  [-1, 1, 225],
  [-1, 0, 270],
  [-1, -1, 315],
];

export function isBlocked(g: Grid, slope: Float32Array, i: number, slopeMaxDeg: number): boolean {
  if (g.nogo && g.nogo[i]) return true;
  if (!Number.isFinite(g.elev[i])) return true;
  const s = slope[i];
  return !Number.isFinite(s) || s > slopeMaxDeg;
}

/** マス a から隣のマス b へ1歩進むコストと、その内訳。 */
export function stepCost(
  g: Grid,
  slope: Float32Array,
  aspect: Float32Array,
  a: number,
  b: number,
  diagonal: boolean,
  headingDeg: number,
  w: Weights,
  slopeMaxDeg: number,
  v0: number,
): { cost: number; d: number; dh: number; time: number; risk: number; sci: number; cross: number } {
  const dh = g.cell_m * (diagonal ? Math.SQRT2 : 1);
  const dz = g.elev[b] - g.elev[a];
  const d = Math.hypot(dh, dz);
  const time = d / walkSpeed(dz / dh, v0);
  const sNorm = slope[b] / slopeMaxDeg;
  const cross = crossSlopeDeg(slope[b], aspect[b], headingDeg);
  const rough = g.rough ? g.rough[b] : 0;
  const risk = d * (sNorm * sNorm + rough + 0.5 * (cross / slopeMaxDeg));
  const sci = d * (1 - (g.science ? g.science[b] : 0));
  const cost = w.w_t * (time * v0) + w.w_r * risk + w.w_s * sci;
  return { cost, d, dh, time, risk, sci, cross };
}

/** 最小ヒープ（キー = f の値）。 */
class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, key: number): void {
    const { items, keys } = this;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p];
      keys[i] = keys[p];
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }
  pop(): number {
    const { items, keys } = this;
    const top = items[0];
    const lastItem = items.pop() as number;
    const lastKey = keys.pop() as number;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let ch = 2 * i + 1;
        if (ch >= n) break;
        if (ch + 1 < n && keys[ch + 1] < keys[ch]) ch++;
        if (keys[ch] >= lastKey) break;
        items[i] = items[ch];
        keys[i] = keys[ch];
        i = ch;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}

/**
 * start から goal までの最小コストの経路。通れなければ null。
 * 斜め移動は、角をはさむ2つのマスのどちらかが通行不可なら禁止（角のすり抜けを防ぐ）。
 */
export function findPath(
  g: Grid,
  slope: Float32Array,
  aspect: Float32Array,
  start: { c: number; r: number },
  goal: { c: number; r: number },
  opt: PathOptions,
): PathResult | null {
  const slopeMax = opt.slopeMaxDeg ?? 20;
  const v0 = opt.v0 ?? DEFAULT_V0;
  const w = opt.weights;
  const useH = opt.useHeuristic ?? true;
  const n = g.width * g.height;
  const s = idx(g, start.c, start.r);
  const t = idx(g, goal.c, goal.r);
  if (isBlocked(g, slope, s, slopeMax) || isBlocked(g, slope, t, slopeMax)) return null;

  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();

  // 8 方向の格子での水平距離（オクタイル距離）× w_t。実際のコスト以下になる。
  const h = (i: number): number => {
    if (!useH) return 0;
    const dc = Math.abs((i % g.width) - goal.c);
    const dr = Math.abs(Math.floor(i / g.width) - goal.r);
    const octile = Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
    return w.w_t * octile * g.cell_m;
  };

  gScore[s] = 0;
  heap.push(s, h(s));
  let expanded = 0;

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === t) {
      const cells: number[] = [];
      for (let i = t; i !== -1; i = came[i]) cells.push(i);
      cells.reverse();
      return { cells, cost: gScore[t], expanded };
    }
    const cc = cur % g.width;
    const cr = Math.floor(cur / g.width);
    for (const [dc, dr, heading] of NEIGHBORS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= g.width || nr >= g.height) continue;
      const nb = idx(g, nc, nr);
      if (closed[nb] || isBlocked(g, slope, nb, slopeMax)) continue;
      const diagonal = dc !== 0 && dr !== 0;
      if (
        diagonal &&
        (isBlocked(g, slope, idx(g, nc, cr), slopeMax) || isBlocked(g, slope, idx(g, cc, nr), slopeMax))
      ) {
        continue;
      }
      const step = stepCost(g, slope, aspect, cur, nb, diagonal, heading, w, slopeMax, v0);
      const tentative = gScore[cur] + step.cost;
      if (tentative < gScore[nb]) {
        gScore[nb] = tentative;
        came[nb] = cur;
        heap.push(nb, tentative + h(nb));
      }
    }
  }
  return null;
}
