# 09 計測データの JSON 出力（M-1〜M-3）

作成: 2026-11-15 11:35（Claude）。締切が近いので、これだけを作る。**目安 30 分**。
対象: 基地の画面だけ。HUD・腕の端末・地図の表示は変えない。

## 0. なぜ作るか（発表での説明）
- 通信が切れても、記録はアプリの中に残る。基地は、現在地・基地からの距離・通信の状態・健康状態を、**あとから JSON ファイルで取り出せる**（報告書や別の解析ツールへ渡せる）。
- 健康状態の表示 / 非表示とは別に、健康の値もファイルに入る（別の端末で見る代わり）。

## 1. 中身（ユーザーの要望との対応）
| 要望 | ファイルに入れるもの | 実データか |
|---|---|---|
| どの位置か | 緯度・経度・標高・位置の誤差・取得元（衛星測位 / 推測航法 / 移動シミュレーション） | 位置は記録の値。衛星測位は**仮定** |
| 基地からどれだけ離れているか | 基地からの直線距離（m）・方位（度） | 計算の値（`haversine`・`bearing`） |
| 通信速度 | 通信可 / 圏外、下りの速さ（kbps）、遅れ（ms） | **シミュレーション**（下の式） |
| 健康情報 | 心拍数・CO₂・体温・酸素の残り・バッテリー・注意、健康状態の表示が ON か | **シミュレーション**（目安は仮の値） |

### 通信速度のシミュレーションの式（1 か所の定数にまとめる）
- 圏外: `downlink_kbps = 0`、`latency_ms = null`
- 通信可: `downlink_kbps = round(2000 × max(0.1, 1 − 距離 / 3000))`、`latency_ms = round(50 + 距離 / 100)`
- 意味: 基地の近くの中継局を仮定し、離れるほど遅くなる。**実測ではない**ことをファイルと画面の両方に書く。

## 2. タスク
### M-1 計測の記録（新しいファイル `app/src/measurementLog.ts`）
- 純粋な関数だけを置く（テストしやすくする）。
  - `simulateComm(distance_m, online)` → `{ simulated: true, online, downlink_kbps, latency_ms }`
  - `measurementFrom(point: TrackPoint, base, online, health, source)` → 1 件分のレコード（下の 3 章の形）
  - `exportDocument(records, meta)` → 3 章の JSON 全体
  - `downloadJson(doc, filename)` → Blob で保存（`URL.createObjectURL` → `a.download` → `revokeObjectURL`）
- App 側: 足あとの点が**増えたときだけ**、新しい点の分のレコードを足す（再生は 1 秒に 18 点。毎回全体を作り直さない）。そのときの `online`・健康状態・取得元を入れる。
- 「計画に戻る」で記録をやり直すときは、レコードも空にする。保存（IndexedDB）はしなくてよい（再読み込みでは消える。画面に「再読み込みすると計測の記録は消えます」と小さく書く）。

### M-2 保存のボタン
- 現場の画面の「足あとの記録」のカードに **「計測データを JSON で保存」** のボタン。レコードが 0 件なら押せない。
- ボタンの下に小さく: 「位置・基地からの距離・通信の状態・健康状態（通信速度と健康はシミュレーション）」と件数。
- ファイル名: `gale-eva-measurements-sol{Sol}-{LMST の時分}.json`（例 `gale-eva-measurements-sol5074-1032.json`）

### M-3 テスト（`app/src/measurementLog.test.ts`）
- 基地から 1500 m・通信可 → 1000 kbps、65 ms。3000 m 以上 → 200 kbps。圏外 → 0 kbps、`null`。
- レコードの距離が `haversine` と一致する。`simulated` の印が通信と健康の両方に付く。
- `exportDocument` の `notes` に「シミュレーション」の文字が入る。

## 3. JSON の形
```json
{
  "format": "gale-eva-measurements/1",
  "app": "Gale EVA Navigator",
  "exported_utc": "2026-11-15T02:35:00.000Z",
  "notes": {
    "position": "衛星測位は将来の測位衛星を仮定。圏外では推測航法（誤差は 5 m + 進んだ距離の 3%）",
    "comm": "通信速度はシミュレーション（基地の近くの中継局を仮定。実測ではない）: 通信可のとき 2000 kbps × max(0.1, 1 − 距離/3000)、遅れ 50 ms + 距離/100",
    "health": "健康状態はシミュレーション。注意の目安は仮の値で、医療的な判定ではない"
  },
  "terrain": "HiRISE DTM DTEEC_040770_1755_039280_1755_U01",
  "base": { "lat": -4.69259, "lon": 137.3702 },
  "health_display_on": true,
  "count": 2,
  "records": [
    {
      "t_utc": "…", "sol": 5074, "lmst": "10:32",
      "lat": -4.70012, "lon": 137.38001, "elev_m": -4321.5,
      "accuracy_m": 12, "position_source": "satellite | dead_reckoning | simulation",
      "distance_from_base_m": 1532, "bearing_from_base_deg": 118,
      "comm": { "simulated": true, "online": true, "downlink_kbps": 979, "latency_ms": 65 },
      "health": { "simulated": true, "heartRate": 104, "co2": 0.52, "temperature": 37.0, "oxygen_min": 402, "battery_pct": 88, "warnings": [] }
    }
  ]
}
```
数値は丸める（距離・誤差は m 単位の整数、方位は整数、緯度経度は小数 6 桁）。

## 4. 完了条件
1. 現場で記録 → 「計測データを JSON で保存」でファイルが保存され、3 章の形になっている。
2. 圏外にした区間のレコードは `online: false`、`downlink_kbps: 0`。
3. 通信速度・健康状態が「シミュレーション」とファイルに書かれている。
4. 再生中に重くならない（新しい点の分だけ足す）。
5. `npm run build`・`npm test`（app）・`npx vitest run`（core）が通る。HUD・腕の端末・地図の動きは変わらない。
