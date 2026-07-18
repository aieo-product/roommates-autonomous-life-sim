# ROOMMATES

AIキャラクター同士の共同生活を見守る、生活シミュレーションゲームです。

## Character Studio

Issue #8 では、Haru・Aoiのプロフィールと10項目の個性を編集し、判断へ反映する
Character Studioを追加しています。

- 個性値は0〜100で検証
- キャラクターごとのプロフィール・初期プリセット
- `localStorage`へのバージョン付き永続化
- キャラクター単位／全体のプリセット復元
- 二人のパラメータ比較
- `ACCEPT / DECLINE / MODIFY / IGNORE / INITIATE` のモック判断
- Codex App Server向けの共通リクエスト契約とHTTP Transport
- Codex接続失敗時のモックフォールバック

保存キーはゲーム状態と分離された
`roommates.character-settings.v1` です。ゲームをリセットしても削除されません。

## 開発

```bash
pnpm install
pnpm dev
```

品質チェック:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Codexモードは `POST /api/character-decisions` へ、モックと同じ
`CharacterAgentRequest` を送信します。レスポンスは
`CharacterDecision` スキーマで検証されます。
