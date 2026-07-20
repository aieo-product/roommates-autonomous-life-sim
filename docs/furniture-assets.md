# 家具・生活小物 2Dドット素材

ROOMMATESの部屋・キャラクター・家具は、同じ24 × 18の正方形ワールドグリッドを正本として扱います。SVG上の等角投影は表示方法であり、素材や配置データに画面座標を埋め込みません。

## Grid Asset v5

- 論理グリッド: 24 × 18の正方形セル
- キャラクター占有: 1 × 1セル
- 投影: 2:1 等角投影（1セルを50 × 25pxのひし形として表示）
- カメラ: 南西から北東
- 素材キャンバス: 原則256 × 256pxのRGBA PNG
- `floorContact`: ワールドグリッド上の足元接地点
- `footprintTiles`: `width × depth` の占有セル数
- `render.pivot`: 素材キャンバス上で`floorContact`へ合わせるピクセル
- `render.contentBounds`: 透明余白を除く実画像の範囲
- `render.fitScale`: 自動フィット後の微調整倍率。絶対表示倍率ではない

表示倍率は次の式から自動算出します。

```text
projectedFootprintWidth = (width + depth) × 25
scale = projectedFootprintWidth ÷ contentBounds.width × fitScale
```

この規格により、同じ`footprintTiles`、`contentBounds`、`pivot`を満たす画像へ差し替えても、部屋の配置とキャラクター導線は変わりません。

## 収録素材

| ID | 占有セル | 既定用途 |
| --- | ---: | --- |
| `haru-bed` | 2 × 3 | Haruのベッド |
| `aoi-bed` | 2 × 3 | Aoiのベッド |
| `work-desk` | 2 × 1 | 両個室の机 |
| `desk-chair` | 1 × 1 | 机の椅子 |
| `storage-shelf` | 1 × 1 | 個室の棚 |
| `sofa` | 3 × 1 | リビング |
| `low-table` | 2 × 1 | リビング |
| `dining-table` | 3 × 2 | ダイニング |
| `dining-chair` | 1 × 1 | ダイニング |
| `tv-console` | 2 × 1 | リビング |
| `potted-plant` | 1 × 1 | リビング |
| `floor-lamp` | 1 × 1 | リビング |
| `laundry-basket` | 1 × 1 | バルコニー |
| `island-kitchen` | 1 × 2 | 2マスの対面アイランドキッチン |
| `refrigerator` | 1 × 1 | キッチン |
| `washroom-vanity` | 1 × 1 | 洗面所 |
| `bathtub` | 1 × 2 | 浴室。奥行き軸に沿って配置 |
| `entry-rug` | 2 × 1 | 玄関。収納棚は置かない |
| `balcony-drying-rack` | 2 × 1 | バルコニー |
| `kitchen-counter` | 3 × 1 | 旧レイアウト互換カタログ |
| `entry-shoe-cabinet` | 1 × 1 | 旧レイアウト互換カタログ |

正確な素材メタデータと既定配置は`assets/furniture/manifest.json`を参照してください。既定シーンでは`island-kitchen`と`entry-rug`を使い、旧キッチンカウンターと玄関収納は配置しません。

## Webゲームと管理画面

`apps/web/src/asset-grid.ts`がグリッド投影、footprint自動フィット、pivot補正、v4互換読み込み、manifest検証を提供します。実画面は`ManagedFurnitureSpriteLayer`から同じ計算を利用し、Y座標順に描画します。

ゲーム上部の「Assets」から管理画面を開くと、次をブラウザ内で変更できます。

- 家具・キャラクター画像（URLまたはData URL）
- 占有セル数、キャンバス、実画像範囲、pivot、向き、flip、fitScale
- 部屋、`floorContact`、複数インスタンス
- JSONのimport / export / reset

変更はメインの部屋へ即時反映され、検証済みデータだけがlocalStorageへ保存されます。配布用のポータブル形式は`docs/schemas/roommates-asset-format-v1.schema.json`と`docs/examples/roommates-asset-format-v1/`を参照してください。

## 既定レイアウト

- アイランドキッチン: 1 × 2セル。HaruとAoiは長辺の左右へ1 × 1セルずつ立ち、会話時は互いを向く
- 冷蔵庫: 1 × 1セル。アイランドから離して動線を確保
- 浴槽: 1 × 2セル。浴室内の奥行き軸へ合わせ、画像幅を占有セルへ自動フィット
- ソファ: 3 × 1セル。リビング内へ収める
- 物干し: 2 × 1セル。バルコニー内へ収める
- 玄関: 2 × 1セルのラグのみを置き、収納棚を置かない

部屋境界、家具anchor、blocked領域、キャラクター立ち位置は`docs/room-layout.json`に記録します。
