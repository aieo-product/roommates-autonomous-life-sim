# ROOMMATES asset / character / room 制作ガイド

このガイドは、自作PNGをRoommates Asset Format v1へ追加し、Assets管理画面とゲームで確認する最短手順です。フィールドの厳密な意味は [Roommates Asset Format v1](./roommates-asset-format-v1.md) を参照してください。

## 1. サンプルをコピーする

用途に合うmanifestを作業用packのrootへコピーします。

- 家具・設備: [asset-pack.json](./examples/roommates-asset-format-v1/asset-pack.json)
- キャラクター: [character-pack.json](./examples/roommates-asset-format-v1/character-pack.json)
- 間取り・配置: [room-pack.json](./examples/roommates-asset-format-v1/room-pack.json)

推奨ディレクトリは次の形です。

```text
my-roommates-pack/
├── asset-pack.json
├── character-pack.json
├── room-pack.json
└── images/
    ├── island-kitchen.png
    ├── resident-walk-cycle.png
    └── resident-portrait.png
```

`file`はmanifestを含むpack rootからの相対パスにし、`../`、絶対パス、Web URLは使いません。

## 2. footprintを先に決める

PNGを描く前に、床で何マスを塞ぐかを決めます。1キャラクターを1×1とし、家具の幅と奥行きを整数セルで決めてください。

```json
"footprintTiles": { "width": 1, "depth": 2 }
```

`width`はworld x方向、`depth`はworld y方向です。標準のアイランドキッチンと浴槽は1×2、冷蔵庫は1×1です。画像の背が高い、取っ手が張り出す、影が大きい、といった見た目の理由でfootprintを増やさないでください。

向きを90度変えた別variantを作る場合はwidth/depthも交換し、別asset IDとして登録するのがv1で最も安全です。

## 3. 家具PNGを制作する

標準家具は256×256pxの透過RGBA PNGです。

- カメラは南西から北東を見る2:1等角投影です。
- 背景、床、部屋の壁、文字、ロゴは含めません。
- asset本体以外は完全透過にします。
- 影を同梱する場合もfootprint内へ収め、薄い半透明にします。
- pixel artは整数倍で確認し、renderer側はnearest-neighborを使います。

画像を保存したら次の3点を記録します。

1. `canvas`: PNG全体のwidth/height。
2. `contentBounds`: 不透明な作品部分を囲う左上x/yとwidth/height。
3. `pivot`: 床へ接する最前面中央のx/y。

```json
"render": {
  "canvas": { "width": 256, "height": 256 },
  "contentBounds": { "x": 80, "y": 91, "width": 148, "height": 145 },
  "pivot": { "x": 128, "y": 236 },
  "flipX": false,
  "flipY": false,
  "fitScale": 1
}
```

最初は`fitScale: 1`で確認します。隣の1×1キャラクターと比較して見た目だけが不自然な場合に、0.1刻み程度で調整します。footprintをfit用途へ使わないことが重要です。

## 4. characterを制作する

characterの論理footprintは必ず1×1です。標準フレームは128×128px、足元pivotは`{x:64,y:118}`、portraitは256×256pxです。

標準sprite sheetは3列×4行です。

| row | direction | world movement |
| --- | --- | --- |
| 0 | south | `(0,+1)` |
| 1 | east | `(+1,0)` |
| 2 | north | `(0,-1)` |
| 3 | west | `(-1,0)` |

3列の例はleft step、idle、right stepです。manifestでは列名ではなく0始まりのframe番号を並べます。

```json
"animations": {
  "idle": { "frames": [1], "frameDurationMs": 170, "loop": true },
  "walk": { "frames": [0, 1, 2, 1], "frameDurationMs": 170, "loop": true }
}
```

髪、帽子、浮遊エフェクトがセル外へ出ても問題ありません。衝突と経路探索は足元の1×1だけを使います。

## 5. roomと配置を作る

