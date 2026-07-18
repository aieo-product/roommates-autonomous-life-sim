import { EvidenceLinks } from "./EvidenceLinks";
import type {
  ResultAgentReflection,
  ResultCharacterId,
  ResultEventLogEntry,
  ResultHighlight,
  ResultMetricKey,
  ResultProducer,
  ResultStatus,
} from "./types";
import {
  CHARACTER_NAMES,
  DECISION_LABELS,
  METRIC_LABELS,
  decisionFor,
  formatEventLocation,
  metricDeltaLabel,
  selectedEventTitleFor,
  suggestionFor,
} from "./utils";

const HIGHLIGHT_KIND_LABELS: Record<string, string> = {
  relationship_turn: "関係が動いた瞬間",
  self_initiated: "二人から生まれた出来事",
  respected_no: "大切にされたNO",
  conflict_repaired: "すれ違いを越えた流れ",
  quiet_moment: "静かな転機",
  important_memory: "忘れられない記憶",
};

const METRIC_KEYS: ResultMetricKey[] = ["energy", "stress", "affection", "trust", "romanticAwareness"];

function normalizedHighlights(producer: ResultProducer, events: ResultEventLogEntry[]): ResultHighlight[] {
  if (producer.highlights?.length) return producer.highlights.slice(0, 4);
  return (producer.highlightEventLogIds ?? []).slice(0, 4).map((eventId, index) => {
    const event = events.find((item) => item.id === eventId);
    return {
      id: `highlight-${index + 1}`,
      kind: "important_memory",
      headline: event?.eventTitle ?? `注目イベント ${index + 1}`,
      reason: "7日間を代表する記録として選ばれました。",
      eventLogIds: [eventId],
    };
  });
}

function deltasFor(event: ResultEventLogEntry, person: ResultCharacterId) {
  const applied = event.appliedEffects?.[person];
  if (applied) return applied;

  const before = event.before?.characters[person] ?? event.statesBefore?.[person];
  const after = event.after?.characters[person] ?? event.statesAfter?.[person];
  if (!before || !after) return undefined;

  return Object.fromEntries(
    METRIC_KEYS.map((key) => [key, after[key] - before[key]]).filter(([, value]) => value !== 0),
  ) as Partial<Record<ResultMetricKey, number>>;
}

function AgentMoment({
  person,
  event,
  reflection,
  status,
}: {
  person: ResultCharacterId;
  event: ResultEventLogEntry;
  reflection?: ResultAgentReflection;
  status: ResultStatus;
}) {
  const decision = decisionFor(event, person);
  const comment = reflection?.notableEventComments.find((item) => item.eventLogId === event.id)?.comment;
  const delta = deltasFor(event, person);
  const deltaEntries = Object.entries(delta ?? {}) as Array<[ResultMetricKey, number]>;

  return (
    <div className={`result-agent-moment is-${person}`}>
      <h4><span aria-hidden="true">{person === "haru" ? "H" : "A"}</span>{CHARACTER_NAMES[person]}</h4>
      {decision ? (
        <>
          <p className="result-decision-kind">{DECISION_LABELS[decision.decision]}</p>
          <p>{decision.action}</p>
          {decision.dialogue && <blockquote>「{decision.dialogue}」</blockquote>}
          {decision.publicReason && <p className="result-public-reason">当時の理由：{decision.publicReason}</p>}
        </>
      ) : (
        <p className="result-missing-copy">公開された選択の記録がありません。</p>
      )}

      {deltaEntries.length > 0 && (
        <dl className="result-inline-deltas" aria-label={`${CHARACTER_NAMES[person]}の実際の状態変化`}>
          {deltaEntries.map(([key, value]) => (
            <div key={key}><dt>{METRIC_LABELS[key]}</dt><dd>{metricDeltaLabel(value)}</dd></div>
          ))}
        </dl>
      )}

      <div className="result-agent-comment">
        <strong>7日後の振り返り</strong>
        {comment ? (
          <p>「{comment}」</p>
        ) : status === "generating" ? (
          <p aria-live="polite">感想を聞いています…</p>
        ) : decision?.publicReason ? (
          <p>振り返りは取得できませんでした。当時の公開反応：「{decision.publicReason}」</p>
        ) : (
          <p>振り返りコメントは取得できませんでした。</p>
        )}
      </div>
    </div>
  );
}

