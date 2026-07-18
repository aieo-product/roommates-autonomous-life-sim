import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Highlights } from "./Highlights";
import { Reflections } from "./Reflections";
import { ResultHero } from "./ResultHero";
import { ScoreDetails } from "./ScoreDetails";
import { SeasonArticle } from "./SeasonArticle";
import { Timeline } from "./Timeline";
import type { ResultEnding, ResultEventLogEntry, ResultScreenProps } from "./types";
import "./result.css";

type ResultTab = "recap" | "data";
type ResultScreenViewProps = ResultScreenProps & {
  renderEventCapture?: (event: ResultEventLogEntry) => ReactNode;
};

const TABS: Array<{ id: ResultTab; label: string; description: string }> = [
  { id: "recap", label: "7日間の総集編", description: "記事、注目イベント、二人の感想" },
  { id: "data", label: "評価と全ログ", description: "5軸スコア、根拠、28フェーズ" },
];

const endingFromLegacy = (ending: ResultScreenProps["game"]["ending"]): ResultEnding => {
  if (typeof ending === "object" && ending) return ending;
  return {
    kind: "roommates",
    title: "7日間、おつかれさまでした",
    narration: typeof ending === "string" ? ending : "二人の結末は保存されました。",
  };
};

function ResultWaiting({
  game,
  titleRef,
}: Pick<ResultScreenProps, "game"> & { titleRef: RefObject<HTMLHeadingElement | null> }) {
  const ending = endingFromLegacy(game.ending);
  return (
    <main className="result-screen result-waiting-screen" aria-busy="true">
      <section aria-live="polite">
        <p className="result-section-label">ROOMMATES・7 DAYS</p>
        <h1 ref={titleRef} tabIndex={-1}>{ending.title}</h1>
        <p>{ending.narration}</p>
        <div className="result-waiting-card">
          <strong>リザルトを準備しています</strong>
          <p>Endingとイベントログは保存済みです。デコピンのサポート評価と総集編の到着を待っています。</p>
          <span className="result-loading-line" aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}

export function ResultScreen({
  game,
  onRestartSameSeed,
  onRestartNewSeed,
  renderEventCapture,
}: ResultScreenViewProps) {
  const result = game.result;
  const [activeTab, setActiveTab] = useState<ResultTab>("recap");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const instanceId = useId().replace(/:/g, "");

  const hasResult = Boolean(result);

  useEffect(() => {
    titleRef.current?.focus();
  }, [hasResult]);

  if (!result) return <ResultWaiting game={game} titleRef={titleRef} />;

  const reflections = result.reflections ?? {};

  const selectTab = (tab: ResultTab, focus = false) => {
    setActiveTab(tab);
    if (focus) {
      const index = TABS.findIndex((item) => item.id === tab);
      requestAnimationFrame(() => tabRefs.current[index]?.focus());
    }
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let targetIndex: number | undefined;
    if (event.key === "ArrowRight") targetIndex = (index + 1) % TABS.length;
    if (event.key === "ArrowLeft") targetIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") targetIndex = 0;
    if (event.key === "End") targetIndex = TABS.length - 1;
    if (targetIndex === undefined) return;
    event.preventDefault();
    selectTab(TABS[targetIndex].id, true);
  };

  const onEvidenceClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>('a[href^="#result-event-"]');
    if (!link) return;

    event.preventDefault();
    const anchorId = link.hash.slice(1);
    setActiveTab("data");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const targetEvent = document.getElementById(anchorId);
      if (targetEvent instanceof HTMLDetailsElement) targetEvent.open = true;
      targetEvent?.scrollIntoView({ behavior: "smooth", block: "center" });
      targetEvent?.focus({ preventScroll: true });
      window.history.replaceState(null, "", `#${anchorId}`);
    }));
  };

  const confirmRestart = (action: (() => void | Promise<void>) | undefined) => {
    if (!action) return;
    const accepted = window.confirm("現在のリザルト表示を終了します。このrunをあとから見返せなくなります。続けますか？");
    if (accepted) void action();
  };

  return (
    <main className="result-screen" onClickCapture={onEvidenceClick}>
      <a className="result-skip-link" href={`#result-${instanceId}-tabs`}>総集編の本文へ移動</a>
      <ResultHero
        ref={titleRef}
        ending={result.ending}
        producer={result.producer}
        relationshipLabel={game.shared.relationshipLabel}
        status={result.status}
      />

      <div className="result-status-region" aria-live="polite" aria-atomic="true">
        {result.status === "generating" && (
          <p className="result-generation-notice"><strong>記事と二人の感想を生成中です。</strong> スコアと全ログは先に確認できます。</p>
        )}
        {result.status === "partial" && (
          <div className="result-partial-notice" role="status">
            <strong>一部のコンテンツを取得できませんでした。</strong>
            <p>取得できた事実だけを表示しています。欠けた感想や記事を推測で補ってはいません。</p>
            {result.failures && result.failures.length > 0 && (
              <ul>{result.failures.map((failure, index) => <li key={`${failure.component}-${index}`}>{failure.component}：{failure.reason}</li>)}</ul>
            )}
          </div>
        )}
      </div>

      <div className="result-tabs-shell" id={`result-${instanceId}-tabs`}>
        <div className="result-tabs" role="tablist" aria-label="リザルトの表示内容">
          {TABS.map((tab, index) => (
            <button
              type="button"
              role="tab"
              id={`result-${instanceId}-tab-${tab.id}`}
              aria-controls={`result-${instanceId}-panel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              ref={(element) => { tabRefs.current[index] = element; }}
              key={tab.id}
            >
              <strong>{tab.label}</strong><small>{tab.description}</small>
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`result-${instanceId}-panel-recap`}
          aria-labelledby={`result-${instanceId}-tab-recap`}
          tabIndex={0}
          hidden={activeTab !== "recap"}
          className="result-tab-panel"
        >
          <SeasonArticle narrative={result.narrative} status={result.status} />
          <Highlights
            producer={result.producer}
            events={game.eventLog}
            reflections={reflections}
            status={result.status}
            renderEventCapture={renderEventCapture}
          />
          <Reflections reflections={reflections} status={result.status} />
        </div>

        <div
          role="tabpanel"
          id={`result-${instanceId}-panel-data`}
          aria-labelledby={`result-${instanceId}-tab-data`}
          tabIndex={0}
          hidden={activeTab !== "data"}
          className="result-tab-panel"
        >
          <ScoreDetails producer={result.producer} />
          <Timeline events={game.eventLog} />
        </div>
      </div>

      <footer className="result-actions">
        <div>
          <p className="result-section-label">NEXT SEASON</p>
          <h2>もう一度、7日間を見守りますか？</h2>
          <p>リスタートすると、現在のリザルトはこの画面から見返せなくなります。</p>
        </div>
        <div>
          <button type="button" onClick={() => confirmRestart(onRestartSameSeed)} disabled={!onRestartSameSeed}>同じseedでもう一度</button>
          <button type="button" className="is-primary" onClick={() => confirmRestart(onRestartNewSeed)} disabled={!onRestartNewSeed}>新しいseedで始める</button>
        </div>
      </footer>
    </main>
  );
}
