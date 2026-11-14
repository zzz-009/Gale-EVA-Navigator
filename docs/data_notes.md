# データ入手調査 — T-02 / T-10

調査日: 2026-11-14 JST。対象: Gale、緯度 -4.925〜-4.249、東経 137.122〜137.730（設計書指定）。

## 確認方法と制限

- ローカル PowerShell の HTTPS は通信制限あり。`curl.exe` は Trek / HiRISE / USGS へ接続できず (exit 7)、npm registry は EACCES。Web ツールでは公式ページの本文や検索索引を参照できるが、取得済み本文とライブ応答は区別する。
- 下表の verified=yes は Web ツールで本文を取得できた「資料ページ」に限る。配布ファイル全体・ヘッダー・チェックサムの検証成功を意味しない。配布バイナリの検証はすべて no。サイズは配布元記載値で、ローカル計測値ではない。
- ダウンロード試行: HiRISE U01 の公式リンクを `curl.exe --fail --location --connect-timeout 10 --max-time 20 --output data/raw/DTEEC_040770_1755_039280_1755_U01.IMG` に渡したが接続拒否。ファイル保存なし。全球 DEM の HEAD も接続不可。

## データ一覧

| dataset | URL | resolution | projection | format | size | verified(yes/no) | notes |
|---|---|---|---|---|---|---|---|
| HiRISE Curiosity DTM 資料 | [公式 DTM ページ](https://www.uahirise.org/dtm/dtm.php?ID=ESP_040770_1755) | ページ表示 1.01 m/pixel、DTM の C は1 m grid | Equirectangular（下記命名規約） | DTM は PDS IMG | U01:308 MB / A01:303 MB | yes（資料） | 中心 -4.7°, 137.3°。対象範囲内の局所 DTM。中心座標はフットプリントの保証ではない。 |
| HiRISE `DTEEC_040770_1755_039280_1755_U01` | [公式 IMG ダウンロード](https://www.uahirise.org/PDS/DTM/ESP/ORB_040700_040799/ESP_040770_1755_ESP_039280_1755/DTEEC_040770_1755_039280_1755_U01.IMG) | 1 m grid | Equirectangular | PDS3 IMG、埋め込みラベル | 308 MB | no（全体未取得） | 公式ページのリンクから取得。Web は application/octet-stream 非対応を返した（HTTP status は確定不可）。ローカル取得は接続失敗。 |
| HiRISE `DTEEC_040770_1755_039280_1755_A01` | [公式 IMG ダウンロード](https://www.uahirise.org/PDS/DTM/ESP/ORB_040700_040799/ESP_040770_1755_ESP_039280_1755/DTEEC_040770_1755_039280_1755_A01.IMG) | 1 m grid | Equirectangular | PDS3 IMG、埋め込みラベル | 303 MB | no | 同じステレオ対の UA 版。Web はバイナリ非対応。U01 と両方を重ねて使う必要はない。 |
| USGS MSL Gale Merged DEM | [公式製品ページ](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) | 出力1 m。HRSC/CTX/HiRISE混合で全域1 m実解像度ではない | Equirectangular、planetocentric、east positive、R=3396190 m | 32-bit 1 band raster。配布ファイル形式・直接URLは未確認 | 57440×32980×4 ≈7.58 GB（非圧縮画素数から算出、配布サイズ不明） | no | 公式検索索引は取得、open は403。範囲 lat -5.098652〜-4.129605 / lon 137.124167〜137.680559。指定矩形の西端・東端までは覆わない。 |
| MOLA–HRSC blended global DEM v2 | [公式配布 GeoTIFF](https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif) / [製品資料](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m) | 200 m/pixel（元MOLAは約463 m、HRSC混合） | 資料は Simple Cylindrical と記載。実ファイルの geographic WKT・単位は未検証 | GeoTIFF DEM | 約11 GB | no | Web open 403、ローカルHEAD接続不可。1 GBを超えるため全球の一括取得は対象外。部分取得を使う場合も実ヘッダーを先に確認。 |
| 30-m HRSC Gale DTM（追加の地域予備） | [著者公開資料](https://zenodo.org/records/5808354) / [配布 GeoTIFF](https://zenodo.org/records/5808354/files/hrsc_km09_h1938_h1927_h1916-dtm-mosaic.tif?download=1) | 30 m/pixel | Equidistant cylindrical、球 R=3396.190 km | Float32 GeoTIFF | 311.8 MB | yes（資料）/ no（TIFF） | Persaud・Putri・Muller。TIFF open は Cache miss。MD5:1d714f2142a56e962d50d985b7088b13（配布元記載）。境界・NoDataは未確認。 |
| Mars Trek DEM サービス | [公式 Trek API](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) / [NASA掲載 MOLA capabilities](https://api.nasa.gov/mars-wmts/catalog/Mars_MGS_MOLA_DEM_mosaic_global_463m_8/1.0.0/WMTSCapabilities.xml) | MOLA 表示用463 m。Gale固有の標高DEMは未特定 | EQサービスは EPSG::104905 | WMTS表示画像。数値標高DEMとは別 | 不明 | yes（API説明）/ no（capabilities・DEM） | capabilities はリダイレクト後取得失敗。8-bit grayscale表示を標高値として扱わない。 |
| USGS SIM 3292 地質GIS | [公式ページ](https://pubs.usgs.gov/sim/3292/) / [出版物レコード](https://pubs.usgs.gov/publication/sim3292) | 縮尺1:20,000,000（局所ナビの砂地判定には粗い） | 地図はRobinson。GIS側のCRSは未確認 | Database ZIP（内部GIS形式未確認） | 790 MB | no | 公式検索索引にDatabase ZIPあり。openは403で、ZIP直接URL・readme・GIS内容は取得できず。ファイル名を推測していない。Gale地域図の代わりに全球図として利用可能。 |
| Trek THEMIS 昼・夜IRモザイク | [Trek公式カタログ](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) | 100 m/pixel | EPSG::104905 | WMTS表示画像（個別ResourceURL未取得） | 不明 | no（サービス実応答） | 索引のLayer ID: `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` / `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`。IRモザイクと熱慣性を混同しない。 |
| Trek 熱慣性 | [Trek公式カタログ](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) / [ASU THEMIS TIN解説](https://viewer.mars.asu.edu/glossary/themis) | TrekのTES解像度は未確認。THEMIS TINの個別製品未選定 | Trek TES:EPSG::104905、THEMIS TIN:未確認 | Trek:WMTS、THEMIS TIN:multispectral ISIS2 CUBE | 不明 | no（レイヤー実応答） | Trek索引で確認できた熱慣性は `TES_Thermal_Inertia`。THEMIS由来の熱慣性レイヤーは確認できなかった。ASUはTIN製品の存在を説明している。 |
| NASA Curiosity traverse | [Mars Trek Feature Layer](https://trek.nasa.gov/mars/trekarcgis/rest/services/curiosity_path/MapServer/0) | ベクトル、測位精度不明 | Spatial Reference 104905 | Polyline、Query対応JSON/geoJSON | 不明 | yes（レイヤー定義）/ no（座標全件） | `curiosity_path_line4_18`。公開範囲 lon137.3527165510926〜137.44948483169003、lat -4.729821316171028〜-4.589137174244429。最新経路である保証なし。Query URLパラメータはまだ作成していない。 |

## DTM の推薦と残る確認

優先は **HiRISE U01（1 m grid、308 MB）**。Curiosity 近傍の小さい活動範囲を選ぶ設計に適しており、1 GB以下。取得後に埋め込み PDS ラベルと NoData マスクから対象矩形との交差・有効域を確認し、その中に約3 km四方を置く。今回の調査では矩形全域を単一 HiRISE DTM で覆うことは確認できていない。中心座標だけで覆域を断定しない。

次点は **30 m HRSC Gale（311.8 MB）**。ローカル高解像度 DTM が使えない場合の地域データ候補だが、実ファイルの範囲確認が必要。設計の既定フォールバックは **全球 MOLA–HRSC 200 m**。約11 GBあるため、接続とRange対応を確認して必要範囲のみ取得する。G0の等高線・傾斜生成はT-11の範囲であり、この作業では実施していない。

**ダウンロード済み DTM: なし。** 地形の細かい危険判定や画像との位置合わせはまだ検証できない。

## Mars Trek に関する確認の範囲

[公式画面の検索索引](https://trek.nasa.gov/mars/?refer=ruanyifeng.vercel.app) に `MGS MOLA and Mars Express HRSC, DEM`、`MGS MOLA, Global DEM` と Download Now の表示がある。一方、今回のWeb取得はJS画面の骨組みだけだった。Gale専用DEMの数値ファイルURL、切り出しAPI、パラメータ、出力形式は未確認。カタログのhillshade画像はDEMそのものではない。未確認のAPIをアプリに組み込んでいない。

## 出典・T-02 設定値

- [HiRISE DTM形式・命名規約](https://www.uahirise.org/dtm/about.php): DTMは埋め込みラベル付きIMG、DTEECのEはareoid elevation / Equirectangular、Cは1 m grid。
- [USGS全球DEM資料の索引](https://astrogeology.usgs.gov/search/map/Mars/Topography/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendShade_Global_200mp_v2.lbl.xml): 200 m、配布URL、11 GB、元HRSCの投影変換を確認（ライブopenは未成功）。
- [USGS基盤データ一覧](https://fdp.astrogeology.usgs.gov/fdp/mars/): MOLA 463 m、MOLA–HRSC 200 m、GeoTIFFを確認。
- [30 m HRSCの著者README](https://zenodo.org/records/5808354/files/Persaud_2021_HRSC_DTM-README.txt?download=1): 投影、球半径、Float32、30 mを本文取得で確認。
- [NASA APIカタログ原本](https://github.com/nasa/api-docs/blob/gh-pages/assets/json/apis.json): 上表のMOLA capabilities、およびHiRISE/VikingのNASA掲載capabilities URLを検索索引で確認。HiRISE capabilities取得はtimeout、Vikingは取得不可。
- アプリのタイルURLは `docs/TODO_case10.md` §4.1、座標・範囲・半径・初期ズームは `docs/ui_spec_map.md` §§1,2,7 とユーザー指定をそのまま採用。URL順は `{z}/{y}/{x}`。二重スラッシュも指定どおり。
- Viking: `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0//default/default028mm/{z}/{y}/{x}.jpg`
- HiRISE: `https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0//default/default028mm/{z}/{y}/{x}.png`
- タイル実表示、Vikingの最大native zoom、HiRISEのcapabilities再取得は未確認。Vikingに未確認のmaxNativeZoomは設定していない。
- [Leaflet 1.9.4公式API](https://leafletjs.com/reference-1.9.4.html) と [Vite公式guide](https://vite.dev/guide/) を参照。Node v22.18.0を確認。CRS距離の期待値は `3396190 * Math.PI / 180 = 59274.69752330622 m`（Nodeコンソールで算出）。**Leafletをロードしたテスト実行の成功ではない**。依存未導入でbuild/testは失敗した。
