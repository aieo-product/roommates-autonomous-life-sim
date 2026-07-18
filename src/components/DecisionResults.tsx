import type { CharacterSettings } from "../domain/characterSettings";
import type { CharacterDecision } from "../services/characterAgent";

export interface DecisionResult {
  decisions: CharacterDecision[];
  source: "codex" | "mock" | "mock-fallback";
}

interface DecisionResultsProps {
  result: DecisionResult | null;
  settings: CharacterSettings;
}

const decisionLabels: Record<CharacterDecision["decision"], string> = {
  ACCEPT: "受け入れる",
  DECLINE: "断る",
  MODIFY: "形を変える",
  IGNORE: "今は反応しない",
  INITIATE: "自分から始める"
};

function getSourceLabel(source: DecisionResult["source"]): string {
  if (source === "codex") {
    return "CODEX APP SERVER";
  }
  if (source === "mock-fallback") {
    return "MOCK FALLBACK";
  }
  return "MOCK AGENT";
}

export const DecisionResults = ({
  result,
  settings
}: DecisionResultsProps) => {
  if (!result) {
    return (
      <div className="decision-results decision-results--empty">
        保存後に実行すると、二人の判断がここへ並びます。
      </div>
    );
  }

  return (
    <div className="decision-results">
      <div className="decision-results__mode">
        {getSourceLabel(result.source)}
      </div>
      {result.decisions.map((decision) => (
        <article
          className={`decision-card decision-card--${decision.characterId}`}
          key={decision.characterId}
        >
          <header>
            <strong>
              {settings.characters[decision.characterId].profile.name}
            </strong>
            <span>{decisionLabels[decision.decision]}</span>
          </header>
          <blockquote>{decision.dialogue}</blockquote>
          <dl>
            <div>
              <dt>理由</dt>
              <dd>{decision.reason}</dd>
            </div>
            <div>
              <dt>現在の目的</dt>
              <dd>{decision.currentGoal}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
};
