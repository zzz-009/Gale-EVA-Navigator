// 歩く速さ。登山で使われる Tobler の歩行速度の式を、宇宙服向けに上限 v0 を下げて使う。
//   v(s) = v0 × exp(−3.5 × |s + 0.05|)    s = 進む向きの勾配（tan。登りは正、下りは負）
// 平らな地面で v0 × 0.84。緩い下り（s = −0.05）で最大の v0。

export const DEFAULT_V0 = 0.45; // m/s

export function walkSpeed(gradeTan: number, v0 = DEFAULT_V0): number {
  return v0 * Math.exp(-3.5 * Math.abs(gradeTan + 0.05));
}
