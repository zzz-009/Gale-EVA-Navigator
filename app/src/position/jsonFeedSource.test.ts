import { describe, expect, it, vi } from 'vitest';
import { JsonFeedSource, parsePositionFeed } from './jsonFeedSource';
import type { PositionFix } from './source';

// 実際の活動地域ではなく、単体テスト専用の合成領域。
const region = { north: 1, south: -1, west: -1, east: 1 };
const raw = (hiddenLon = 0.002) => ({ format: 'gale-eva-positions/1', positions: [0, 10, 20, 40].map((s, i) => ({ t_utc: new Date(Date.UTC(2026, 10, 14) + s * 1000).toISOString(), lat: 0, lon: i === 2 ? hiddenLon : i * 0.001, accuracy_m: 5 })) });
describe('JSONの位置取得', () => {
  it('共通の再生速度を変更するとJSONの受信時刻も加速し、停止でタイマーを解除する', () => {
    vi.useFakeTimers();
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const feed = raw();
    feed.positions.forEach((p, i) => { p.t_utc = new Date(Date.UTC(2026, 10, 14) + i * 30000).toISOString(); });
    const source = new JsonFeedSource(parsePositionFeed(feed, region), { lat: 0, lon: 0 }, () => {});
    const fixes: PositionFix[] = [];
    try {
      source.setSpeed(1); source.start((fix) => fixes.push(fix));
      now = 10000; vi.advanceTimersByTime(100);
      expect(fixes).toHaveLength(1);
      source.setSpeed(3);
      now = 14000; vi.advanceTimersByTime(100);
      expect(fixes).toHaveLength(1);
      source.setSpeed(8);
      now = 15000; vi.advanceTimersByTime(100);
      expect(fixes).toHaveLength(2);
      expect(fixes[1].t_utc).toBe(feed.positions[1].t_utc);
      source.stop(); expect(vi.getTimerCount()).toBe(0);
    } finally { source.stop(); clock.mockRestore(); vi.useRealTimers(); }
  });
  it('形式・地域外・時刻の重複・数値以外を拒否する', () => {
    expect(() => parsePositionFeed({ ...raw(), format: 'wrong' }, region)).toThrow('format');
    expect(() => parsePositionFeed(raw(2), region)).toThrow('活動地域');
    const duplicate = raw(); duplicate.positions[1].t_utc = duplicate.positions[0].t_utc;
    expect(() => parsePositionFeed(duplicate, region)).toThrow('昇順');
    expect(() => parsePositionFeed({ ...raw(), positions: [{ ...raw().positions[0], lat: '0' }] }, region)).toThrow('lat');
  });
  it('圏外中の衛星座標が異なっても推測結果は同じで、次の受信時に誤差5mへ戻る', () => {
    const run = (hidden: number) => {
      const fixes: PositionFix[] = [];
      const source = new JsonFeedSource(parsePositionFeed(raw(hidden), region), { lat: 0, lon: 0 }, () => {});
      const receive = (f: PositionFix) => fixes.push(f);
      source.advance(0, receive); source.advance(10000, receive);
      source.setOnline(false); source.advance(20000, receive); source.advance(30000, receive);
      const offline = fixes[fixes.length - 1];
      source.setOnline(true); source.advance(35000, receive);
      expect(fixes[fixes.length - 1].source).toBe('dead_reckoning');
      source.advance(40000, receive);
      expect(fixes[fixes.length - 1]).toMatchObject({ source: 'satellite', accuracy_m: 5, lon: 0.003 });
      return offline;
    };
    const a = run(0.002), b = run(0.8);
    expect(a).toEqual(b); expect(a.source).toBe('dead_reckoning'); expect(a.accuracy_m).toBeGreaterThan(5);
  });
});
