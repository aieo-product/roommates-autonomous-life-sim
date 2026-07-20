# Roommates Asset Format v1

Roommates Asset Format（RAF）v1 は、部屋、家具、生活小物、キャラクターをゲームロジックから分離して持ち運ぶためのJSON形式です。作者がPNGとmanifestを用意すれば、同じ正方形グリッド上で異なる間取りとキャラクターを動かせることを目的とします。

この文書は公開packの規範仕様です。制作手順は [asset-authoring-guide.md](./asset-authoring-guide.md)、機械可読schemaは [roommates-asset-format-v1.schema.json](./schemas/roommates-asset-format-v1.schema.json)、動く最小構成は [examples/roommates-asset-format-v1](./examples/roommates-asset-format-v1) を参照してください。

## 1. 用語と適合レベル

- **MUST / 必須**: 満たさないmanifestをv1として読み込んではいけません。
- **SHOULD / 推奨**: 特別な理由がなければ満たします。
- **logical tile**: 衝突判定と配置に使う正方形の1マスです。画面上では等角投影の菱形になります。
- **canvas**: 透過部分を含む元画像全体のピクセル矩形です。
- **content bounds**: canvas内で作品として使用する最小矩形です。
- **pivot**: 画像をワールド座標へ接地するcanvas内の点です。
- **footprint**: assetが床上で占有する整数マス数です。見た目の透明領域とは独立します。
- **floor contact**: footprintの右下境界を表すワールド座標です。

実装は、この仕様に完全適合する公開packに加えて、リポジトリ内の既存runtime manifestも読み込めます。後方互換形式はRAF v1のexport形式ではありません。

## 2. Manifestの種類

すべての公開packはUTF-8 JSONで、次の共通ヘッダーを持ちます。

```json
{
  "format": "roommates.asset-pack",
  "formatVersion": 1,
  "id": "org.example.my-pack",
  "name": "My Pack",
  "packVersion": "1.0.0",
  "license": {
    "spdx": "CC-BY-4.0",
    "attribution": "Example Artist",
    "source": "https://example.com/my-pack"
  }
}
```

`format` は次のいずれかです。

| format | 内容 | 主な必須配列 |
| --- | --- | --- |
| `roommates.asset-pack` | 家具、設備、小物 | `assets` |
| `roommates.character-pack` | キャラクターとアニメーション | `characters` |
| `roommates.room-pack` | グリッド、部屋、配置 | `rooms`, `placements` |
| `roommates.project` | Assets管理画面の編集・import/export状態 | `assets`, `placements` |

公開配布の単位には最初の3形式を使います。`roommates.project` は編集途中のdocumentで、`imageUrl`、Data URL、ブラウザ内保存状態を含められます。配布時はasset/character/room packへ分離し、参照画像をpack内の相対パスへコピーしてください。

IDは小文字英数字で始まり、小文字英数字、`.`、`_`、`-`だけを使います。pack IDは衝突を避けるため、`org.example.pack-name`のように名前空間を付けることを推奨します。

## 3. 正方形ワールドグリッド

### 3.1 軸と投影

論理グリッドは左上原点です。`x`は東（右）、`y`は南（下）へ増加し、各セルは1×1の正方形です。標準の等角投影は次の式です。

```text
screenX = origin.x + (x - y) * tileWidthPx / 2
screenY = origin.y + (x + y) * tileHeightPx / 2
```

標準ROOMMATES runtimeは`tileWidthPx = 50`、`tileHeightPx = 25`です。論理マスの形は常に正方形であり、`50×25`は画面へ投影した菱形の寸法です。

room packは次の値を宣言します。

```json
{
  "grid": { "type": "square", "columns": 24, "rows": 18, "tileSize": 1 },
  "projection": {
    "type": "isometric-cutaway",
    "tileWidthPx": 50,
    "tileHeightPx": 25,
    "origin": { "x": 600, "y": 100 },
    "cameraDirection": "south-west-to-north-east"
  }
}
```

### 3.2 footprintとfloorContact

`footprintTiles.width`はworld x方向、`footprintTiles.depth`はworld y方向の占有数です。`floorContact = {x, y}`のassetが占有する半開区間は次のとおりです。

