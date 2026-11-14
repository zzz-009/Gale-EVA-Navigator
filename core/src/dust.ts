// 砂嵐の予報（訓練用のシミュレーション）。設計書 06 の 5 章。
// 火星の砂嵐を 1 時間ごとに予報する公開データはないため、決まった乱数の種から
// 再現できるシナリオを作る。本物の予報として表示しないこと。

import { fromLocal, haversine, MARS_RADIUS_M, type LatLon } from './geo';

export type DustCell = { lat: number; lon: number; radius_km: number; intensity: number };
export type DustFrame = { hour: number; cells: DustCell[] };
export type DustForecast = {
  frames: DustFrame[];
  arrival_hour: number | null;
  nearest_km: number[]; // 各時刻の、活動地域の中心から最も近い砂嵐の縁までの距離（中に入っていれば 0）
  bounds: [[number, number], [number, number]]; // [[南, 西], [北, 東]]
  note: string;
};

export const DUST_NOTE = '訓練用のシミュレーションです（実際の予報ではありません）';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function dustForecast(opt: { seed: number; center: LatLon; hours?: number; halfSpan_km?: number }): DustForecast {
  const hours = opt.hours ?? 12;
  const half = (opt.halfSpan_km ?? 100) * 1000;
  const c = opt.center;
  const r = rng(opt.seed);

  // 風: 全体で同じ向き（西〜北西から吹くことが多い想定）。速さ 4〜8 km/時
  const windDir = (250 + r() * 40) * (Math.PI / 180); // 吹いていく向き（北 = 0、時計回り）の逆を作らないよう、移動の向きとして使う
  const moveDir = windDir - Math.PI; // 東〜南東へ動く
  const speed = 4000 + r() * 4000; // m/時

  // 砂嵐 3 個。1 つ目は活動地域に近づくように置く
  type Seed = { x: number; y: number; r0: number; growth: number; i0: number; di: number };
  const seeds: Seed[] = [];
  for (let k = 0; k < 3; k++) {
    const toward = k === 0;
    const dist = toward ? 55000 + r() * 15000 : 30000 + r() * 60000;
    const ang = toward ? moveDir + Math.PI + (r() - 0.5) * 0.3 : r() * 2 * Math.PI;
    seeds.push({
      x: Math.sin(ang) * dist,
      y: Math.cos(ang) * dist,
      r0: 8000 + r() * 10000,
      growth: 500 + r() * 1500, // m/時
      i0: 0.35 + r() * 0.4,
      di: (r() - 0.3) * 0.05,
    });
  }

  const frames: DustFrame[] = [];
  const nearest: number[] = [];
  let arrival: number | null = null;
  for (let h = 0; h <= hours; h++) {
    const cells: DustCell[] = seeds.map((s) => {
      const x = s.x + Math.sin(moveDir) * speed * h;
      const y = s.y + Math.cos(moveDir) * speed * h;
      const p = fromLocal(c, { x, y }, MARS_RADIUS_M);
      return {
        lat: p.lat,
        lon: p.lon,
        radius_km: (s.r0 + s.growth * h) / 1000,
        intensity: Math.max(0.1, Math.min(1, s.i0 + s.di * h)),
      };
    });
    let near = Infinity;
    for (const cell of cells) near = Math.min(near, Math.max(0, haversine(c, cell) / 1000 - cell.radius_km));
    nearest.push(near);
    if (arrival === null && near === 0) arrival = h;
    frames.push({ hour: h, cells });
  }

  const sw = fromLocal(c, { x: -half, y: -half });
  const ne = fromLocal(c, { x: half, y: half });
  return {
    frames,
    arrival_hour: arrival,
    nearest_km: nearest,
    bounds: [[sw.lat, sw.lon], [ne.lat, ne.lon]],
    note: DUST_NOTE,
  };
}
