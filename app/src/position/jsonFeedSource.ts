import { bearing, errRadius, fromLocal, haversine, walkSpeed, type LatLon } from '@core';
import type { RegionMeta } from '../mapController';
import type { PositionFix, ReplaySource } from './source';

export type PositionFeed = { format: 'gale-eva-positions/1'; description: string; positions: PositionFix[] };
export function parsePositionFeed(value: unknown, region: RegionMeta): PositionFeed {
  if (!value || typeof value !== 'object') throw new Error('JSONのルートはオブジェクトにしてください。');
  const data = value as Record<string, unknown>;
  if (data.format !== 'gale-eva-positions/1') throw new Error('formatはgale-eva-positions/1が必要です。');
  if (!Array.isArray(data.positions) || data.positions.length === 0) throw new Error('positionsは1点以上の配列にしてください。');
  let previous = -Infinity;
  const positions = data.positions.map((raw: unknown, i): PositionFix => {
    const p = raw as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') throw new Error(`positions[${i}]はオブジェクトにしてください。`);
    for (const key of ['lat', 'lon', 'accuracy_m']) if (typeof p[key] !== 'number' || !Number.isFinite(p[key])) throw new Error(`positions[${i}].${key}は有限の数値が必要です。`);
    const lat = p.lat as number, lon = p.lon as number;
    if (lat > region.north || lat < region.south || lon < region.west || lon > region.east) throw new Error(`positions[${i}]が活動地域の外です。`);
    const time = typeof p.t_utc === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(p.t_utc) ? Date.parse(p.t_utc) : NaN;
    if (!Number.isFinite(time) || time <= previous) throw new Error(`positions[${i}].t_utcはタイムゾーン付きで、時刻の昇順（重複なし）にしてください。`);
    previous = time;
    if ((p.accuracy_m as number) <= 0) throw new Error(`positions[${i}].accuracy_mは正の値にしてください。`);
    if (p.heading_deg !== undefined && (typeof p.heading_deg !== 'number' || !Number.isFinite(p.heading_deg) || p.heading_deg < 0 || p.heading_deg >= 360)) throw new Error(`positions[${i}].heading_degは0以上360未満にしてください。`);
    return { t_utc: new Date(time).toISOString(), lat, lon, accuracy_m: 5, heading_deg: p.heading_deg as number | undefined, source: 'satellite' };
  });
  return { format: 'gale-eva-positions/1', description: typeof data.description === 'string' ? data.description : '衛星測位を仮定したテスト', positions };
}

/** 圏外では未受信の座標・向きを一切使わず、最後の受信情報だけで外挿する。 */
export class JsonFeedSource implements ReplaySource {
  private cursor = 0;
  private elapsed = 0;
  private anchor = 0;
  private speed = 1;
  private online = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: PositionFix;
  private satellite: PositionFix | null = null;
  private velocity = walkSpeed(0);
  private sinceFix = 0;
  private lastDrTime: number;
  readonly startMs: number;
  constructor(private feed: PositionFeed, initial: LatLon, private onEnd: () => void) {
    this.startMs = Date.parse(feed.positions[0].t_utc);
    this.lastDrTime = this.startMs;
    this.last = { ...initial, t_utc: new Date(this.startMs).toISOString(), heading_deg: 0, accuracy_m: 5, source: 'dead_reckoning' };
  }
  setOnline(online: boolean): void { this.online = online; }
  setSpeed(speed: number): void {
    if (this.timer) { this.elapsed += (performance.now() - this.anchor) * this.speed; this.anchor = performance.now(); }
    this.speed = speed;
  }
  start(onFix: (fix: PositionFix) => void): void {
    if (this.timer) return;
    this.anchor = performance.now();
    const tick = (): void => this.advance(this.elapsed + (performance.now() - this.anchor) * this.speed, onFix);
    this.timer = setInterval(tick, 100);
    tick();
  }
  // elapsedは再生開始からの仮想ミリ秒。未受信点の時刻だけを再生スケジュールに利用する。
  advance(elapsed: number, onFix: (fix: PositionFix) => void): void {
    const end = Date.parse(this.feed.positions[this.feed.positions.length - 1].t_utc);
    const now = Math.min(this.startMs + elapsed, end);
    while (this.cursor < this.feed.positions.length && Date.parse(this.feed.positions[this.cursor].t_utc) <= now) {
      const raw = this.feed.positions[this.cursor++];
      if (!this.online) continue;
      const prev = this.satellite;
      const distance = prev ? haversine(prev, raw) : 0;
      const heading = raw.heading_deg ?? (prev && distance > 0.01 ? bearing(prev, raw) : this.last.heading_deg ?? 0);
      if (prev) this.velocity = distance / ((Date.parse(raw.t_utc) - Date.parse(prev.t_utc)) / 1000);
      this.last = { ...raw, heading_deg: heading, accuracy_m: 5, source: 'satellite' };
      this.satellite = this.last; this.sinceFix = 0; this.lastDrTime = Date.parse(raw.t_utc);
      onFix(this.last);
    }
    // オンラインに戻っても、次の衛星測位が届くまでは推測を続ける。
    if ((!this.online || this.last.source === 'dead_reckoning') && now - this.lastDrTime >= 1000) {
      const distance = this.velocity * (now - this.lastDrTime) / 1000;
      const heading = this.last.heading_deg ?? 0;
      const angle = heading * Math.PI / 180;
      const p = fromLocal(this.last, { x: Math.sin(angle) * distance, y: Math.cos(angle) * distance });
      this.sinceFix += distance;
      this.last = { ...p, t_utc: new Date(now).toISOString(), heading_deg: heading, accuracy_m: errRadius(this.sinceFix), source: 'dead_reckoning' };
      this.lastDrTime = now;
      onFix(this.last);
    }
    if (now >= end) { this.stop(); this.onEnd(); }
  }
  stop(): void {
    if (!this.timer) return;
    this.elapsed += (performance.now() - this.anchor) * this.speed;
    clearInterval(this.timer); this.timer = null;
  }
}