```text
[x - width, x) × [y - depth, y)
```

たとえば`footprintTiles: {width: 1, depth: 2}`を`floorContact: {x: 6, y: 3}`へ置くと、world上の`x=[5,6)`, `y=[1,3)`を占有します。room境界、blocked領域、別assetとの衝突判定はこの矩形だけで行います。

小数の`floorContact`は既存レイアウトとの互換用に読み込めます。新しいroom packはセル境界へ接地する整数値を推奨します。

### 3.3 基準サイズ

キャラクター1体は常に`1×1`です。家具のfootprintはキャラクターを物差しに、実際に通行を塞ぐ床面積で決めます。現在の標準packで固定する主要サイズは次のとおりです。

| asset | footprint | 備考 |
| --- | --- | --- |
| character | 1×1 | 全キャラクター共通。変更不可 |
| refrigerator | 1×1 | 1セル設備 |
| island-kitchen | 1×2 | world y方向に長い対面式アイランド |
| bathtub | 1×2 | 浴室内でworld y方向に長い |
| sofa | 3×1 | 3セル幅 |
| balcony-drying-rack | 2×1 | 2セル幅 |
| entry-rug | 2×1 | 玄関の床小物 |

PNGの絵がセル外へ高く伸びても、footprintを広げてはいけません。高さや余白は`render`で吸収します。

## 4. Asset pack

`roommates.asset-pack`の各assetは次の契約を持ちます。

```json
{
  "id": "example.island-kitchen",
  "label": "Island kitchen",
  "kind": "fixture",
  "file": "images/island-kitchen.png",
  "footprintTiles": { "width": 1, "depth": 2 },
  "orientation": "south-west-to-north-east",
  "anchorIds": ["kitchen_island"],
  "render": {
    "canvas": { "width": 256, "height": 256 },
    "contentBounds": { "x": 80, "y": 91, "width": 148, "height": 145 },
    "pivot": { "x": 128, "y": 236 },
    "flipX": false,
    "flipY": false,
    "fitScale": 1.25
  }
}
```

### 4.1 `file`

`file`はpack rootからの安全な相対パスです。絶対パス、URL、`..`によるpack外参照は禁止します。v1のラスタ画像は透過PNGを推奨し、rendererはnearest-neighborで拡縮します。

### 4.2 `render.canvas`

元PNGの幅と高さを整数pxで記録します。validatorは実ファイルを利用できる場合、PNGのIHDR寸法との一致を検証します。家具の標準canvasは256×256pxですが、形式上は別寸法も使用できます。

### 4.3 `render.contentBounds`

元canvas座標の`{x,y,width,height}`です。背景や意図しない透明余白を除いた作品領域を表し、必ずcanvas内へ収めます。rendererはfootprintへ自動fitするとき、この幅を使います。画像を差し替えたら再計測してください。

### 4.4 `render.pivot`

画像の床接地点を元canvas座標で表します。通常はassetの最も手前にある床面中央です。`pivot`は透明領域を含むcanvas基準で、`contentBounds`基準ではありません。

描画位置は次のように求めます。

```text
scale = ((width + depth) * tileWidthPx / 2) / contentBounds.width * fitScale
left  = projectedFloorContact.x - transformedPivot.x * scale
top   = projectedFloorContact.y - transformedPivot.y * scale
```

### 4.5 `orientation`, `flipX`, `flipY`

`orientation`はPNGが制作された向きです。標準は`south-west-to-north-east`です。room配置で向きを上書きする場合、runtimeは対応画像を選ぶか、明示的にflipを適用します。

`contentBounds`と`pivot`はflip前の元画像座標です。`flipX: true`なら描画時のpivot xは`canvas.width - pivot.x`、`flipY: true`ならpivot yは`canvas.height - pivot.y`として扱います。flipは画像ファイル自体を書き換えません。

### 4.6 `fitScale`

footprintから求めた自動scaleへの倍率です。`1`を基準にし、絵柄上の遠近差を補正するときだけ変更します。衝突判定や移動可能領域には影響しません。instance単位の`displayScale`は既存runtimeとの互換用で、新規packではassetの`fitScale`を優先します。

## 5. Character pack

