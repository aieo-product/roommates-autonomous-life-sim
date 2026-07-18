import { useState } from "react";
import type { CharacterSettings } from "../domain/characterSettings";
import {
  createHttpCharacterAgentTransport,
  executeCharacterDecision,
  proposalCategories,
  type CharacterAgentMode,
  type ProposalCategory
} from "../services/characterAgent";
import {
  DecisionResults,
  type DecisionResult
} from "./DecisionResults";

interface DecisionDemoProps {
  settings: CharacterSettings;
}

const categoryLabels: Record<ProposalCategory, string> = {
  conversation: "会話",
  sharedActivity: "共同活動",
  chore: "家事",
  romance: "恋愛",
  rest: "休息"
};

const DEFAULT_SITUATION = {
  energy: 68,
  stress: 26,
  trust: 52,
  relationship: 44
} as const;

export const DecisionDemo = ({ settings }: DecisionDemoProps) => {
  const [proposalText, setProposalText] = useState(
    "夕食のあと、二人でゆっくり話す時間を作ろう"
  );
  const [category, setCategory] =
    useState<ProposalCategory>("romance");
  const [mode, setMode] = useState<CharacterAgentMode>("mock");
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function decideForBoth(): Promise<void> {
    const trimmedProposal = proposalText.trim();
    if (!trimmedProposal) {
      setErrorMessage("提案を入力してください。");
      return;
    }

    setIsRunning(true);
    setErrorMessage(null);

    const characters = [
      settings.characters.haru,
      settings.characters.aoi
    ];

    try {
      const transport =
        mode === "codex" ? createHttpCharacterAgentTransport() : undefined;
      const decisions = await Promise.all(
        characters.map((character) =>
          executeCharacterDecision({
            mode,
            character,
            proposalText: trimmedProposal,
            category,
            situation: DEFAULT_SITUATION,
            ...(transport ? { transport } : {})
          })
        )
      );

      setResult({
        decisions,
        source: mode
      });
    } catch (error) {
      if (mode === "codex") {
        const decisions = await Promise.all(
          characters.map((character) =>
            executeCharacterDecision({
              mode: "mock",
              character,
              proposalText: trimmedProposal,
              category,
              situation: DEFAULT_SITUATION
            })
          )
        );
        setResult({
          decisions,
          source: "mock-fallback"
        });
        setErrorMessage(
          "Codex接続を利用できなかったため、同じ設定を使ってモックで再現しました。"
        );
      } else {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "判断の生成に失敗しました。"
        );
      }
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="decision-demo" aria-labelledby="decision-demo-title">
      <div className="decision-demo__intro">
        <span className="eyebrow">DECISION LAB</span>
        <h2 id="decision-demo-title">同じ提案、違うリアクション。</h2>
        <p>
          保存済みのプロフィールと個性を、Haru・Aoiへ同じ状況と一緒に渡して比較します。
        </p>
      </div>

      <div className="decision-demo__controls">
        <label>
          提案
          <textarea
            value={proposalText}
            maxLength={240}
            rows={2}
            onChange={(event) => setProposalText(event.target.value)}
          />
        </label>
        <div className="decision-demo__selectors">
          <label>
            提案カテゴリ
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as ProposalCategory)
              }
            >
              {proposalCategories.map((proposalCategory) => (
                <option key={proposalCategory} value={proposalCategory}>
                  {categoryLabels[proposalCategory]}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="mode-switch">
            <legend>実行モード</legend>
            <label>
              <input
                type="radio"
                name="mode"
                checked={mode === "mock"}
                onChange={() => setMode("mock")}
              />
              モック
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                checked={mode === "codex"}
                onChange={() => setMode("codex")}
              />
              Codex
            </label>
          </fieldset>
          <button
            className="button button--primary"
            type="button"
            disabled={isRunning}
            onClick={() => void decideForBoth()}
          >
            {isRunning ? "二人が考えています…" : "二人の判断を見る"}
          </button>
        </div>
        {errorMessage ? (
          <p className="notice notice--warning" role="status">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <DecisionResults result={result} settings={settings} />
    </section>
  );
};
