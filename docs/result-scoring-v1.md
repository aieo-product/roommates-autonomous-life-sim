# ROOMMATES Producer Score v1

- Status: Accepted
- Parent design: [7日間リザルト設計](./result-experience.md)
- Data contract: [GameState v2](./game-state-v2.md)
- Execution contract: [高速スキップ設計 v1](./fast-skip.md)
- Issue: [#22](https://github.com/aieo-product/teamOtaniHackathon/issues/22)

## 目的

Producer Scoreは、二人を恋愛成立させたかではなく、Haru/Aoiの主体性とコンディションを守りながら、意味のある7日間を作れたかを評価する。

数値はLLMへ決めさせない。同じ構造化ログと`scoringVersion: "producer-v1"`から、常に同じ軸点、総合点、ランク、根拠順を返す。

## 共通定義

- **高強度イベント**: `intimacyTier >= 2`
- **低強度イベント**: `intimacyTier <= 1`
- **コンディション低下**: Haru/Aoiのどちらかが`energy < 30`または`stress > 70`
- **拒否**: `DECLINE`または`IGNORE`
- **成立イベント**: lockされた要求ではなく、Directorが実際に解決した`selectedEvent`
- **次の介入**: 現在ログより後にある最初の`free_text / candidate / observe` cue。`fast_forward`とAgent/Directorのfallbackだけで生じた処理は除く
- **同じ介入**: 同一`eventDefinitionId`、または同一categoryかつ同等以上のintimacyTier
- **回復行動**: `observe`、`rest`、または直前よりintimacyTierを下げたイベント
- **Producer起因のconflict**: safety flag、lock無視、高強度時の強行、拒否直後の反復と同じturnで追加されたconflict

判定には安全化・解決後のデータを使う。安全化前のraw入力、`internalSummary`、Agentの`expectedEffects`は使わない。

## 高速スキップの採点境界

`inputMethod: "fast_forward"`のturnは、全28turnのdata coverage、状態遷移、Ending、記事、highlightには含める。一方、システムが選んだcueをProducer本人の意思として扱わないため、そのturn自体をProducer Scoreのpositive/negative evidenceにしない。

- `fast_forward`での受諾、拒否、修復、conflict、category増加を直接加減点しない。
- skip中のconflictをProducer起因にしない。
- chronologicalなphase経過、後続turnのBefore state、cooldownには含める。
- 後続の手動介入は、その時点の実状態を使って通常どおり評価する。
- `simulation / app_server / fallback`の実行元は採点へ影響させない。

```ts
type ProducerInteractionCoverage = {
  controlledTurns: number;
  skippedTurns: number;
  assessment: "standard" | "assisted" | "reference";
};
```

- `standard`: skipなし
- `assisted`: 手動turnとskip turnが混在
- `reference`: 全turnが自動進行

これはログ欠損を表す既存`coverage`とは別物であり、点数へ直接加減しない。UIではランクと並べて明示し、全自動runの点数を手動プロデュース実績と誤認させない。詳細な実行契約は[高速スキップ設計 v1](./fast-skip.md)を正本とする。

## 計算方法

各軸は、基礎点にルールの加減点を足し、軸ごとの0〜満点へclampする。

```text
axisScore = clamp(baseScore + sum(appliedRulePoints), 0, maxScore)
overallScore = sum(axisScore)
```

- 各ruleの`cap`は、そのruleが1runで加点・減点できる絶対値の上限。
- 同じturn・同じruleは一度だけ適用する。
- 一つのturnが異なる軸の根拠になることは許可する。例: 疲労時の強行は心理安全とペーシングの両方へ影響する。
- 判定機会がなかったruleは0点。拒否がなかったこと、conflictがなかったことを減点しない。
- 軸内の加減点はログの時系列で集計し、最後に整数へclampする。

| 軸 | 基礎点 | 満点 |
| --- | ---: | ---: |
| 主体性の尊重 | 15 | 25 |
| 心理安全・コンディション | 15 | 25 |
| 関係へのケア | 10 | 20 |
| ペーシング | 8 | 15 |
| 物語の豊かさ | 6 | 15 |
| **合計** | **54** | **100** |

基礎点は「問題行動はないが、まだ評価できる選択も少ないrun」をC上限付近に置く。高ランクには、拒否への適応、休息、自然な転機、多様な記憶などの肯定根拠が必要になる。

## 1. 主体性の尊重 — 25点

| Rule ID | 点 | cap | 条件 |
| --- | ---: | ---: | --- |
| `AG-01 respected_no` | +2 | +6 | 拒否後2フェーズ以内の次介入が、回復行動、別category、または低いtierになった |
| `AG-02 honored_modify` | +2 | +4 | `MODIFY`が`resolutionBranch: "modified"`として成立し、元提案より軽い実効果または短い内容になった |
| `AG-03 enabled_initiative` | +1 | +3 | `INITIATE`が`self_initiated`分岐として成立し、Producer提案で上書きされなかった |
| `AG-10 repeated_after_no` | -4 | -12 | 拒否後2フェーズ以内に同じ介入を、回復行動を挟まず再提案した |
| `AG-11 repeated_unsafe_cue` | -3 | -6 | safety transformまたはlock理由の表示後、同種の危険・強制要求を繰り返した |

最初の拒否、最初の安全変換、`ACCEPT`の少なさは減点しない。

## 2. 心理安全・コンディション — 25点

| Rule ID | 点 | cap | 条件 |
| --- | ---: | ---: | --- |
| `WB-01 timely_recovery` | +2 | +8 | コンディション低下中に回復行動を選んだ |
| `WB-02 recovery_effect` | +1 | +3 | 回復行動後、対象Agentのenergyが増えるかstressが下がった |
| `WB-10 intense_while_strained` | -3 | -9 | コンディション低下中に高強度イベントを要求し、fallbackではなく成立させた |
| `WB-11 no_recovery_window` | -3 | -6 | コンディション低下中に2回以上連続で低強度・observeを挟まなかった |
| `WB-12 safety_transform` | -1 | -3 | coercion/deception/dangerを含むcueが安全変換された。最初の学習機会に留めるため軽い減点 |

Agent/Directorのtimeout、schema error、runtime fallbackはこの軸へ影響させない。

## 3. 関係へのケア — 20点

| Rule ID | 点 | cap | 条件 |
| --- | ---: | ---: | --- |
| `CA-01 repair_opportunity` | +2 | +4 | 実在する未解決conflictに対し、対象を限定した話し合い・修復の場を用意した。双方辞退でも成立 |
| `CA-02 conflict_repaired` | +1 | +2 | `CA-01`の後日、同じconflict IDが解決した |
| `CA-03 meaningful_shared_memory` | +1 | +4 | safety flagなしで、importance 6以上かつemotionalImpactが正の共有memoryが生まれた |
| `CA-10 forced_intimacy` | -3 | -9 | lock中、拒否後、または条件未達で告白・接触・高親密度イベントを反復した |
| `CA-11 conflict_neglected` | -2 | -4 | conflict継続中に2日以上、高強度介入だけを続け、休息・距離・修復機会を置かなかった |
| `CA-12 producer_caused_conflict` | -3 | -6 | Producer起因のconflictが追加された |

Producer起因conflictの修復加点は、そのconflictに対する`CA-12`減点を超えない。conflictを作って即修復する得点稼ぎを禁止する。

## 4. ペーシング — 15点

| Rule ID | 点 | cap | 条件 |
| --- | ---: | ---: | --- |
| `PC-01 recovery_gap` | +1 | +3 | 高強度イベント同士の間に低強度・observe・restを1フェーズ以上置いた |
| `PC-02 waited_for_unlock` | +2 | +4 | lock理由の表示後、条件が満たされるまで同じ要求を繰り返さなかった |
| `PC-10 cooldown_violation` | -2 | -6 | 同categoryをEventDefinitionのcooldown以内に要求し続けた |
| `PC-11 crowded_high_intensity` | -3 | -6 | 1日に高強度イベントを2件以上成立させた |
| `PC-12 repeated_locked_event` | -2 | -4 | 条件が変わっていないのに、lockされた同一イベントを2フェーズ以内に再要求した |

システムが安全なfallbackへ置換しただけのturnは、成立したfallbackを加点材料にせず、要求側の反復有無だけを判定する。

## 5. 物語の豊かさ — 15点

| Rule ID | 点 | cap | 条件 |
| --- | ---: | ---: | --- |
| `ST-01 category_breadth` | +1 | +4 | 成立イベントのunique categoryが3〜6種類へ増えた。7種類目以降は追加点なし |
| `ST-02 memories_across_days` | +1 | +3 | importance 6以上のmemoryが異なる日に生まれた |
| `ST-03 natural_arc` | +2 | +4 | 拒否→尊重、conflict→後日修復、observe→INITIATEのいずれかが複数turnで成立した |
| `ST-04 balanced_presence` | +1 | +2 | Haru/Aoi双方に、少なくとも1件ずつ`MODIFY`または`INITIATE`が成立した |
| `ST-10 repetitive_category` | -1 | -5 | 同categoryの成立イベントが、減衰上限を超えて続いた |
| `ST-11 manufactured_drama` | -2 | -4 | Producer起因conflictと即修復を同じパターンで反復した |

`ST-01`と`ST-02`は回数を増やし続けてもcapを超えない。negative memoryを作るだけでは加点しない。

## ランク

| 総合点 | ランク |
| ---: | :---: |
| 90〜100 | S |
| 75〜89 | A |
| 60〜74 | B |
| 0〜59 | C |

- `Ending.kind`を変えただけでは点数・ランクを変えない。
- 初回の安全変換だけでランク上限を設けない。
- データcoverageが95%未満なら、点数は参考値として表示しランクへ「参考」を付ける。
- coverageが75%未満、またはDecision/Before/Afterのいずれかが全件欠ける場合は、総合ランクを断定しない。

## Coverage

終了runの期待turn数は28。各turnについて次の5群を検査する。

1. 安全化済みcueと選択結果
2. Haru/AoiのPublicCharacterDecision
3. characters/sharedのBefore/After
4. appliedEffects、memory、conflict更新
5. selected event、runtime source、createdAt

```text
coverage = presentRequiredGroups / (28 * 5)
```

coverageは点数へ加減しない。`complete / partial / unavailable`の表示とwarningにだけ使う。

完全な`fast_forward`ログは欠損ではないためdata coverageへ通常どおり算入する。自動進行の割合は`ProducerInteractionCoverage`で別に表す。

## Producerタイプ

5軸を満点に対する割合へ正規化し、最も高い軸からタイプを決める。

| 軸 | Producerタイプ |
| --- | --- |
| 主体性の尊重 | 余白をつくるプロデューサー |
| 心理安全・コンディション | コンディションを読むプロデューサー |
| 関係へのケア | 関係をほどくプロデューサー |
| ペーシング | 間を設計するプロデューサー |
| 物語の豊かさ | 転機をつなぐプロデューサー |

同率時の優先順は、主体性、心理安全、関係へのケア、ペーシング、物語の豊かさ。タイプは優劣ではなく、そのrunで最も強く表れた傾向として表示する。

## 根拠の表示順

- 主要な加点: positive evidenceを点の大きい順、早いDay/phase、Rule IDで並べて上位3件。
- 改善ポイント: negative evidenceを絶対値の大きい順、早いDay/phase、Rule IDで並べて上位3件。
- negative evidenceがない場合は、正規化点が最も低い軸の定型ヒントを1件表示する。
- 各根拠は`ruleId / eventLogIds / day / phase / points / message`を持つ。

## 固定テストベクトル

実装は、少なくとも次のfixtureを固定する。

| Fixture | 軸点（主体性/安全/ケア/間/物語） | 合計 | ランク |
| --- | --- | ---: | :---: |
| `respectful-friendship` | 23 / 23 / 17 / 13 / 14 | 90 | S |
| `respectful-couple` | 23 / 23 / 17 / 13 / 14 | 90 | S |
| `neutral-low-intervention` | 18 / 20 / 11 / 11 / 9 | 69 | B |
| `repeated-pressure-couple` | 3 / 8 / 4 / 2 / 5 | 22 | C |

追加の不変条件:

- `respectful-friendship`と`respectful-couple`はEnding以外が同じなら完全に同点。
- 拒否件数だけを増やしても、Producerの次介入が同じなら減点しない。
- Agent reflectionの文章、成否、runtime sourceを変えても点数は変わらない。
- 同一ログをシャッフルせず再計算すると、evidence IDと並び順まで同じになる。
- 同じ手動ログの間に`fast_forward` turnを追加しても、そのskip turn自身からscore evidenceを生成しない。
- 同じ正本結果なら`simulation`と他のruntime sourceで点数を変えない。
- 全28turnが高速スキップならdata coverageは100%で、interaction assessmentは`reference`になる。
- 手動turnと高速スキップが混在するrunはinteraction assessmentが`assisted`になる。
- skip中のconflictやrepairを`CA-12`または`CA-02`の直接根拠にしない。
