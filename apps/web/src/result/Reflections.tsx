import { CharacterSprite } from "./CharacterSprite";
import { EvidenceLinks } from "./EvidenceLinks";
import type { ResultAgentReflection, ResultCharacterId, ResultStatus } from "./types";
import { CHARACTER_NAMES } from "./utils";

function ReflectionCard({
  person,
  reflection,
  status,
}: {
  person: ResultCharacterId;
  reflection?: ResultAgentReflection;
  status: ResultStatus;
}) {
  if (!reflection) {
    return (
      <article className={`result-reflection-card is-${person} is-missing`}>
        <h3>{CHARACTER_NAMES[person]}</h3>
        <p aria-live="polite">
          {status === "generating" ? "7日間を振り返っています…" : "アフターインタビューを取得できませんでした。"}
        </p>
      </article>
    );
  }

  return (
    <article className={`result-reflection-card is-${person}`}>
      <header>
        <div>
          <small>AFTER INTERVIEW</small>
          <h3>{CHARACTER_NAMES[person]}</h3>
        </div>
      </header>
      <div className={`result-reflection-scene is-${person}`} aria-label={`${CHARACTER_NAMES[person]}のアフターインタビュー`}>
        <CharacterSprite person={person} className="result-reflection-character" />
        <blockquote className="result-speech-bubble is-spoken">「{reflection.seasonImpression}」</blockquote>
      </div>
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
        <p>「{reflection.messageToProducer}」</p>
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
