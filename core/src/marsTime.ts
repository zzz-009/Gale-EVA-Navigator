// 火星の時刻。NASA GISS の Mars24 のアルゴリズム（Allison & McEwen 2000）に従う。
// 地球の時刻（UTC）→ 火星日（MSD）、火星の協定時（MTC）、地方平均太陽時（LMST）、
// 地方真太陽時（LTST）、太陽黄経（Ls）、太陽直下点、太陽の方位・仰角。

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// うるう秒（TAI − UTC）。2017-01-01 以降は 37 秒。TT − UTC = (TAI − UTC) + 32.184 秒。
const LEAP: [number, number][] = [
  [Date.UTC(1999, 0, 1), 32],
  [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(2009, 0, 1), 34],
  [Date.UTC(2012, 6, 1), 35],
  [Date.UTC(2015, 6, 1), 36],
  [Date.UTC(2017, 0, 1), 37],
];

export function ttMinusUtcSeconds(ms: number): number {
  let tai = 32;
  for (const [t, v] of LEAP) if (ms >= t) tai = v;
  return tai + 32.184;
}

export type MarsTime = {
  jd_tt: number;
  dt_j2000: number; // J2000 からの日数（TT）
  M: number; // 平均近点角（度）
  alpha_fms: number; // 仮想の平均太陽の角度（度）
  pbs: number; // 他の惑星による摂動（度）
  nu_minus_M: number; // 中心差（度）
  ls: number; // 太陽黄経 Ls（度、0〜360）
  eot_deg: number; // 均時差（度）
  msd: number; // 火星日
  mtc_h: number; // 火星の協定時（時、0〜24）
  subsolar_lat: number; // 太陽直下点の緯度（度）
  subsolar_lon_e: number; // 太陽直下点の経度（度、東経、−180〜180）
};

const PBS_TERMS: [number, number, number][] = [
  // [振幅（度）, 周期（年）, 位相（度）]
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

const mod = (x: number, m: number): number => ((x % m) + m) % m;

export function marsTime(date: Date): MarsTime {
  const ms = date.getTime();
  const jd_ut = 2440587.5 + ms / 86400000;
  const jd_tt = jd_ut + ttMinusUtcSeconds(ms) / 86400;
  const dt = jd_tt - 2451545.0;

  const M = 19.3871 + 0.52402073 * dt;
  const alpha = 270.3871 + 0.524038496 * dt;
  let pbs = 0;
  for (const [A, tau, phi] of PBS_TERMS) pbs += A * Math.cos(((0.985626 * dt) / tau + phi) * D2R);

  const Mr = M * D2R;
  const nuM =
    (10.691 + 3.0e-7 * dt) * Math.sin(Mr) +
    0.623 * Math.sin(2 * Mr) +
    0.05 * Math.sin(3 * Mr) +
    0.005 * Math.sin(4 * Mr) +
    0.0005 * Math.sin(5 * Mr) +
    pbs;

  const ls = mod(alpha + nuM, 360);
  const lsr = ls * D2R;
  const eot = 2.861 * Math.sin(2 * lsr) - 0.071 * Math.sin(4 * lsr) + 0.002 * Math.sin(6 * lsr) - nuM;

  const msd = (jd_tt - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const mtc = mod(24 * msd, 24);

  // 太陽直下点。経度は西経で MTC × 15 + EOT + 180。
  const subLonW = mod(mtc * 15 + eot + 180, 360);
  const subLonE = mod(-subLonW + 180, 360) - 180;
  const subLat = Math.asin(0.42565 * Math.sin(lsr)) * R2D + 0.25 * Math.sin(lsr);

  return {
    jd_tt,
    dt_j2000: dt,
    M: mod(M, 360),
    alpha_fms: mod(alpha, 360),
    pbs,
    nu_minus_M: nuM,
    ls,
    eot_deg: eot,
    msd,
    mtc_h: mtc,
    subsolar_lat: subLat,
    subsolar_lon_e: subLonE,
  };
}

/** 地方平均太陽時（時、0〜24）。lonE = 東経（度）。 */
export function lmstHours(mt: MarsTime, lonE: number): number {
  return mod(mt.mtc_h + lonE / 15, 24);
}

/** 地方真太陽時（時、0〜24）。 */
export function ltstHours(mt: MarsTime, lonE: number): number {
  return mod(lmstHours(mt, lonE) + mt.eot_deg / 15, 24);
}

/** "HH:MM" の文字列。 */
export function formatHours(h: number): string {
  const total = Math.floor(mod(h, 24) * 60 + 1e-9);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * ミッションの Sol 番号（着陸した Sol を 0 とする概算）。
 * その地点の地方平均太陽時の日付が、着陸から何回変わったかで数える。
 */
export function missionSol(date: Date, landing: Date, lonE: number): number {
  const local = (d: Date): number => Math.floor(marsTime(d).msd + lonE / 360);
  return local(date) - local(landing);
}

/** 太陽の方位（北 = 0、時計回り）と仰角（度）。大気の屈折と地形は考えない。 */
export function sunAzEl(date: Date, lat: number, lonE: number): { az: number; el: number } {
  const mt = marsTime(date);
  return azElFromSubpoint(lat, lonE, mt.subsolar_lat, mt.subsolar_lon_e);
}

/** 直下点（真上に天体が来る点）の緯度経度から、地点での方位・仰角を出す。 */
export function azElFromSubpoint(
  lat: number,
  lonE: number,
  subLat: number,
  subLonE: number,
): { az: number; el: number } {
  const phi = lat * D2R;
  const dec = subLat * D2R;
  const H = (lonE - subLonE) * D2R; // 時角（西へ進むと正）
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const y = -Math.sin(H) * Math.cos(dec);
  const x = Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(H);
  return { az: mod(Math.atan2(y, x) * R2D, 360), el: el * R2D };
}
