import {
  personalityKeys,
  personalityMetadata,
  type CharacterSettings
} from "../domain/characterSettings";

interface CharacterComparisonProps {
  settings: CharacterSettings;
}

export const CharacterComparison = ({
  settings
}: CharacterComparisonProps) => {
  const { haru, aoi } = settings.characters;

  return (
    <section className="comparison" aria-labelledby="comparison-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SIDE BY SIDE</span>
          <h2 id="comparison-title">二人の違いを見比べる</h2>
        </div>
        <p>
          同じ出来事でも、バーの差が大きい項目ほど判断や台詞に違いが表れます。
        </p>
      </div>

      <div className="comparison__header" aria-hidden="true">
        <strong className="character-name character-name--haru">
          {haru.profile.name}
        </strong>
        <span>個性</span>
        <strong className="character-name character-name--aoi">
          {aoi.profile.name}
        </strong>
      </div>

      <div className="comparison__rows">
        {personalityKeys.map((key) => {
          const haruValue = haru.personality[key];
          const aoiValue = aoi.personality[key];

          return (
            <div className="comparison-row" key={key}>
              <div className="comparison-bar comparison-bar--reverse">
                <span style={{ width: `${haruValue}%` }} />
                <output>{haruValue}</output>
              </div>
              <span className="comparison-row__label">
                {personalityMetadata[key].label}
              </span>
              <div className="comparison-bar">
                <span style={{ width: `${aoiValue}%` }} />
                <output>{aoiValue}</output>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
