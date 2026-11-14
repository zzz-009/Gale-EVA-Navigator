import { distanceText, type DestinationInfo } from './navigation';

export function DestinationStatus({ info }: { info: DestinationInfo | null }) {
  if (!info) return <section className="destination-status">現在地・目的地の情報を待っています</section>;
  return <section className="destination-status" aria-label="目的地までの距離">
    <div>{info.fromBase ? '基地' : '現在地'}から {info.name}まで</div>
    <strong>{distanceText(info.distance_m)}</strong> <span>→ {Math.round(info.heading_deg) % 360}°</span>
    <div>到着予定 約{Math.ceil(info.eta_min)}分（平地の速さによる目安）</div>
    <small>直線 {distanceText(info.straight_m)} / ルート残り {info.remaining_m === null ? '未計算' : distanceText(info.remaining_m)}</small>
    {info.offRoute ? <div className="destination-warning">ルートから外れています。直線距離を表示しています。</div> : null}
  </section>;
}
