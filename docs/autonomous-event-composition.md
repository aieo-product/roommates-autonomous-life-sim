# 自律イベント合成

## 目的

Producer が「見守る」を選んだ余白で、Agent が自分の状態に合う日常行動を選び、イベントを組み立てられるようにする。自由度は「用意された安全な部品の選択」に置き、ゲーム状態・効果量・同意のルールはサーバーが保持する。

## 信頼境界

- サーバーは `AutonomousActionCandidate` を生成し、許可する場所、時間、必要体力、ストレス上限、参加形式、効果上限、同意条件を確定する。
- モデルが選べるのは、提示された候補の `candidateId`、許可済みの `invitation`（`solo` / `open`）、候補と同一の公開意図 `publicIntent` だけである。選択は `CharacterInitiative` として返す。
- `decision !== "INITIATE"`、候補にない ID、候補にない誘い方、改変された `publicIntent` は実行権限を持たない。
- App Server の出力は提案であり、候補照合と mechanics の確定は常に Game Server が行う。

## 行動部品と候補生成

`buildAutonomousActionCandidates` は次のサーバー管理部品を組み合わせ、同じゲーム状態では決定的な候補を返す。

| 部品 | 現在の規模 | 役割 |
| --- | ---: | --- |
| `AUTONOMOUS_ACTIVITY_ELEMENTS` | 20 種類以上 | 休息、家事、軽食、音楽、創作、会話などの目的と基本予算 |
| `ACTION_PLACE_ELEMENTS` | 6 種類 | 共有空間内の許可済み場所 |
| `ACTION_PACE_ELEMENTS` | 4 種類 | 5〜30分の所要時間、体力コスト、効果倍率 |
| `ACTION_INVITATION_ELEMENTS` | 5 種類 | 一人で始める、任意参加、選択権を先に渡す等の誘い方 |

全組み合わせをモデルへ渡すのではなく、活動ごとの許可リストと次の状態条件で絞る。

- 現在の `phase`
- Agent 本人の `energy` / `stress` / `trust`
- 共有 memory の有無
- 未解決 conflict の有無
- 活動の参加形式と、場所・ペース・誘い方の互換性
- 当日と直近の公開 initiative ログ（同じ活動は1日1回、2 phase の間隔、1 run 7回まで）

低体力または高ストレス時は軽いペースだけを残す。安定順序で並べ、Agent ごとに最大 `AUTONOMOUS_ACTION_MAX_CANDIDATES`（6件）を渡す。候補は Producer が変換・ロックなしの `observe-rest` を選んだターンだけ提示し、具体的な休息イベントや安全変換後のターンを含む、それ以外のターンは空配列にする。

## initiative の検証と合成

Game Server は各 Agent に実際に提示した候補集合に対して `CharacterInitiative` を照合し、valid な initiative だけを合成対象にする。

- **single**: 一方だけが valid な候補を選んだ場合、その Agent を起点に一人行動または任意参加のイベントを作る。相手の不参加は失敗にしない。
- **shared**: 両者が同じ互換候補を独立して選んだ場合、一つの共同イベントへまとめる。効果予算は加算しない。
- **parallel**: 両者が別の valid な候補を選び、共同化できない場合、同じ時間帯の並行する二つの小行動として扱う。各効果は選んだ本人の候補予算内に閉じ、相手への効果や場所を持ち越さない。

`solo` 同士は同じ活動でも parallel のままにする。`shared_opt_in` は二人が同じ候補を `open` で選んだ場合だけ成立し、一方だけの選択では実行しない。非参加者の効果は0に固定し、選択者の `energyCost` は共通分岐処理後に必ず適用する。

異なる候補同士を片方へ寄せず `parallel` にすることで、選択の衝突も決定的に解決し、モデルの自由文で mechanics を上書きしない。valid な initiative が一つもなければ、既存の `observe-rest` にフォールバックする。

## Director と event policy

Game Server の合成処理が、使用する `EventDefinition`、参加者、場所、時間、効果予算、同意条件を先に固定し、その定義をDirector入力にも渡す。Director は公開Decisionだけを受け取り、その範囲でナレーション、台詞、公開会話、記憶案を作る。Agentの `internalSummary` と未検証の `expectedEffects` はDirectorへ渡さない。

最終段では `constrainResolvedEvent` が `EventDefinition` に基づいて、参加分岐、効果量、シーン位置、conflict 更新、会話長を再検証・制限する。さらに候補ごとの個別予算と体力コストを再適用し、自律イベントからの新規 conflict 追加を禁止する。共有opt-inの謝罪だけが既存 conflict 1件の解消候補を出せる。memoryの感情影響と重要度もmode・親密度別の小さい上限へ収める。

## ログとリザルト

公開可能な initiative は `EventLogEntry.decisions.haru.initiative` / `aoi.initiative` に残す。保持するのは `candidateId`、`invitation`、`publicIntent` のみで、`internalSummary` は公開ログへ入れない。

リザルト生成は `resolutionBranch === "self_initiated"` と initiative を根拠に、見守りから生まれた注目イベントや各 Agent の自発行動として記事へ引用できる。shared / parallel の場合も両者の公開 initiative を失わない。

## 拡張方法

1. 日常行動は `AUTONOMOUS_ACTIVITY_ELEMENTS` に追加し、既存の `eventDefinitionId`、状態要件、参加形式、効果予算を明示する。
2. 新しい場所・ペース・誘い方が必要な場合だけ、対応する `ACTION_*_ELEMENTS` を追加する。
3. 候補数上限、決定性、低体力・高ストレス時の絞り込み、schema、無効 ID のフォールバックをテストする。
4. mechanics を増やす変更は先に `EventDefinition` と `constrainResolvedEvent` 側へ実装し、モデルの prompt だけで許可しない。

## 非目標

- モデルの生の自由文から、効果量、場所、時間、秘密、身体接触を生成すること
- `publicIntent` や台詞を mechanics として解釈すること
- `open` を参加同意として扱うこと、拒否・変更を不利益にすること
- 自律イベントから告白、強制的な親密化、未許可の conflict 解消を発生させること
- Producer が具体的なイベントを提案したターンを、Agent の自律候補で上書きすること
