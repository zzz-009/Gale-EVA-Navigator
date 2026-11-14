import { walkSpeed } from '@core';

export type HazardSettings = { slope_max_deg: number; slope_limited_deg: number; cell_m: number };
export type HazardProperties = { level: string; label: string; max_slope_deg: number; mean_slope_deg: number; area_m2: number };

export function hazardText(p: HazardProperties, region: HazardSettings): HTMLElement {
  const box = document.createElement('div');
  const add = (tag: string, text: string): HTMLElement => {
    const node = document.createElement(tag);
    node.textContent = text;
    box.appendChild(node);
    return node;
  };
  const max = region.slope_max_deg;
  const limited = region.slope_limited_deg;
  const noGo = p.level === 'no_go';
  add('b', noGo ? `急斜面（${max}° 超）｜通行不可` : `急な斜面（${limited}〜${max}°）｜注意`);
  add('p', `最大 ${p.max_slope_deg.toFixed(1)}°・平均 ${p.mean_slope_deg.toFixed(1)}°・面積 ${(p.area_m2 / 10000).toFixed(2)} ha`);
  add('b', '何が危険か');
  const ratios = [limited, max].map((deg) => Math.round(walkSpeed(Math.tan(deg * Math.PI / 180)) / walkSpeed(0) * 100)).sort((a, b) => a - b);
  const reasons = noGo ? [
    `傾斜が ${max}° を超えていて、このアプリでは宇宙服を着た状態で登り下りできない設定です`,
    '足を滑らせると止まりにくく、転倒・滑落のおそれがあります',
    'ルートはこのエリアを通りません',
  ] : [
    `通行はできますが、歩く速さが落ちます（平地の約 ${ratios[0]}〜${ratios[1]}%）`,
    '斜面を横切ると、横に転倒するおそれがあります。まっすぐ登り下りするか、迂回してください',
    'EVA 安全スコアでは、この中を通る長さが減点されます',
  ];
  const list = add('ul', '');
  reasons.forEach((reason) => {
    const item = document.createElement('li');
    item.textContent = reason;
    list.appendChild(item);
  });
  const spacing = region.cell_m.toFixed(1);
  add('small', `根拠: HiRISE の地形データ（約 ${spacing} m 間隔）の傾斜から自動で作成。${spacing} m より小さい岩は含まれません`);
  return box;
}
