# core — 画面に依存しない計算ロジック（担当: Claude Code）

`app/` からは `core/src/index.ts` を import して使う（Vite の alias 例: `@core` → `../core/src`）。
DOM も Leaflet も使っていないので、Web Worker の中でもそのまま動く。

```bash
cd core
npm install
npm test          # 単体テスト（47 件。実データの 2 件は app/public/data がある場合だけ）
npm run typecheck
```

## 地形のグリッド（前処理の出力と同じ並び）

```ts
type Grid = {
  width: number; height: number;
  cell_m: number;          // マスの一辺（m）
  north: number;           // 北の端の緯度（度）
  west: number;            // 西の端の経度（度、東経）
  elev: Float32Array;      // 標高。行 0 = 北の端、列 0 = 西の端、行優先。値なしは NaN
  nogo?: Uint8Array;       // 1 = 通行不可（危険エリア）
  rough?: Float32Array;    // 起伏（0〜1）
  science?: Float32Array;  // 科学的価値（0〜1）
};
```
`public/data/region.json` の `width, height, cell_m, north, west` と `elev.f32` から作る:
```ts
const meta = await (await fetch('/data/region.json')).json();
const elev = new Float32Array(await (await fetch('/data/elev.f32')).arrayBuffer());
const grid: Grid = { ...meta, elev };
const { slope, aspect } = computeSlopeAspect(grid);   // 傾斜（度）と斜面の向き
```

## 関数の一覧

| ファイル | 関数 | 用途 | 設計書 |
|---|---|---|---|
| `geo.ts` | `haversine` `bearing` `angleDiff` `toLocal` `fromLocal` `pointToSegment` | 距離（火星の半径）・方位・平面座標 | — |
| `grid.ts` | `cellLatLon` `latLonToCell` `elevAt` `computeSlopeAspect` `crossSlopeDeg` `distanceField` `outcropScience` | マス ↔ 緯度経度、標高、傾斜、科学的価値（露頭までの距離）| 01 の 5.1・5.4 |
| `walkSpeed.ts` | `walkSpeed(勾配, v0)` | 歩く速さ（Tobler の式）| 01 の 5.3 |
| `astar.ts` | `findPath` `PRESETS` `isBlocked` `stepCost` | 経路探索（A*）| 01 の 5.2〜5.4 |
| `route.ts` | `planRoute` `buildRoute` `safetyScore` `slopeClass` `explainRoute` | ルートの指標、EVA 安全スコア、理由の説明 | 01 の 5.5・5.6 |
| `track.ts` | `errRadius` `trackStats` `deviationFromRoute` `remainingAlongRoute` `countUnsent` `flushUnsent` `sentFlagFor` | 足あとの集計、誤差の円、通信遮断モード | 02 の 5.2〜5.5 |
| `tracback.ts` | `nearestBreadcrumb` `lastFixIndex` `buildTracBack` `landmarkSide` `returnLimit` `simplify` | とんぼ返り、「迷った」モード、帰還の限界 | 03 の 5 章 |
| `marsTime.ts` | `marsTime` `lmstHours` `ltstHours` `formatHours` `missionSol` `sunAzEl` `azElFromSubpoint` | 火星の時刻（Mars24）、太陽の方位・仰角 | 04 の 5.4 |
| `risk.ts` | `riskAt` `riskBand` `RISK_BANDS` `slopeForRisk` | 周辺の危険度と内訳（ヒートマップとクリックの説明で共通）| 06 の 3 章 |
| `dust.ts` | `dustForecast` `DUST_NOTE` | 砂嵐の予報（**訓練用のシミュレーション**。1 時間ごと）| 06 の 5 章 |

## 使い方の例

```ts
// 01 ルートの計画（Web Worker の中で呼ぶ）
const start = latLonToCell(grid, base)!;
const goal = latLonToCell(grid, target)!;
const safe = planRoute(grid, slope, aspect, start, goal, 'safe');      // 通れなければ null
const short = planRoute(grid, slope, aspect, start, goal, 'short');
if (safe) safe.explanation = explainRoute(safe, short ?? undefined);
// safe.coords = [lat, lon][] をそのまま L.polyline に渡せる
// safe.segments = 傾斜の4段階ごとの区間（色分け用）

// 02 足あとの記録
const stats = trackStats(points);                       // 距離・登り下り・経過時間
const off = deviationFromRoute(current, safe.coords);   // 30 m（OFF_ROUTE_M）以上で警告
const unsent = countUnsent(points);                     // ヘッダーの未送信の件数
points = flushUnsent(points, 5);                        // 通信が戻ったら少しずつ送信済みにする

// 03 とんぼ返り
const nb = nearestBreadcrumb(current, points)!;         // いちばん近い足あとの点（方向と距離）
const plan = buildTracBack(points, nb.index, landmarks); // 戻るルートと案内文
const limit = returnLimit(plan.est_time_s, o2_min, battery_min); // 緑 / 黄 / 赤 と文章

// 火星の時刻（ヘッダー）
const mt = marsTime(new Date());
const lmst = formatHours(lmstHours(mt, 137.44));        // "10:42"
```

## 検証済みのこと（`npm test`）
- 火星の時刻: Mars24 のアルゴリズムの計算例（2000-01-06 00:00 UTC）と、Ls・均時差・MSD・MTC が一致
- 経路探索: A* とダイクストラ法のコストが一致、通行不可のマスを通らない、角をすり抜けない
- 距離: 経度 1° が赤道で約 59.3 km（火星の半径）
- とんぼ返り: 足あとを逆にたどると基地に戻る、目印の左右、帰還の限界の 緑 → 黄 → 赤
