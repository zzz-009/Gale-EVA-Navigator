// 周辺の危険度（ヒートマップとクリックした地点の説明で共通に使う）。設計書 06 の 3 章。
//   危険度 = min(1, (傾斜 / 上限)² + 0.5 × 起伏)。傾斜が上限を超えるマスは 1。
// ルートの計算（astar.ts の risk）と同じ考え方。

import type { Grid } from './grid';

export const RISK_BANDS: { max: number; label: string; hint: string }[] = [
  { max: 0.15, label: '塗らない', hint: '平らで歩きやすい' },
  { max: 0.35, label: '青緑', hint: '少し傾いている' },
  { max: 0.6, label: '黄', hint: '速さが落ちる' },
  { max: 0.85, label: 'オレンジ', hint: '注意して進む' },
  { max: 1, label: '赤', hint: '上限に近い、または通行不可' },
];

export type RiskInfo = {
  risk: number;
  slopeTerm: number;
  roughTerm: number;
  blocked: boolean;
  band: 0 | 1 | 2 | 3 | 4;
};

export function riskBand(risk: number): 0 | 1 | 2 | 3 | 4 {
  for (let b = 0; b < RISK_BANDS.length; b++) if (risk <= RISK_BANDS[b].max) return b as 0 | 1 | 2 | 3 | 4;
  return 4;
}

/** マス i の危険度と内訳。標高・傾斜の値がないマスは null。 */
export function riskAt(grid: Grid, slope: Float32Array, i: number, slopeMaxDeg = 20): RiskInfo | null {
  const s = slope[i];
  if (!Number.isFinite(s) || !Number.isFinite(grid.elev[i])) return null;
  const rough = grid.rough ? grid.rough[i] : 0;
  const slopeTerm = (s / slopeMaxDeg) ** 2;
  const roughTerm = 0.5 * (Number.isFinite(rough) ? rough : 0);
  const blocked = s > slopeMaxDeg;
  const risk = blocked ? 1 : Math.min(1, slopeTerm + roughTerm);
  return { risk, slopeTerm, roughTerm, blocked, band: riskBand(risk) };
}

/** 起伏 0 のとき、危険度が r になる傾斜（度）。説明パネルの目安に使う。 */
export function slopeForRisk(r: number, slopeMaxDeg = 20): number {
  return slopeMaxDeg * Math.sqrt(Math.max(0, Math.min(1, r)));
}
