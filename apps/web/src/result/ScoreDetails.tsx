import { EvidenceLinks } from "./EvidenceLinks";
import type {
  ResultCharacterId,
  ResultMetricKey,
  ResultProducer,
} from "./types";
import {
  AXIS_LABELS,
  CHARACTER_NAMES,
  METRIC_LABELS,
  STYLE_LABELS,
  clampPercent,
} from "./utils";

const METRIC_KEYS: ResultMetricKey[] = ["energy", "stress", "affection", "trust", "romanticAwareness"];

function EvidenceList({ items, empty }: { items: ResultProducer["topStrengths"]; empty: string }) {
  if (!items?.length) return <p className="result-missing-copy">{empty}</p>;
  return (
    <ol className="result-score-evidence-list">
      {items.slice(0, 3).map((item) => (
        <li key={item.id}>
          <span className={item.points >= 0 ? "is-positive" : "is-negative"}>
            {item.points >= 0 ? "+" : ""}{item.points}点
          </span>
          <p>{item.message}</p>
          <EvidenceLinks eventLogIds={item.eventLogIds} />
        </li>
      ))}
    </ol>
  );
}

function StatJourney({ producer }: { producer: ResultProducer }) {
  const journey = producer.statJourney;
  if (!journey) {
    return <p className="result-missing-copy">開始時と終了時の構造化スナップショットは取得できませんでした。</p>;
  }

  return (
    <div className="result-stat-journey">
      {(["haru", "aoi"] as ResultCharacterId[]).map((person) => {
        const start = journey.start.characters[person];
        const end = journey.end.characters[person];
        return (
          <section key={person}>
            <h4>{CHARACTER_NAMES[person]}</h4>
            {start && end ? (
              <dl>
                {METRIC_KEYS.map((metric) => {
                  const delta = end[metric] - start[metric];
                  return (
                    <div key={metric}>
                      <dt>{METRIC_LABELS[metric]}</dt>
                      <dd><span>{Math.round(start[metric])}</span><b aria-label="から">→</b><strong>{Math.round(end[metric])}</strong><small>（{delta > 0 ? "+" : ""}{Math.round(delta)}）</small></dd>
                    </div>
                  );
                })}
              </dl>
            ) : <p className="result-missing-copy">比較データなし</p>}
          </section>
        );
      })}
    </div>
  );
}

export function ScoreDetails({ producer }: { producer: ResultProducer }) {
  const coverage = typeof producer.coverage === "number"
    ? { ratio: producer.coverage, completeTurns: Math.round(producer.coverage * 28), expectedTurns: 28, missing: [] }
    : producer.coverage;

  return (
    <section className="result-score-details" aria-labelledby="result-score-title">
      <div className="result-section-heading result-score-heading">
        <div>
          <p className="result-section-label">PRODUCER SCORE</p>
          <h2 id="result-score-title">{Math.round(producer.overallScore)}点・ランク{producer.rank}</h2>
          <p>Producerタイプ：{STYLE_LABELS[producer.producerStyle] ?? producer.producerStyle}</p>
        </div>
        <div className="result-score-version">
          <span>採点ルール</span><strong>{producer.scoringVersion}</strong>
          {coverage && <small>データ充足率 {Math.round(coverage.ratio * 100)}%（{coverage.completeTurns}/{coverage.expectedTurns}フェーズ）</small>}
        </div>
      </div>

      <div className="result-axis-list">
        {producer.axes.map((axis) => (
          <article className="result-axis" key={axis.id}>
            <div className="result-axis-title">
              <h3>{AXIS_LABELS[axis.id]}</h3>
              <strong>{Math.round(axis.score)}<small> / {axis.maxScore}</small></strong>
            </div>
            <div
              className="result-axis-track"
              role="progressbar"
              aria-label={`${AXIS_LABELS[axis.id]} ${Math.round(axis.score)}点、${axis.maxScore}点満点`}
              aria-valuemin={0}
              aria-valuemax={axis.maxScore}
              aria-valuenow={Math.round(axis.score)}
            >
              <span style={{ width: `${clampPercent(axis.score, axis.maxScore)}%` }} />
            </div>
            <p>{axis.summary}</p>
          </article>
        ))}
      </div>

      <div className="result-evidence-columns">
        <section>
          <h3>よかったプロデュース</h3>
          <EvidenceList items={producer.topStrengths} empty="特定の加点根拠はありません。" />
        </section>
        <section>
          <h3>次の7日間へのヒント</h3>
          <EvidenceList items={producer.improvements} empty="特定の改善ポイントはありません。" />
        </section>
      </div>

      <section className="result-journey-section">
        <h3>二人の状態の旅</h3>
        <p>恋愛意識の増減は結末の記録であり、Producer Scoreへの直接加点ではありません。</p>
        <StatJourney producer={producer} />
      </section>

      {((coverage?.missing.length ?? 0) > 0 || (producer.warnings?.length ?? 0) > 0) && (
        <aside className="result-data-warning" aria-label="データ品質に関する注意">
          <h3>データ品質</h3>
          <ul>
            {coverage?.missing.map((message) => <li key={message}>{message}</li>)}
            {producer.warnings?.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </aside>
      )}
    </section>
  );
}
