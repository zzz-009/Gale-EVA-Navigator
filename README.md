# Gale EVA Navigator

NASA Space Apps Challenge 2026 — **Case 10: Interplanetary Survival Guide: Martian Map**
火星の宇宙飛行士が地表探査で使う地図・ナビ。舞台は Gale クレーター（Curiosity の走行範囲）。

- 本物の NASA データ: HiRISE の画像と地形データ（DTM）、Mars Trek のタイル
- 機能: 危険エリアを避けるルートの計画（安全 / 最短）、等高線上の足あとの記録、通信遮断モード、迷ったときの「来た道を戻る」（とんぼ返り）、周辺の危険度ヒートマップ、砂嵐の予報パネル（**シミュレーション**）
- **足あと・酸素・バッテリー・砂嵐の予報はシミュレーション**です（実際の記録・予報ではありません）

## 起動方法

Node.js 20 以上が必要です。

```bash
cd app
npm install
npm run dev
```

ブラウザで表示された URL（通常 `http://localhost:5173`）を開きます。
操作: ルートを選ぶ →「このルートで出発（シミュレーション）」→ 通信遮断モードを ON → 「迷った」→「来た道を戻る」。

提出用のビルド: `cd app && npm run build`（出力は `app/dist`）

## テスト

```bash
cd core
npm install
npm test
```

## 構成

| フォルダ | 中身 |
|---|---|
| `app/` | 画面（Vite + React + Leaflet）。地形データは `app/public/data/`（前処理の出力）|
| `core/` | 計算ロジック（A*、足あと、とんぼ返り、火星の時刻、危険度）と単体テスト |
| `pipeline/` | HiRISE の地形データから `app/public/data/` を作る Python スクリプト（生データは含まない）|
| `docs/` | 設計書（`docs/design/`）、タスク、データの出典（`docs/data_notes.md`）|

課題文: `case10.txt`

## データの出典・クレジット
- 地形: HiRISE DTM `DTEEC_040770_1755_039280_1755_U01`（NASA/JPL-Caltech/University of Arizona）
- 画像: NASA/JPL-Caltech Mars Trek、HiRISE: NASA/JPL/University of Arizona
- 詳細は `docs/data_notes.md`
