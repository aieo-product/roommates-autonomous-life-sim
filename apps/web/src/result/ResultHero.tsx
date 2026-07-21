import { forwardRef } from "react";
import {
  navigatorCharacterAssets,
  residentCharacterAssets,
} from "../character-assets";
import { useManagedCharacterAsset } from "../assets-manager/index.js";
import type {
  ResultEnding,
  ResultProducer,
  ResultRelationshipLabel,
  ResultStatus,
} from "./types";
import { useResultCharacterNames, useResultCharacterText } from "./character-names";
import { RELATIONSHIP_LABELS, STYLE_LABELS } from "./utils";

type ResultHeroProps = {
  ending: ResultEnding;
  producer: ResultProducer;
  relationshipLabel: ResultRelationshipLabel;
  status: ResultStatus;
};

const STATUS_LABELS: Record<ResultStatus, string> = {
  generating: "総集編を編集中",
  ready: "総集編が完成",
  partial: "取得できた記録を表示中",
};

export const ResultHero = forwardRef<HTMLHeadingElement, ResultHeroProps>(
  function ResultHero({ ending, producer, relationshipLabel, status }, ref) {
    const styleLabel = STYLE_LABELS[producer.producerStyle] ?? producer.producerStyle;
    const managedHaru = useManagedCharacterAsset("haru");
    const managedAoi = useManagedCharacterAsset("aoi");
    const managedNavigator = useManagedCharacterAsset("navigator");
    const characterNames = useResultCharacterNames();
    const displayText = useResultCharacterText();

    return (
      <header className={`result-hero result-rank-${producer.rank.toLowerCase()}`}>
        <div className="result-hero-kicker">
          <span>ROOMMATES・7 DAYS</span>
          <span className={`result-status-badge is-${status}`}>{STATUS_LABELS[status]}</span>
        </div>
        <div className="result-hero-grid">
          <div className="result-ending-copy">
            <p className="result-section-label">二人が選んだ結末</p>
            <h1 ref={ref} tabIndex={-1}>{displayText(ending.title)}</h1>
            <p className="result-ending-narration">{displayText(ending.narration)}</p>
            <p className="result-relationship">
              最後の関係 <strong>{RELATIONSHIP_LABELS[relationshipLabel]}</strong>
            </p>
            <div className="result-resident-pair" role="img" aria-label={`${characterNames.haru}と${characterNames.aoi}`}>
              <span className="is-haru">
                <img src={managedHaru?.portraitUrl ?? residentCharacterAssets.haru.resultUrl} alt="" />
                <small>{characterNames.haru}</small>
              </span>
              <span className="is-aoi">
                <img src={managedAoi?.portraitUrl ?? residentCharacterAssets.aoi.resultUrl} alt="" />
                <small>{characterNames.aoi}</small>
              </span>
            </div>
          </div>

          <aside className="result-score-stamp" aria-label={`デコピンのサポート評価 ${producer.overallScore}点、ランク${producer.rank}`}>
            <div className="result-stamp-heading">
              <span>DEKOPIN SCORE</span>
              <span className="result-score-dekopin" aria-hidden="true">
                <img src={managedNavigator?.portraitUrl ?? navigatorCharacterAssets.portraitUrl} alt="" />
              </span>
            </div>
            <div className="result-rank-line">
              <strong aria-label={`ランク ${producer.rank}`}>{producer.rank}</strong>
              <b><em>{Math.round(producer.overallScore)}</em><small>/ 100</small></b>
            </div>
            <p>あなたは「{styleLabel}」</p>
          </aside>
        </div>
        <p className="result-separation-note">
          二人の結末とデコピンのサポート評価は別のものです。この点数は恋愛の成立ではなく、二人の主体性と安全を守りながら7日間を支えた過程を評価しています。
        </p>
      </header>
    );
  },
);
