import { ResidentPortrait } from "../character-assets";
import { EvidenceLinks } from "./EvidenceLinks";
import type { ResultAgentReflection, ResultCharacterId, ResultStatus } from "./types";
import { useResultCharacterNames, useResultCharacterText } from "./character-names";

function ReflectionCard({
  person,
  reflection,
  status,
}: {
  person: ResultCharacterId;
  reflection?: ResultAgentReflection;
  status: ResultStatus;
}) {
  const characterNames = useResultCharacterNames();
  const displayText = useResultCharacterText();
  if (!reflection) {
    return (
      <article className={`result-reflection-card is-${person} is-missing`}>
        <header><ResidentPortrait person={person} className="result-character-avatar" /><h3>{characterNames[person]}</h3></header>
        <p aria-live="polite">
          {status === "generating" ? "7日間を振り返っています…" : "アフターインタビューを取得できませんでした。"}
        </p>
      </article>
    );
  }

  return (
    <article className={`result-reflection-card is-${person}`}>
      <header><ResidentPortrait person={person} className="result-character-avatar" /><h3>{characterNames[person]}</h3></header>
      <blockquote>「{displayText(reflection.seasonImpression)}」</blockquote>
      <dl>
        <div>
          <dt>いちばん印象に残った出来事</dt>
          <dd>
            {reflection.bestMomentEventLogId ? (
              <EvidenceLinks eventLogIds={[reflection.bestMomentEventLogId]} />
            ) : "ひとつには絞らなかった"}
          </dd>
        </div>
        <div>
          <dt>関係が変わったと感じた転機</dt>
          <dd>
            {reflection.turningPointEventLogId ? (
              <EvidenceLinks eventLogIds={[reflection.turningPointEventLogId]} />
            ) : "特定の転機は挙げなかった"}
          </dd>
        </div>
      </dl>
      <div className="result-producer-message">
        <strong>デコピンへ</strong>
        <p>「{displayText(reflection.messageToProducer)}」</p>
      </div>
    </article>
  );
}

export function Reflections({
  reflections,
  status,
}: {
  reflections: Partial<Record<ResultCharacterId, ResultAgentReflection>>;
  status: ResultStatus;
}) {
  return (
    <section className="result-reflections" aria-labelledby="result-reflections-title">
      <div className="result-section-heading">
        <p className="result-section-label">AFTER INTERVIEW</p>
        <h2 id="result-reflections-title">二人が振り返る、7日間</h2>
        <p>終了時点で本人が公開した感想です。非公開の思考や推測は含みません。</p>
      </div>
      <div className="result-reflection-grid">
        <ReflectionCard person="haru" reflection={reflections.haru} status={status} />
        <ReflectionCard person="aoi" reflection={reflections.aoi} status={status} />
      </div>
    </section>
  );
}
