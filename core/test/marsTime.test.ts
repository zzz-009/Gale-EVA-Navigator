import { describe, expect, it } from 'vitest';
import {
  azElFromSubpoint,
  formatHours,
  lmstHours,
  ltstHours,
  marsTime,
  missionSol,
  sunAzEl,
  ttMinusUtcSeconds,
} from '../src';

// Mars24 のアルゴリズムの説明ページにある計算例: 2000-01-06 00:00:00 UTC
describe('marsTime（Mars24 の計算例: 2000-01-06 00:00:00 UTC）', () => {
  const mt = marsTime(new Date(Date.UTC(2000, 0, 6, 0, 0, 0)));

  it('TT − UTC = 64.184 秒', () => {
    expect(ttMinusUtcSeconds(Date.UTC(2000, 0, 6))).toBeCloseTo(64.184, 6);
    expect(ttMinusUtcSeconds(Date.UTC(2026, 10, 14))).toBeCloseTo(69.184, 6);
  });
  it('J2000 からの日数', () => {
    expect(mt.jd_tt).toBeCloseTo(2451549.50074, 5);
    expect(mt.dt_j2000).toBeCloseTo(4.50074, 5);
  });
  it('平均近点角・仮想の平均太陽・摂動・中心差', () => {
    expect(mt.M).toBeCloseTo(21.74558, 4);
    expect(mt.alpha_fms).toBeCloseTo(272.74566, 4);
    expect(mt.pbs).toBeCloseTo(0.00142, 4);
    expect(mt.nu_minus_M).toBeCloseTo(4.44193, 4);
  });
  it('太陽黄経 Ls と均時差', () => {
    expect(mt.ls).toBeCloseTo(277.18758, 4);
    expect(mt.eot_deg).toBeCloseTo(-5.18774, 4);
  });
  it('火星日 MSD と火星の協定時 MTC', () => {
    expect(mt.msd).toBeCloseTo(44795.99976, 4);
    expect(mt.mtc_h).toBeCloseTo(23.99425, 4);
    expect(formatHours(mt.mtc_h)).toBe('23:59');
  });
  it('経度 0° の地方時', () => {
    expect(lmstHours(mt, 0)).toBeCloseTo(23.99425, 4);
    expect(ltstHours(mt, 0)).toBeCloseTo(23.64841, 3);
  });
});

describe('太陽の位置', () => {
  it('直下点では仰角 90°、反対側では −90°', () => {
    // 仰角 ±90° 付近は逆正弦の計算誤差が出やすいので、小数 4 桁で比べる
    expect(azElFromSubpoint(10, 50, 10, 50).el).toBeCloseTo(90, 4);
    expect(azElFromSubpoint(-10, -130, 10, 50).el).toBeCloseTo(-90, 4);
  });
  it('直下点より東にいると、太陽は西の空（午後）', () => {
    const { az, el } = azElFromSubpoint(0, 30, 0, 0);
    expect(el).toBeCloseTo(60, 6);
    expect(az).toBeCloseTo(270, 6);
  });
  it('Gale では、地方真太陽時の正午ごろに太陽の仰角が最大になる', () => {
    const lat = -4.59;
    const lon = 137.44;
    const t0 = Date.UTC(2026, 10, 14, 0, 0, 0);
    let best = -Infinity;
    let bestT = 0;
    for (let m = 0; m < 1480; m += 2) {
      const d = new Date(t0 + m * 60000);
      const el = sunAzEl(d, lat, lon).el;
      if (el > best) {
        best = el;
        bestT = d.getTime();
      }
    }
    const ltst = ltstHours(marsTime(new Date(bestT)), lon);
    expect(Math.abs(ltst - 12)).toBeLessThan(0.1);
    expect(best).toBeGreaterThan(55); // 低緯度なので、正午の太陽は高い
  });
  it('太陽は東から昇って西に沈む', () => {
    const lat = -4.59;
    const lon = 137.44;
    const t0 = Date.UTC(2026, 10, 14, 0, 0, 0);
    let prev = sunAzEl(new Date(t0), lat, lon);
    let rise: number | null = null;
    let set: number | null = null;
    for (let m = 2; m < 1480; m += 2) {
      const cur = sunAzEl(new Date(t0 + m * 60000), lat, lon);
      if (prev.el < 0 && cur.el >= 0) rise = cur.az;
      if (prev.el >= 0 && cur.el < 0) set = cur.az;
      prev = cur;
    }
    expect(rise).not.toBeNull();
    expect(set).not.toBeNull();
    expect(rise!).toBeGreaterThan(45);
    expect(rise!).toBeLessThan(135);
    expect(set!).toBeGreaterThan(225);
    expect(set!).toBeLessThan(315);
  });
});

describe('missionSol', () => {
  it('着陸した Sol が 0。1 火星日（約 24 時間 39.6 分）たつと 1', () => {
    const landing = new Date(Date.UTC(2012, 7, 6, 5, 17, 57));
    const lon = 137.44;
    expect(missionSol(landing, landing, lon)).toBe(0);
    const later = new Date(landing.getTime() + 10 * 88775244);
    expect(missionSol(later, landing, lon)).toBe(10);
  });
});
