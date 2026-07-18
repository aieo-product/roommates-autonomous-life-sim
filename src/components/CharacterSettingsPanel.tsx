import type { CSSProperties } from "react";
import {
  personalityKeys,
  type CharacterDefinition,
  type CharacterId
} from "../domain/characterSettings";
import { PersonalitySlider } from "./PersonalitySlider";
import { ProfileEditor } from "./ProfileEditor";

interface CharacterSettingsPanelProps {
  character: CharacterDefinition;
  accentColor: string;
  onChange: (character: CharacterDefinition) => void;
  onReset: (characterId: CharacterId) => void;
}

export const CharacterSettingsPanel = ({
  character,
  accentColor,
  onChange,
  onReset
}: CharacterSettingsPanelProps) => {
  function updateProfile(
    profile: CharacterDefinition["profile"]
  ): void {
    onChange({
      ...character,
      profile
    });
  }

  function updatePersonality(
    key: keyof CharacterDefinition["personality"],
    value: number
  ): void {
    onChange({
      ...character,
      personality: {
        ...character.personality,
        [key]: value
      }
    });
  }

  return (
    <section
      className={`character-editor character-editor--${character.id}`}
      aria-label={`${character.profile.name}の設定`}
    >
      <header className="character-editor__hero">
        <div
          className="character-avatar"
          style={{ "--accent": accentColor } as CSSProperties}
          aria-hidden="true"
        >
          <span>{character.profile.name.slice(0, 1)}</span>
        </div>
        <div>
          <span className="eyebrow">
            {character.id === "haru" ? "MALE CHARACTER" : "FEMALE CHARACTER"}
          </span>
          <h2>{character.profile.name}</h2>
          <p>{character.profile.introduction}</p>
        </div>
        <button
          className="button button--quiet character-editor__reset"
          type="button"
          onClick={() => onReset(character.id)}
        >
          初期設定へ戻す
        </button>
      </header>

      <details className="editor-section" open>
        <summary>
          <span>
            <strong>個性パラメータ</strong>
            <small>行動判断へ反映する10の傾向</small>
          </span>
        </summary>
        <div className="trait-grid">
          {personalityKeys.map((personalityKey) => (
            <PersonalitySlider
              key={personalityKey}
              personalityKey={personalityKey}
              value={character.personality[personalityKey]}
              accentColor={accentColor}
              onChange={(value) =>
                updatePersonality(personalityKey, value)
              }
            />
          ))}
        </div>
      </details>

      <details className="editor-section">
        <summary>
          <span>
            <strong>プロフィール</strong>
            <small>背景・生活習慣・話し方</small>
          </span>
        </summary>
        <ProfileEditor
          characterId={character.id}
          profile={character.profile}
          onChange={updateProfile}
        />
      </details>
    </section>
  );
};
