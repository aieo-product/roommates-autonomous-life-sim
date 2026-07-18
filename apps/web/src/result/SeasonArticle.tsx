import { EvidenceLinks } from "./EvidenceLinks";
import type { ResultDailyNarrative, ResultNarrative, ResultStatus } from "./types";

const paragraphsFrom = (
  value: ResultNarrative["lead"] | ResultNarrative["closing"] | undefined,
) => {
  if (!value) return [];
  return typeof value === "string"
    ? [{ text: value, sourceEventLogIds: [] }]
    : value;
};

const sectionParagraphs = (section: ResultDailyNarrative) =>
  section.paragraphs?.length
    ? section.paragraphs
    : section.body
      ? [{ text: section.body, sourceEventLogIds: section.sourceEventLogIds ?? [] }]
      : [];

export function SeasonArticle({
  narrative,
  status,
}: {
  narrative?: ResultNarrative;
  status: ResultStatus;
}) {
  if (!narrative) {
    return (
      <section className="result-article result-empty-panel" aria-live="polite" aria-busy={status === "generating"}>
        <p className="result-section-label">7日間のシーズン総集編</p>
        <h2>{status === "generating" ? "いま、28の記録を7つの章に編んでいます" : "総集編を取得できませんでした"}</h2>
        <p>
          {status === "generating"
            ? "スコアと全イベントログは先に確認できます。記事が完成すると、この場所にDay 1からDay 7まで表示されます。"
            : "推測で記事を補わず、詳細データタブの保存済みログを表示しています。"}
        </p>
        {status === "generating" && <span className="result-loading-line" aria-hidden="true" />}
      </section>
    );
  }

  const sectionsByDay = new Map(narrative.daySections.map((section) => [section.day, section]));

  return (
    <article className="result-article">
      <header className="result-article-header">
        <p className="result-section-label">7日間のシーズン総集編</p>
        <h2>{narrative.headline}</h2>
        <div className="result-article-lead">
          {paragraphsFrom(narrative.lead).map((paragraph, index) => (
            <p key={`${paragraph.text}-${index}`}>
              {paragraph.text} <EvidenceLinks eventLogIds={paragraph.sourceEventLogIds} />
            </p>
          ))}
        </div>
      </header>

      <div className="result-day-chapters">
        {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => {
          const section = sectionsByDay.get(day);
          return (
            <section className="result-day-chapter" key={day} aria-labelledby={`result-day-${day}-title`}>
              <div className="result-day-marker" aria-hidden="true"><span>DAY</span><strong>{day}</strong></div>
              <div>
                <h3 id={`result-day-${day}-title`}>{section?.title ?? `Day ${day}の記録`}</h3>
                {section ? sectionParagraphs(section).map((paragraph, index) => (
                  <p key={`${day}-${index}`}>
                    {paragraph.text} <EvidenceLinks eventLogIds={paragraph.sourceEventLogIds} />
                  </p>
                )) : (
                  <p className="result-missing-copy">この日の記事データはありません。詳細ログで記録を確認できます。</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {paragraphsFrom(narrative.closing).length > 0 && (
        <footer className="result-article-closing">
          {paragraphsFrom(narrative.closing).map((paragraph, index) => (
            <p key={`${paragraph.text}-${index}`}>
              {paragraph.text} <EvidenceLinks eventLogIds={paragraph.sourceEventLogIds} />
            </p>
          ))}
        </footer>
      )}
    </article>
  );
}
