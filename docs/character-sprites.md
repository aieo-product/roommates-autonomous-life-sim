# ROOMMATES キャラクタースプライト

Issue #6 向けに作成した、生活シミュレーションゲーム用の2Dドットキャラクター素材です。

## キャラクター

- オータニ ハル（`otani-haru`）
- ミズハラ アオイ（`mizuhara-aoi`）
- プレイヤー／プロデューサー（`player-producer`）

各キャラクターには、4方向 × 3コマの歩行パターンを用意しています。

## 仕様

- フレーム: 128 × 128 px、透過PNG
- スプライトシート: 384 × 512 px、3列 × 4行
- 表示確認サイズ: 64 × 64 px
- 列順: `step-left`、`idle`、`step-right`
- 行順: `front`、`left`、`right`、`back`
- 推奨歩行ループ: `step-left → idle → step-right → idle`
- 推奨フレーム時間: 170 ms

各キャラクターのディレクトリには、以下を格納しています。

```text
<character>/
├── frames/
│   ├── front-step-left.png
│   ├── front-idle.png
│   ├── front-step-right.png
│   └── ...（4方向 × 3コマ）
├── walk-cycle.png
└── walk-cycle-preview.gif
```

`preview-64px.png` は、ゲーム画面相当の64px表示で各キャラクターを確認するための画像です。

## Webでの表示

ドットの輪郭を維持するため、拡大縮小時は最近傍補間を使用してください。

```css
.character-sprite {
  image-rendering: pixelated;
}
```

## 制作方針

- 2.5頭身のかわいいシルエット
- 暖色中心の共通パレットと濃い茶色の輪郭
- 小さい表示でも髪型・服色・持ち物で識別できる配色
- 特定作品のキャラクターや固有表現を複製しないオリジナルデザイン

画像は組み込み画像生成を使用し、単色クロマキー背景をローカル処理で透過PNGへ変換しています。
