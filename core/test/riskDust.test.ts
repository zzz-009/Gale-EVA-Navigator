import { describe, expect, it } from 'vitest';
import { computeSlopeAspect, dustForecast, haversine, idx, riskAt, riskBand, RISK_BANDS, slopeForRisk, type Grid } from '../src';

function slopeGrid(deg: number, rough = 0): { g: Grid; slope: Float32Array } {
  const w = 5, cell = 10;
  const g: Grid = { width: w, height: w, cell_m: cell, north: -4.7, west: 137.4, elev: new Float32Array(w * w), rough: new Float32Array(w * w).fill(rough) };
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) g.elev[idx(g, c, r)] = c * cell * Math.tan((deg * Math.PI) / 180);
  return { g, slope: computeSlopeAspect(g).slope };
}

describe('riskAt', () => {
  it('危険度 = 傾斜の項 + 起伏の項。傾斜 10°・起伏 0.2 → 0.25 + 0.1', () => {
    const { g, slope } = slopeGrid(10, 0.2);
    const r = riskAt(g, slope, idx(g, 2, 2))!;
    expect(r.slopeTerm).toBeCloseTo(0.25, 4);
    expect(r.roughTerm).toBeCloseTo(0.1, 6);
    expect(r.risk).toBeCloseTo(0.35, 4);
    expect(r.blocked).toBe(false);
  });
  it('上限を超えるマスは 1（通行不可）で、赤の帯', () => {
    const { g, slope } = slopeGrid(25);
    const r = riskAt(g, slope, idx(g, 2, 2))!;
    expect(r.blocked).toBe(true);
    expect(r.risk).toBe(1);
    expect(r.band).toBe(4);
  });
  it('値がないマスは null', () => {
    const { g, slope } = slopeGrid(5);
    g.elev[idx(g, 2, 2)] = NaN;
    expect(riskAt(g, slope, idx(g, 2, 2))).toBeNull();
  });
  it('帯の境界と、目安の傾斜', () => {
    expect(riskBand(0.1)).toBe(0);
    expect(riskBand(0.2)).toBe(1);
    expect(riskBand(0.5)).toBe(2);
    expect(riskBand(0.7)).toBe(3);
    expect(riskBand(0.9)).toBe(4);
    expect(RISK_BANDS).toHaveLength(5);
    expect(slopeForRisk(0.6)).toBeCloseTo(15.49, 2); // オレンジの始まり ≒ 15°
    expect(slopeForRisk(0.35)).toBeCloseTo(11.83, 2); // 黄の始まり ≒ 12°
  });
});

describe('dustForecast', () => {
  const center = { lat: -4.71, lon: 137.39 };
  it('同じ種なら同じシナリオ（デモで再現できる）', () => {
    expect(dustForecast({ seed: 7, center })).toEqual(dustForecast({ seed: 7, center }));
  });
  it('13 フレーム（0〜12 時間）、各 3 個、砂嵐は時間とともに動く', () => {
    const f = dustForecast({ seed: 7, center });
    expect(f.frames).toHaveLength(13);
    for (const fr of f.frames) expect(fr.cells).toHaveLength(3);
    expect(haversine(f.frames[0].cells[0], f.frames[12].cells[0])).toBeGreaterThan(30000);
    expect(f.note).toContain('シミュレーション');
  });
  it('1 つ目の砂嵐は活動地域に近づき、到達時刻と距離が整合する', () => {
    for (const seed of [1, 7, 42, 2026]) {
      const f = dustForecast({ seed, center });
      expect(f.nearest_km[12]).toBeLessThan(f.nearest_km[0]);
      if (f.arrival_hour !== null) {
        expect(f.nearest_km[f.arrival_hour]).toBe(0);
        if (f.arrival_hour > 0) expect(f.nearest_km[f.arrival_hour - 1]).toBeGreaterThan(0);
      }
    }
  });
  it('表示範囲は中心を含む約 200 km 四方', () => {
    const f = dustForecast({ seed: 7, center });
    const [[s, w], [n, e]] = f.bounds;
    expect(s).toBeLessThan(center.lat);
    expect(n).toBeGreaterThan(center.lat);
    expect(haversine({ lat: s, lon: w }, { lat: n, lon: w }) / 1000).toBeCloseTo(200, 0);
    expect(e).toBeGreaterThan(w);
  });
});
