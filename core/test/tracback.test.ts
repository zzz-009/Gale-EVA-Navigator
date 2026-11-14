import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  bearing,
  buildTracBack,
  countUnsent,
  deviationFromRoute,
  errRadius,
  flushUnsent,
  fromLocal,
  haversine,
  landmarkSide,
  lastFixIndex,
  MARS_RADIUS_M,
  nearestBreadcrumb,
  returnLimit,
  simplify,
  trackStats,
  type LatLon,
  type TrackPoint,
} from '../src';

const BASE: LatLon = { lat: -4.59, lon: 137.44 };

function pt(i: number, x: number, y: number, extra: Partial<TrackPoint> = {}): TrackPoint {
  const p = fromLocal(BASE, { x, y });
  return {
    id: `p${i}`,
    t_utc: new Date(Date.UTC(2026, 10, 14, 0, 0, i * 30)).toISOString(),
    sol: 0,
    lmst: '10:00',
    lat: p.lat,
    lon: p.lon,
    elev_m: 0,
    heading_deg: 0,
    err_m: 5 + 0.03 * i * 10,
    src: i === 0 ? 'fix' : 'dr',
    sent: true,
    simulated: true,
    ...extra,
  };
}

// 基地 → 東へ 300 m → 北へ 300 m（L 字）。10 m ごとに1点、少しだけ横にぶれる。
function lTrack(): TrackPoint[] {
  const out: TrackPoint[] = [];
  let i = 0;
  for (let x = 0; x <= 300; x += 10) out.push(pt(i++, x, (i % 2) * 1.5));
  for (let y = 10; y <= 300; y += 10) out.push(pt(i++, 300 + (i % 2) * 1.5, y));
  return out;
}

describe('geo', () => {
  it('経度 1° は赤道で約 59.3 km（火星の半径）', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) / 1000).toBeCloseTo(59.27, 1);
    expect(MARS_RADIUS_M).toBe(3396190);
  });
  it('方位: 東は 90°、南は 180°', () => {
    expect(bearing(BASE, fromLocal(BASE, { x: 100, y: 0 }))).toBeCloseTo(90, 1);
    expect(bearing(BASE, fromLocal(BASE, { x: 0, y: -100 }))).toBeCloseTo(180, 1);
  });
  it('方位の差は −180〜180', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(-180);
  });
});

describe('track', () => {
  it('誤差の円は進んだ距離の 3% ずつ広がる', () => {
    expect(errRadius(0)).toBe(5);
    expect(errRadius(1000)).toBeCloseTo(35, 6);
  });
  it('歩いた距離の合計が、点の間の距離の合計と一致する', () => {
    const t = lTrack();
    const s = trackStats(t);
    let sum = 0;
    for (let i = 1; i < t.length; i++) sum += haversine(t[i - 1], t[i]);
    expect(s.planar_m).toBeCloseTo(sum, 6);
    expect(s.planar_m).toBeGreaterThan(600);
    expect(s.elapsed_s).toBe((t.length - 1) * 30);
  });
  it('予定ルートからのずれ', () => {
    const route: [number, number][] = [
      [BASE.lat, BASE.lon],
      (() => {
        const p = fromLocal(BASE, { x: 500, y: 0 });
        return [p.lat, p.lon] as [number, number];
      })(),
    ];
    expect(deviationFromRoute(fromLocal(BASE, { x: 250, y: 42 }), route)).toBeCloseTo(42, 1);
    expect(deviationFromRoute(fromLocal(BASE, { x: 600, y: 0 }), route)).toBeCloseTo(100, 1);
  });
  it('通信遮断: 圏外の間の点の数 = 未送信の件数。戻ると 0 になる', () => {
    const t = lTrack().map((p, i) => ({ ...p, sent: i < 20 }));
    expect(countUnsent(t)).toBe(t.length - 20);
    const part = flushUnsent(t, 5);
    expect(countUnsent(part)).toBe(t.length - 25);
    expect(part[20].sent).toBe(true); // 古い順に送る
    expect(countUnsent(flushUnsent(t))).toBe(0);
  });
});