room packの`grid.columns`と`grid.rows`を決め、各roomを整数セル矩形で切ります。L字のroomは`bounds`を矩形配列にします。

```json
{
  "id": "hallway",
  "name": "Hallway",
  "bounds": [
    { "x": 0, "y": 6, "width": 19, "height": 2 },
    { "x": 16, "y": 3, "width": 3, "height": 3 }
  ]
}
```

assetは`floorContact`から左上へfootprintを展開したとき、担当room内へ完全に収まるよう配置します。大きな家具、door clearance、通路が重ならないことも確認します。

対面アイランドの推奨配置は、1×2のアイランドをworld y方向へ置き、人物を西・東へ1セルずつ離して配置する形です。

```json
{
  "assets": [
    { "instanceId": "island", "assetId": "my.island", "roomId": "kitchen", "floorContact": { "x": 6, "y": 3 } }
  ],
  "characters": [
    { "instanceId": "one", "assetId": "my.one", "roomId": "kitchen", "floorContact": { "x": 5, "y": 2 }, "facing": "east" },
    { "instanceId": "two", "assetId": "my.two", "roomId": "kitchen", "floorContact": { "x": 7, "y": 2 }, "facing": "west" }
  ]
}
```

キャラクターの自律行動用には、room IDと家具の`anchorIds`を安定した公開APIとして扱います。画像ファイル名やscreen pxをプロンプト、イベント、移動planへ埋め込まないでください。

## 6. 検証する

リポジトリrootで実行します。

```bash
npm run validate:assets
npm run validate:assets -- path/to/my-roommates-pack/asset-pack.json
```

画像制作前にmanifestだけ確認する場合は次を使います。

```bash
npm run validate:assets -- --schema-only path/to/draft.json
```

エラーにはmanifest pathとJSON pathが表示されます。例:

```text
my-pack/asset-pack.json $.assets[0].render.contentBounds: must fit inside render.canvas
```

公開前には`--schema-only`を外し、画像の存在とPNG canvas寸法も確認してください。

## 7. Assets管理画面で調整する

ゲームをローカル起動します。

```bash
npm run dev
```

ゲーム画面の「Assets 管理」を開くと、家具とcharacterを追加・差し替えできます。

- `footprintTiles`は移動・衝突の規格です。
- `canvas`, `contentBounds`, `pivot`, `flip`, `fitScale`は見た目の規格です。
- 配置はroomと`floorContact`で編集します。
- importは`roommates.project` v1だけを受け入れ、エラー箇所を表示します。
- export JSONはブラウザのlocalStorage外へバックアップできます。
- 「初期状態へ戻す」で保存済みprojectを破棄できます。

管理画面の`imageUrl`はpreview用です。Data URLやBlob URLのままOSS packとして配布せず、PNGを`images/`へ保存し、`file`から参照してください。

## 8. Licenseを埋める

公開packには最低限、次を記録します。

```json
"license": {
  "spdx": "CC-BY-4.0",
  "attribution": "Artist or organization name",
  "source": "https://example.com/original"
}
```

一部のassetだけ条件が異なる場合、そのassetにも`license`を追加します。元素材のライセンスが不明な場合は公開packへ含めないでください。生成ツールを使った場合も、利用規約と再配布権を作者自身で確認します。

## 9. 公開前チェックリスト

- `formatVersion`は1、`packVersion`はSemVerになっている。
- IDが一意で、削除・改名するIDを依存room packが参照していない。
- characterはすべて1×1である。
- footprintがroom内へ収まり、通路とdoor clearanceを塞いでいない。
- canvasが実PNGと一致し、content boundsとpivotがcanvas内にある。
- アイランドの両側に人物の立ち位置があり、互いを向いている。
- relative `file`がpack内にあり、`../`や外部URLを使っていない。
- packと個別overrideのlicense/attributionを確認した。
- `npm run validate:assets`、test、local buildを通した。

