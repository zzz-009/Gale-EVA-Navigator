# ハッカソン アプリ提案 一覧（NASA Space Apps Challenge 2026）

各テーマ（case1〜15.txt）について、課題を解決するアプリ案を5つずつ検討しました。
各ファイルには、コンセプト・主な機能・使用データ・技術スタック・差別化ポイント・2日間でのMVP範囲・リスクと、比較表・おすすめ構成を載せています。

| # | テーマ | 一言でいうと | 一押し案 | 詳細 |
|---|---|---|---|---|
| 1 | NASA's Discarded Equipment Storytelling | 宇宙に残された探査機の物語を子どもに伝える | Ghost Rover Map（地図）+ Last Transmission（最後の日々のストーリー） | [case1_ideas.md](case1_ideas.md) |
| 2 | Earth System Trend Detective | 地球観測データのトレンドと有意性を探る | Data Detective Wizard（質問式）+ トレンド地図 | [case2_ideas.md](case2_ideas.md) |
| 3 | Junior Astronaut Mission Trainer | 7〜12歳が基地運営のトレードオフを体験 | Moon Base Day-by-Day（DONKI実データ連動） | [case3_ideas.md](case3_ideas.md) |
| 4 | Health Monitoring Software | 宇宙飛行士が自分の健康を評価・対処 | Body Map Console（人体図）+ クエスト + 地上相談 | [case4_ideas.md](case4_ideas.md) |
| 5 | Dancing with the SARs | NISARレーダーで地表変化を可視化 | Rice Paddy Rhythm（田んぼの季節変化） | [case5_ideas.md](case5_ideas.md) |
| 6 | Adapting Farms with NASA Data | 衛星データで輪作戦略を比較支援 | Rotation Compare Board（3案比較）+ 裸地期間検出 | [case6_ideas.md](case6_ideas.md) |
| 7 | Flame in Freefall | 微小重力燃焼データをSIで要約・ランク付け | Relevance Ranker + Experiment Matrix | [case7_ideas.md](case7_ideas.md) |
| 8 | MODIS and VIIRS Hot Spots | 2センサーの火災記録を調和し燃焼カレンダー化 | Fire Calendar Heatmap + 調和手法の検証ページ | [case8_ideas.md](case8_ideas.md) |
| 9 | Permanent Moon Base Locations and Mars | 地球上の月・火星アナログを新発見 | Analog Finder（類似度マップ）+ 分野別成績表 | [case9_ideas.md](case9_ideas.md) |
| 10 | Interplanetary Survival Guide: Martian Map | 火星EVA用の局所的な重ね合わせ地図 | 重ね合わせ地図 → ルート計画 → HUD | [case10_ideas.md](case10_ideas.md) |
| 11 | Lunar Landing Site Navigator | 月南極の着陸地×日付を日照・通信で比較 | Compare Board + Horizon Panorama | [case11_ideas.md](case11_ideas.md) |
| 12 | Lunar Landing Site Navigator（case11と同一課題） | 同上・別の切り口 | Slip Impact Analyzer（延期影響カレンダー） | [case12_ideas.md](case12_ideas.md) |
| 13 | Planet X and SPHEREx | SPHEREx画像の時系列表示で動く天体を探す | Sky Blink Viewer + クリックでスペクトル | [case13_ideas.md](case13_ideas.md) |
| 14 | Space Mission Design Game | ミッション設計〜運用を最大4人で体験 | カード設計協力ゲーム + 運用トラブル | [case14_ideas.md](case14_ideas.md) |
| 15 | The Earth Information Jukebox | EIC映像を音に変換（ソニフィケーション） | Jukebox Player + なぞって聴く探索モード | [case15_ideas.md](case15_ideas.md) |

> ※ case11.txt と case12.txt は同じ課題文だったため、case12 では別の切り口の5案を提案しています。

## テーマ選びの観点

| テーマ | データ準備の重さ | 必要スキル | 2日での完成しやすさ |
|---|---|---|---|
| 1 | 軽（調べ物中心） | フロント、ストーリー作り | ◎ |
| 2 | 中（API・統計） | Python統計、可視化 | ◯ |
| 3 | 軽（DONKI APIは簡単） | ゲーム開発 | ◎ |
| 4 | 軽（ダミーデータ可） | UI/UX、フロント | ◎ |
| 5 | 重（SARデータ処理） | リモートセンシング、GIS | △ |
| 6 | 中〜重（複数衛星データ統合） | GIS、データ処理、SI | ◯ |
| 7 | 中（文書の構造化） | RAG / LLM、可視化 | ◯ |
| 8 | 中（FIRMSは取得しやすい） | Python データ処理、可視化 | ◎ |
| 9 | 重（地球・月・火星の多種データ） | GIS、リモートセンシング | △ |
| 10 | 中〜重（HiRISE DTM等が大容量） | GIS、3D、経路探索 | ◯ |
| 11/12 | 中（SPICE・LOLA DEMの扱い） | 天体暦計算、可視化 | ◯ |
| 13 | 中（IRSAから画像取得） | 天文データ処理（astropy） | ◯ |
| 14 | 軽（パラメータは自作可） | ゲーム開発、リアルタイム通信 | ◎ |
| 15 | 軽（映像を選ぶだけ） | Web Audio、フロント、音楽 | ◎ |

- **チームにエンジニアが少ない / デザイン・企画が強い** → Case 1, 3, 4, 14, 15
- **データ分析・統計が得意** → Case 2, 6, 8
- **GIS・衛星データの経験がある** → Case 5, 6, 9, 10
- **天文・宇宙工学が好き** → Case 11/12, 13, 14
- **生成AI（RAG）を活かしたい** → Case 7（課題自体がSI前提）、Case 6
- **音楽・アクセシビリティに関心がある** → Case 15

## 共通の注意点

- **出典の明示**: どのテーマもNASAデータの出典をアプリ内に表示すると評価されやすい
- **正確性**: 生成AIを使う場合、数値・事実は検証済みデータから取り、AIは説明・要約に使う
- **ライブ/静的データの区別**: 事前に保存したデータをライブデータのように見せない
- **事前準備**: NASA Earthdata アカウント、api.nasa.gov のAPIキーは当日前に取得しておく