キャラクターも床上ではassetと同じですが、次の制約があります。

- `footprintTiles`は必ず`{width:1, depth:1}`です。
- `render.canvas`は1フレームの寸法と一致します。
- `render.pivot`は足元中央です。髪やエフェクトがセル外へ出てもfootprintは変更しません。
- 4方向のrowを`south`, `east`, `north`, `west`へ明示的に対応付けます。
- animationのframe番号はsprite sheetのcolumn番号です。

```json
{
  "id": "example.resident",
  "label": "Example Resident",
  "role": "resident",
  "footprintTiles": { "width": 1, "depth": 1 },
  "orientation": "south-west-to-north-east",
  "render": {
    "canvas": { "width": 128, "height": 128 },
    "contentBounds": { "x": 28, "y": 14, "width": 72, "height": 104 },
    "pivot": { "x": 64, "y": 118 },
    "flipX": false,
    "flipY": false,
    "fitScale": 1
  },
  "portrait": {
    "file": "images/resident-portrait.png",
    "canvas": { "width": 256, "height": 256 }
  },
  "spriteSheet": {
    "file": "images/resident-walk-cycle.png",
    "canvas": { "width": 384, "height": 512 },
    "frameSize": { "width": 128, "height": 128 },
    "columns": 3,
    "rows": 4,
    "directionRows": { "south": 0, "east": 1, "north": 2, "west": 3 },
    "animations": {
      "idle": { "frames": [1], "frameDurationMs": 170, "loop": true },
      "walk": { "frames": [0, 1, 2, 1], "frameDurationMs": 170, "loop": true }
    }
  }
}
```

スプライトシート寸法は`frameSize.width × columns`および`frameSize.height × rows`と一致しなければなりません。portraitはゲーム内の衝突・接地には使いません。

## 6. Room packと配置

roomは整数セル矩形、またはL字などを表現する矩形配列です。zoneを入れ子にできます。同じpack内でroomとzoneのIDは一意です。

```json
{
  "id": "kitchen",
  "name": "Kitchen",
  "bounds": { "x": 4, "y": 0, "width": 4, "height": 4 },
  "blocked": [{ "x": 4, "y": 0, "width": 1, "height": 1 }]
}
```

room packは依存するpackを宣言します。

```json
{
  "dependencies": {
    "assetPacks": [{ "id": "org.example.furniture", "version": "^1.0.0" }],
    "characterPacks": [{ "id": "org.example.characters", "version": "^1.0.0" }]
  }
}
```

配置は画像のpx座標ではなく、room IDと`floorContact`だけを正本にします。

```json
{
  "placements": {
    "assets": [
      {
        "instanceId": "island",
        "assetId": "example.island-kitchen",
        "roomId": "kitchen",
        "floorContact": { "x": 6, "y": 3 }
      }
    ],
    "characters": [
      {
        "instanceId": "resident-a",
        "assetId": "example.resident-a",
        "roomId": "kitchen",
        "floorContact": { "x": 5, "y": 2 },
        "facing": "east"
      },
      {
        "instanceId": "resident-b",
        "assetId": "example.resident-b",
        "roomId": "kitchen",
        "floorContact": { "x": 7, "y": 2 },
        "facing": "west"
      }
    ]
  }
}
```

この例では1×2のアイランドがworld y方向へ伸び、2人は西側と東側から向き合います。会話、移動、アニメーションはpixel位置ではなく、room ID、anchor ID、footprint、立ち位置を利用して計画してください。

rendererの基本描画順は投影後のfloor contact y、同値ならxです。背の高い画像でも、床接地点で並べれば人物が家具の手前・奥を自然に移動できます。

## 7. Assets管理画面のproject形式

管理画面は次の編集用envelopeをimport/exportします。

```json
{
  "format": "roommates.project",
  "formatVersion": 1,
  "id": "my-room",
  "name": "My Room",
  "assets": {
    "furniture": [],
    "characters": []
  },
  "placements": {
    "furniture": [],
    "characters": []
  }
}
```

