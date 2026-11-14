// デモ用の足あと（シミュレーション）。予定ルートに沿って歩き、途中で外れて迷う。
// 位置は推測航法で決めた「推定位置」として扱い、誤差の円を付ける（docs/design/02_track_recorder.md 5.6）。
import {
  bearing,
  elevAt,
  errRadius,
  formatHours,
  fromLocal,
  haversine,
  lmstHours,
  marsTime,
  missionSol,
  toLocal,
  walkSpeed,
  type Grid,
  type LatLon,
  type Route,
  type TrackPoint,
} from '@core';

export const CURIOSITY_LANDING = new Date(Date.UTC(2012, 7, 6, 5, 17, 57));

export function stamp(ms: number, lonE: number): { sol: number; lmst: string; t_utc: string } {
  const d = new Date(ms);
  return { sol: missionSol(d, CURIOSITY_LANDING, lonE), lmst: formatHours(lmstHours(marsTime(d), lonE)), t_utc: d.toISOString() };
}

export function makeSimTrack(route: Route, grid: Grid, startMs: number): TrackPoint[] {
  const coords = route.coords;
  const cut = Math.floor(coords.length * 0.6);
  const path: LatLon[] = [];
  for (let i = 0; i <= cut; i += 2) {
    const [lat, lon] = coords[i];
    // 推測航法らしい小さな横ぶれ（最大 約 2 m）
    const wob = fromLocal({ lat, lon }, { x: 2 * Math.sin(i * 0.37), y: 2 * Math.cos(i * 0.23) });
    path.push(i === 0 ? { lat, lon } : wob);
  }
  // 予定ルートから外れる: 進行方向から約 70° それて 280 m 進む
  const a = path[Math.max(0, path.length - 4)];
  const b = path[path.length - 1];
  const head = ((bearing(a, b) + 70) * Math.PI) / 180;
  for (let k = 1; k <= 28; k++) {
    const bend = head + 0.012 * k;
    const p = fromLocal(b, { x: 10 * k * Math.sin(bend), y: 10 * k * Math.cos(bend) });
    if (elevAt(grid, p) == null) break;
    path.push(p);
  }

  const fixAt = Math.floor(path.length * 0.3); // 途中の目印で 1 回、位置を確定する
  const out: TrackPoint[] = [];
  let t = startMs;
  let sinceFix = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const prev = i > 0 ? path[i - 1] : p;
    const d = haversine(prev, p);
    const z = elevAt(grid, p);
    const zPrev = elevAt(grid, prev);
    const grade = d > 0 && z != null && zPrev != null ? (z - zPrev) / d : 0;
    t += (d / walkSpeed(grade)) * 1000;
    const fix = i === 0 || i === fixAt;
    sinceFix = fix ? 0 : sinceFix + d;
    out.push({
      id: `p${i}`,
      ...stamp(t, p.lon),
      lat: p.lat,
      lon: p.lon,
      elev_m: z,
      heading_deg: i > 0 ? bearing(prev, p) : 0,
      err_m: errRadius(sinceFix),
      src: fix ? 'fix' : 'dr',
      note: i === fixAt ? '目印で位置を確定' : undefined,
      sent: true,
      simulated: true,
    });
  }
  return out;
}

/** 折れ線を step_m ごとの点に細かくする（とんぼ返りの再生用）。 */
export function densify(coords: [number, number][], step_m = 12): LatLon[] {
  const out: LatLon[] = [];
  for (let i = 1; i < coords.length; i++) {
    const a = { lat: coords[i - 1][0], lon: coords[i - 1][1] };
    const b = { lat: coords[i][0], lon: coords[i][1] };
    const v = toLocal(a, b);
    const n = Math.max(1, Math.round(Math.hypot(v.x, v.y) / step_m));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push(fromLocal(a, { x: (v.x * k) / n, y: (v.y * k) / n }));
  }
  return out;
}
