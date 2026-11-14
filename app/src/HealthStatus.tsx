import { HEALTH_LIMITS, type HealthState } from './health';

export function HealthStatus({ health }: { health: HealthState }) {
  return <section className="health-status" aria-label="健康状態（シミュレーション）">
    <h2>健康状態（シミュレーション）</h2>
    <dl>
      <dt>心拍</dt><dd>{health.heartRate} bpm</dd>
      <dt>酸素</dt><dd>{Math.floor(health.oxygen_min / 60)}時間 {Math.floor(health.oxygen_min % 60)}分</dd>
      <dt>宇宙服内CO₂</dt><dd>{health.co2}%</dd>
      <dt>体温</dt><dd>{health.temperature}℃</dd>
      <dt>バッテリー</dt><dd>{Math.round(health.battery_pct)}%</dd>
    </dl>
    <small>注意の目安（仮の値）: 心拍{HEALTH_LIMITS.heartRate}以上 / CO₂ {HEALTH_LIMITS.co2}%以上 / 体温{HEALTH_LIMITS.temperature}℃以上 / 電池{HEALTH_LIMITS.battery}%以下。酸素は帰還の限界と連動。</small>
  </section>;
}