describe('tracback', () => {
  it('線の単純化: L 字の足あとは、両端と角の 3 点前後になる', () => {
    const t = lTrack();
    const xy = t.map((_, i) => (i <= 30 ? { x: i * 10, y: (i % 2) * 1.5 } : { x: 300, y: (i - 30) * 10 }));
    const kept = simplify(xy, t.map(() => 5));
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(t.length - 1);
    expect(kept.length).toBeLessThanOrEqual(5);
  });

  it('足あとを逆にたどると、基地に戻る（南 → 西 の 2 つの案内）', () => {
    const t = lTrack();
    const plan = buildTracBack(t, t.length - 1);
    const end = plan.coords[plan.coords.length - 1];
    expect(haversine({ lat: end[0], lon: end[1] }, BASE)).toBeLessThan(5); // 出発点の誤差の円の中
    expect(plan.maneuvers.length).toBe(2);
    expect(Math.abs(angleDiff(plan.maneuvers[0].bearing_deg, 180))).toBeLessThan(5); // 南へ
    expect(Math.abs(angleDiff(plan.maneuvers[1].bearing_deg, 270))).toBeLessThan(5); // 西へ
    expect(plan.total_m).toBeGreaterThan(590);
    expect(plan.total_m).toBeLessThan(610);
    expect(plan.est_time_s).toBeGreaterThan(0);
    expect(plan.maneuvers[1].text).toContain('基地');
  });

  it('迷ってからの点（fromIndex より後）は使わない', () => {
    const t = lTrack();
    const plan = buildTracBack(t, 30); // 角の点から戻る
    expect(plan.maneuvers.length).toBe(1);
    expect(plan.total_m).toBeCloseTo(300, 0);
  });

  it('目印の左右: 北へ進むとき、東の目印は右手', () => {
    expect(landmarkSide(0, 90)).toBe('right');
    expect(landmarkSide(0, 270)).toBe('left');
    expect(landmarkSide(0, 10)).toBe('ahead');
    expect(landmarkSide(0, 180)).toBeNull();
    expect(landmarkSide(180, 90)).toBe('left'); // 南へ進むとき、東の目印は左手
  });

  it('案内文に 300 m 以内の目印が入る', () => {
    const t = lTrack();
    const lm = fromLocal(BASE, { x: 400, y: 150 }); // 南へ戻る区間の東側
    const plan = buildTracBack(t, t.length - 1, [{ id: 'A', name: '目印A', lat: lm.lat, lon: lm.lon }]);
    expect(plan.maneuvers[0].landmark?.side).toBe('left');
    expect(plan.maneuvers[0].text).toContain('目印Aを左手に見て');
  });

  it('いちばん近い足あとの点は、位置が確かな点を優先する', () => {
    const t = lTrack();
    const pos = fromLocal(BASE, { x: 150, y: 60 });
    const nb = nearestBreadcrumb(pos, t)!;
    expect(nb.distance_m).toBeGreaterThan(55);
    expect(nb.distance_m).toBeLessThan(75);
    expect(Math.abs(angleDiff(nb.bearing_deg, 180))).toBeLessThan(30); // 足あとは南側
    // 同じ距離なら誤差の小さい点
    const a = pt(0, 0, 0, { err_m: 80 });
    const b = pt(1, 100, 0, { err_m: 5 });
    expect(nearestBreadcrumb(fromLocal(BASE, { x: 50, y: 0 }), [a, b])!.index).toBe(1);
    expect(lastFixIndex(t)).toBe(0);
  });

  it('帰還の限界: 残りが減ると 緑 → 黄 → 赤', () => {
    const tBack = 60 * 60; // 60 分（余裕込みで 78 分）
    expect(returnLimit(tBack, 200, 300).level).toBe('green');
    expect(returnLimit(tBack, 100, 300).level).toBe('amber');
    expect(returnLimit(tBack, 80, 300).level).toBe('red');
    expect(returnLimit(tBack, 200, 300).t_back_min).toBeCloseTo(78, 6);
    expect(returnLimit(tBack, 200, 90).margin_min).toBeCloseTo(12, 6); // バッテリーの方が先に尽きる
  });
});

describe('remainingAlongRoute', () => {
  it('L 字のルートで、残りの距離・ルートからの距離・進み具合が合う', async () => {
    const { remainingAlongRoute, fromLocal } = await import('../src');
    const B = { lat: -4.59, lon: 137.44 };
    const ll = (x: number, y: number): [number, number] => { const p = fromLocal(B, { x, y }); return [p.lat, p.lon]; };
    const route = [ll(0, 0), ll(300, 0), ll(300, 300)]; // 全長 600 m
    const r1 = remainingAlongRoute(fromLocal(B, { x: 100, y: 20 }), route);
    expect(r1.remaining_m).toBeCloseTo(500, 0);
    expect(r1.offRoute_m).toBeCloseTo(20, 0);
    expect(r1.progress).toBeCloseTo(1 / 6, 2);
    const r2 = remainingAlongRoute(fromLocal(B, { x: 300, y: 300 }), route);
    expect(r2.remaining_m).toBeCloseTo(0, 0);
    expect(r2.progress).toBeCloseTo(1, 3);
  });
});
