import type { Grid, Route, TrackPoint } from '@core';
import { makeSimTrack } from '../sim';
import type { PositionFix, ReplaySource } from './source';

/** 既存の迷うシナリオを、元と同じ6点/秒（倍率指定可）で再生する。 */
export class SimulationSource implements ReplaySource {
  private points: TrackPoint[];
  private cursor = 0;
  private elapsed = 0;
  private anchor = 0;
  private speed = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(route: Route, grid: Grid, startMs: number, private onEnd: () => void) { this.points = makeSimTrack(route, grid, startMs); }
  setOnline(_online: boolean): void { /* 移動シミュレーションは通信状態に関係なく動く */ }
  setSpeed(speed: number): void {
    if (this.timer) { this.elapsed += (performance.now() - this.anchor) * this.speed; this.anchor = performance.now(); }
    this.speed = speed;
  }
  start(onFix: (fix: PositionFix) => void): void {
    if (this.timer) return;
    this.anchor = performance.now();
    this.timer = setInterval(() => {
      const count = Math.min(this.points.length, Math.floor((this.elapsed + (performance.now() - this.anchor) * this.speed) * 6 / 1000));
      while (this.cursor < count) {
        const point = this.points[this.cursor++];
        onFix({ ...point, accuracy_m: point.err_m, source: 'simulation', trackPoint: point });
      }
      if (this.cursor >= this.points.length) { this.stop(); this.onEnd(); }
    }, 100);
  }
  stop(): void {
    if (!this.timer) return;
    this.elapsed += (performance.now() - this.anchor) * this.speed;
    clearInterval(this.timer); this.timer = null;
  }
}
