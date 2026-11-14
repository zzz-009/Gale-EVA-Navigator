import { RISK_BANDS, slopeForRisk } from '@core';

export function RiskHelp({ slopeMax, onClose }: { slopeMax: number; onClose: () => void }) {
  return <section id="risk-help" className="risk-help" aria-labelledby="risk-help-title">
    <button type="button" className="risk-close" onClick={onClose}>閉じる</button>
    <h3 id="risk-help-title">周辺の危険度の決め方</h3>
    <p>危険度 = 傾斜の項 + 起伏の項（最大 1）</p>
    <ul>
      <li>傾斜の項 = (傾斜 ÷ {slopeMax}°)²。上限に近いほど急に大きくなります</li>
      <li>起伏の項 = 0.5 × 起伏。周りより凸凹しているほど大きくなります</li>
      <li>傾斜 {slopeMax}° 超（このアプリでは通行不可）は 1</li>
    </ul>
    <p>安全ルートの計算でも、同じ考え方で危険な場所を避けています。</p>
    <table>
      <thead><tr><th>色</th><th>危険度</th><th>目安（起伏 0）</th></tr></thead>
      <tbody>{RISK_BANDS.map((band, i) => {
        const min = i === 0 ? 0 : RISK_BANDS[i - 1].max;
        return <tr key={band.label}><td>{band.label}</td><td>{i === 0 ? '0' : `${min}超`}〜{band.max}</td>
          <td>{slopeForRisk(min, slopeMax).toFixed(1)}〜{slopeForRisk(band.max, slopeMax).toFixed(1)}°{i === 4 ? '、または通行不可' : ''}<br />{band.hint}</td></tr>;
      })}</tbody>
    </table>
    <p className="muted">円の外周では色を薄くしています。数値は各地点の危険度です。</p>
  </section>;
}
