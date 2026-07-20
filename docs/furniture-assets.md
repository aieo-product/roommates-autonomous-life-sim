# 家具・生活小物 2Dドット素材

Issue #7 の間取り描画と Issue #6 のキャラクターに合わせた、等角投影の家具素材です。

## 描画仕様

- 投影: 2:1 等角投影
- カメラ: 南西から北東
- キャンバス: 256 × 256 px、RGBA PNG
- ピボット: `(128, 236)`（家具の床接地点）
- 推奨表示倍率: 0.5（128 × 128 px相当）
- 背景、床面、影、文字、ロゴは素材に含めない
- 拡大縮小時は nearest-neighbor を使用する

## 収録素材

| ID | タイル占有 | 間取りアンカー |
| --- | --- | --- |
| `haru-bed` | 3 × 5 | `haru_bed` |
| `aoi-bed` | 3 × 5 | `aoi_bed` |
| `work-desk` | 3 × 2 | `haru_desk`, `aoi_desk` |
| `desk-chair` | 1 × 1 | - |
| `storage-shelf` | 2 × 1 | - |
| `sofa` | 6 × 2 | `living_sofa` |
| `low-table` | 3 × 2 | - |
| `dining-table` | 5 × 3 | `dining_table` |
| `dining-chair` | 1 × 1 | - |
| `tv-console` | 4 × 1 | - |
| `potted-plant` | 1 × 1 | - |
| `floor-lamp` | 1 × 1 | - |
| `laundry-basket` | 2 × 1 | - |
| `kitchen-counter` | 5 × 2 | `kitchen_counter` |
| `refrigerator` | 2 × 2 | `refrigerator` |
| `washroom-vanity` | 2 × 1 | `washroom_vanity` |
| `bathtub` | 4 × 2 | `bathtub` |
| `entry-shoe-cabinet` | 2 × 1 | `entry_cabinet` |
| `balcony-drying-rack` | 4 × 1 | `balcony_drying_rack` |

正確な配置情報は `assets/furniture/manifest.json` を参照してください。各instanceの `floorContact` は、PNGの足元ピボットを合わせる24 × 18タイル間取り上の座標です。SVGのピクセル座標を直接保存しません。

## Webゲームへの組み込み

`apps/web/src/furniture-assets.tsx` が19種類すべてを静的importし、`FurnitureSpriteLayer` として共通の部屋SVGへ描画します。ライブ画面、メモリー記事、リザルトのイベント再現は同じ `ApartmentStage` を利用するため、家具構成も共通です。

間取り側に家具アンカーがあるベッド、デスク、ダイニングテーブル、ソファ、キッチン設備、水回り設備、玄関収納、物干し台は、そのアンカーを既定配置の正本とします。アンカーを持たない椅子、棚、ローテーブル、テレビ台、植物、フロアランプ、洗濯かごは、manifestの `defaultScene.instances` に部屋別の既定配置を記録しています。

PNGの透明余白を含むピボットは全素材で `(128, 236)` に統一されています。Web側は `floorContact` を間取りと共通の式 `screenX = 600 + 25x - 25y`、`screenY = 100 + 12.5x + 12.5y` で投影し、各instanceの `displayScale` を適用したPNGピボットをその点へ合わせてY座標順に描画します。

アンカー付き家具の `floorContact` はアンカー矩形の遠端 `(x + width, y + height)` と一致します。アンカーを持たない家具も、`floorContact` から素材の `footprintTiles` を引いた矩形が担当する部屋内に収まり、ほかの家具や `blocked` 領域へ重ならない位置を使います。この契約により、画面サイズや利用シーンが変わっても家具の足元が床・壁からずれません。
