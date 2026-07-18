import {
  personalityMetadata,
  type PersonalityKey
} from "../domain/characterSettings";

interface PersonalitySliderProps {
  personalityKey: PersonalityKey;
  value: number;
  accentColor: string;
  onChange: (value: number) => void;
}

function getTendencyLabel(
  personalityKey: PersonalityKey,
  value: number
): string {
  const metadata = personalityMetadata[personalityKey];
  if (value <= 35) {
    return metadata.lowLabel;
  }
  if (value >= 65) {
    return metadata.highLabel;
  }
  return "バランス型";
}

export const PersonalitySlider = ({
  personalityKey,
  value,
  accentColor,
  onChange
}: PersonalitySliderProps) => {
  const metadata = personalityMetadata[personalityKey];

  return (
    <label className="trait-control">
      <span className="trait-control__heading">
        <span>
          <strong>{metadata.label}</strong>
          <small>{metadata.description}</small>
        </span>
        <output
          className="trait-control__value"
          style={{ color: accentColor }}
        >
          {value}
        </output>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={value}
        style={{ accentColor }}
        aria-label={metadata.label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="trait-control__scale">
        <span>{metadata.lowLabel}</span>
        <strong>{getTendencyLabel(personalityKey, value)}</strong>
        <span>{metadata.highLabel}</span>
      </span>
    </label>
  );
};
