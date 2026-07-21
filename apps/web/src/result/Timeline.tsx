import { ResidentPortrait } from "../character-assets";
import type {
  ResultCharacterId,
  ResultEventLogEntry,
  ResultMetricKey,
} from "./types";
import { RESULT_PHASES } from "./types";
import { useResultCharacterNames, useResultCharacterText } from "./character-names";
import {
  DECISION_LABELS,
  METRIC_LABELS,
  PHASE_LABELS,
  RELATIONSHIP_LABELS,
  decisionFor,
  eventAnchorId,
  metricDeltaLabel,
  safetyFlagsFor,
  suggestionFor,
} from "./utils";

const METRIC_KEYS: ResultMetricKey[] = ["energy", "stress", "affection", "trust", "romanticAwareness"];

function EventDecision({ person, event }: { person: ResultCharacterId; event: ResultEventLogEntry }) {
  const characterNames = useResultCharacterNames();
  const displayText = useResultCharacterText();
  const decision = decisionFor(event, person);
  if (!decision) return <p className="result-character-heading"><strong><ResidentPortrait person={person} className="result-character-avatar is-compact" />{characterNames[person]}</strong> 選択データなし</p>;
  return (
    <div className={`result-timeline-decision is-${person}`}>
      <p><strong><ResidentPortrait person={person} className="result-character-avatar is-compact" />{characterNames[person]}</strong><span>{DECISION_LABELS[decision.decision]}</span></p>
      <p>{displayText(decision.action, event.characterRoster)}</p>
      {decision.dialogue && <blockquote>「{displayText(decision.dialogue, event.characterRoster)}」</blockquote>}
      {decision.publicReason && <small>公開理由：{displayText(decision.publicReason, event.characterRoster)}</small>}
    </div>
  );
}

function EventDeltas({ event }: { event: ResultEventLogEntry }) {
  const characterNames = useResultCharacterNames();
  if (!event.appliedEffects) return null;
  return (
    <div className="result-timeline-deltas">
      {(["haru", "aoi"] as ResultCharacterId[]).map((person) => {
        const entries = METRIC_KEYS
          .map((metric) => [metric, event.appliedEffects?.[person]?.[metric]] as const)
          .filter((entry): entry is readonly [ResultMetricKey, number] => typeof entry[1] === "number" && entry[1] !== 0);
        return entries.length > 0 ? (
          <p key={person}><strong>{characterNames[person]}の実変化</strong>{entries.map(([metric, value]) => `${METRIC_LABELS[metric]} ${metricDeltaLabel(value)}`).join("、")}</p>
        ) : null;
      })}
    </div>
  );
}

function TimelineEvent({ event }: { event: ResultEventLogEntry }) {
  const characterNames = useResultCharacterNames();
  const displayText = useResultCharacterText();
  const flags = safetyFlagsFor(event);
  const relationshipChanged = event.relationshipBefore && event.relationshipAfter && event.relationshipBefore !== event.relationshipAfter;
  const conflictsAdded = event.conflictUpdate?.added?.map((item) => item.summary ?? item.id) ?? event.conflictUpdate?.add ?? [];
  const conflictsResolved = event.conflictUpdate?.resolvedIds ?? event.conflictUpdate?.resolve ?? [];

  return (
    <details className="result-timeline-event" id={eventAnchorId(event.id)} tabIndex={-1}>
      <summary>
        <span className="result-timeline-phase">{PHASE_LABELS[event.phase]}</span>
        <strong>{displayText(event.eventTitle, event.characterRoster)}</strong>
        <span className="result-timeline-choice-summary">
          {(["haru", "aoi"] as ResultCharacterId[]).map((person) => {
            const decision = decisionFor(event, person);
            return <small key={person}>{characterNames[person]}：{decision ? DECISION_LABELS[decision.decision] : "記録なし"}</small>;
          })}
        </span>
      </summary>
      <div className="result-timeline-event-body">
        <p><strong>デコピンへの指示</strong>{suggestionFor(event)}</p>
        {event.navigatorMessage && <p><strong>デコピンの応答</strong>{displayText(event.navigatorMessage, event.characterRoster)}</p>}
        <p><strong>出来事</strong>{displayText(event.narration, event.characterRoster)}</p>
        <div className="result-timeline-decisions">
          <EventDecision person="haru" event={event} />
          <EventDecision person="aoi" event={event} />
        </div>
        <EventDeltas event={event} />
        <dl className="result-timeline-meta">
          {event.resolutionBranch && <div><dt>成立した分岐</dt><dd>{event.resolutionBranch}</dd></div>}
          {flags.length > 0 && <div><dt>安全フラグ</dt><dd>{flags.join("、")}</dd></div>}
          {event.cueResolution?.outcome && <div><dt>提案の扱い</dt><dd>{displayText(event.cueResolution.outcome, event.characterRoster)}{event.cueResolution.lock?.reason ? `（${displayText(event.cueResolution.lock.reason, event.characterRoster)}）` : ""}</dd></div>}
          {relationshipChanged && <div><dt>関係の変化</dt><dd>{RELATIONSHIP_LABELS[event.relationshipBefore!]} → {RELATIONSHIP_LABELS[event.relationshipAfter!]}</dd></div>}
          {(event.memory?.title || event.memoryId) && <div><dt>記憶</dt><dd>{displayText(event.memory?.title ?? event.memoryId, event.characterRoster)}</dd></div>}
          {conflictsAdded.length > 0 && <div><dt>生まれた対立</dt><dd>{displayText(conflictsAdded.join("、"), event.characterRoster)}</dd></div>}
          {conflictsResolved.length > 0 && <div><dt>解消した対立</dt><dd>{displayText(conflictsResolved.join("、"), event.characterRoster)}</dd></div>}
        </dl>
      </div>
    </details>
  );
}

export function Timeline({ events }: { events: ResultEventLogEntry[] }) {
  return (
    <section className="result-timeline" aria-labelledby="result-timeline-title">
      <div className="result-section-heading">
        <p className="result-section-label">ALL 28 PHASES</p>
        <h2 id="result-timeline-title">7日間の全イベントログ</h2>
        <p>朝・昼・夕方・夜の28フェーズです。各行を開くと、二人の公開された選択と実際の結果を確認できます。</p>
      </div>

      <div className="result-timeline-days">
        {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => (
          <section className="result-timeline-day" key={day} aria-labelledby={`result-timeline-day-${day}`}>
            <h3 id={`result-timeline-day-${day}`}><span>DAY</span>{day}</h3>
            <div>
              {RESULT_PHASES.map((phase) => {
                const entries = events.filter((event) => event.day === day && event.phase === phase);
                if (entries.length === 0) {
                  return (
                    <div className="result-timeline-missing" key={phase}>
                      <span>{PHASE_LABELS[phase]}</span><p>このフェーズの構造化ログがありません</p>
                    </div>
                  );
                }
                return entries.map((event) => <TimelineEvent event={event} key={event.id} />);
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