function EventOutcome({ event }: { event: ResultEventLogEntry }) {
  const addedConflicts = event.conflictUpdate?.added?.map((item) => item.summary ?? item.id)
    ?? event.conflictUpdate?.add
    ?? [];
  const resolvedConflicts = event.conflictUpdate?.resolvedIds
    ?? event.conflictUpdate?.resolve
    ?? [];

  return (
    <div className="result-highlight-outcome">
      <p className="result-highlight-proposal"><strong>デコピンへの指示</strong>{suggestionFor(event)}</p>
      {event.navigatorMessage && <p><strong>デコピンの応答</strong>{event.navigatorMessage}</p>}
      <p><strong>実際に起きたこと</strong>{selectedEventTitleFor(event)} — {event.narration}</p>
      {event.memory && (
        <p><strong>残った記憶</strong>{event.memory.title}{event.memory.summary ? ` — ${event.memory.summary}` : ""}</p>
      )}
      {!event.memory && event.memoryId && <p><strong>残った記憶</strong>記憶ID: {event.memoryId}</p>}
      {addedConflicts.length > 0 && <p><strong>生まれた対立</strong>{addedConflicts.join("、")}</p>}
      {resolvedConflicts.length > 0 && <p><strong>解消した対立</strong>{resolvedConflicts.join("、")}</p>}
    </div>
  );
}

export function Highlights({
  producer,
  events,
  reflections,
  status,
}: {
  producer: ResultProducer;
  events: ResultEventLogEntry[];
  reflections: Partial<Record<ResultCharacterId, ResultAgentReflection>>;
  status: ResultStatus;
}) {
  const highlights = normalizedHighlights(producer, events);

  return (
    <section className="result-highlights" aria-labelledby="result-highlights-title">
      <div className="result-section-heading">
        <p className="result-section-label">HIGHLIGHTS</p>
        <h2 id="result-highlights-title">この7日間の注目イベント</h2>
        <p>スコアの高さだけでなく、関係の転機、二人の自発性、大切にされたNOを含めて最大4件を選んでいます。</p>
      </div>

      {highlights.length === 0 ? (
        <div className="result-empty-card" aria-live="polite">
          {status === "generating" ? "注目イベントを選んでいます…" : "注目イベントの選出データがありません。"}
        </div>
      ) : (
        <div className="result-highlight-list">
          {highlights.map((highlight, index) => {
            const relatedEvents = highlight.eventLogIds
              .map((id) => events.find((event) => event.id === id))
              .filter((event): event is ResultEventLogEntry => Boolean(event));
            const primary = relatedEvents[0];

            return (
              <article className="result-highlight-card" key={highlight.id}>
                <header>
                  <span className="result-highlight-number">0{index + 1}</span>
                  <div>
                    <p>{HIGHLIGHT_KIND_LABELS[highlight.kind] ?? "注目イベント"}</p>
                    <h3>{highlight.headline}</h3>
                    {primary && <span>{formatEventLocation(primary)}・{primary.eventTitle}</span>}
                  </div>
                </header>
                <p className="result-highlight-reason"><strong>選出理由</strong>{highlight.reason} <EvidenceLinks eventLogIds={highlight.eventLogIds} /></p>

                {primary ? (
                  <>
                    <EventOutcome event={primary} />
                    <div className="result-agent-moments">
                      <AgentMoment person="haru" event={primary} reflection={reflections.haru} status={status} />
                      <AgentMoment person="aoi" event={primary} reflection={reflections.aoi} status={status} />
                    </div>
                    {relatedEvents.length > 1 && (
                      <p className="result-related-events">
                        この流れに含まれる記録：{relatedEvents.map((event) => `${formatEventLocation(event)}「${event.eventTitle}」`).join(" → ")}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="result-missing-copy">参照された元ログを取得できませんでした。</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