projectのfurnitureは公開assetのフィールドに加え、ブラウザpreview用`imageUrl`を持ちます。characterは`file`, `imageUrl`, `portraitFile`, `portraitUrl`, `animationPreset`を持ちます。`imageUrl`はHTTPS URL、同一site相対URL、Blob URL、画像Data URLを利用できますが、公開packへexportするときは必ず相対`file`へ正規化します。

importerは未知のフィールド、重複ID、不正な参照、1×1でないcharacter、canvas外のcontent boundsをエラーとして表示します。vendor独自データは`extensions`だけへ保存し、`org.example.feature`のような名前空間付きkeyを使います。

## 8. Versioningとmigration

`formatVersion`と`packVersion`は役割が異なります。

- `formatVersion`はschemaのmajor versionです。v1 loaderは`1`だけを受理します。
- `packVersion`は作者が管理するSemVerです。画像追加はminor、metadata修正はpatch、ID削除や意味変更はmajorとします。
- v1の必須フィールド削除、座標の意味変更、footprint解釈の変更は`formatVersion: 2`が必要です。
- 新しい任意情報は、v1の`extensions`へ先行実装できます。標準化するときは既存v1 readerが安全に拒否または無視できるかを確認します。
- migrationは`v1 JSON → v2 JSON`の純粋で決定的な変換として提供し、元ファイルを上書きせず新しいexportを作ります。
- loaderが対応していないfuture versionを推測して読み込んではいけません。

リポジトリ内runtime manifestの`version: 5`はrenderer実装用versionであり、公開packの`formatVersion: 1`とは別です。importerはRAF v1を正規化してruntime v5の`format: "roommates-grid-assets"`、`grid.characterFootprint: {width:1,depth:1}`、assetごとの`render`へ変換します。runtime v4以前のtop-level `pivot`, `flipX`, instance `displayScale`は読み込み互換だけに残します。

## 9. Licenseとattribution

公開するasset/character/room packは`license.spdx`と`license.attribution`が必須です。`source`には作者ページまたは元リポジトリを記録します。

- pack全体と同じ条件なら、各assetへlicenseを繰り返す必要はありません。
- 一部だけ条件が異なる場合、そのassetの`license`で上書きします。
- 自作物でも`NOASSERTION`ではなく、配布可能なSPDX IDまたは`LicenseRef-*`を選びます。
- 第三者素材は再配布、改変、商用利用、生成AI利用などの条件を作者が確認します。
- rendererやexporterはattributionを削除してはいけません。配布物には全packとoverrideのクレジット一覧を同梱します。

コードのライセンスと画像・文章のライセンスは別にできます。pack作者は両者を混同しないでください。

## 10. Validationと安全性

リポジトリ内の標準検証は次のコマンドです。

```bash
npm run validate:assets
npm run validate:assets -- path/to/manifest.json
npm run validate:assets -- --schema-only path/to/draft.json
```

通常モードは、既存の家具・キャラクター・room manifest、v1サンプルを検証し、実在するPNGのcanvas寸法も確認します。`--schema-only`は画像をまだ同梱していないdraft manifestの構造だけを検証します。

importerは少なくとも次を拒否します。

- JSONとして不正、未対応format/version、未知フィールド
- 絶対パス、URL、`..`を含むportable `file`
- 重複ID、存在しないasset/character/room参照
- 0以下または整数でないfootprint、1×1でないcharacter
- canvas外のcontent bounds/pivot、不正なflip/scale
- room外へ出るfootprint
- attributionのない公開pack

ホストは画像のbyte数、canvas最大寸法、展開後archive容量にも上限を設けるべきです。manifestの文字列をHTMLとして直接挿入せず、Data URLは画像MIMEだけを許可します。

## 11. 実装境界

プラットフォーム拡張時は次の境界を維持します。

- **pack/parser**: JSONのvalidation、version migration、path解決、license収集だけを担当します。
- **grid/renderer**: footprint、projection、pivot、content bounds、flip、depth sortを担当します。
- **room/editor**: roomと配置の編集、import/export、永続化を担当します。
- **game/agents**: `roomId`, `anchorId`, logical destination, action, dialogueを出力し、PNGやscreen pxを知りません。

この分離により、画像を差し替えても移動経路とストーリー制御は変わらず、間取りを差し替えてもエージェントの行動形式を再設計せずに済みます。
