import { useState } from "react";
import {
  characterSettingsSchema,
  getDefaultCharacterSettings,
  type CharacterDefinition,
  type CharacterId,
  type CharacterSettings
} from "../domain/characterSettings";
import {
  loadCharacterSettings,
  resetCharacterToPreset,
  saveCharacterSettings
} from "../services/characterSettingsStorage";

interface UseCharacterSettingsResult {
  settings: CharacterSettings;
  savedSettings: CharacterSettings;
  errorMessage: string | null;
  savedAt: Date | null;
  updateCharacter: (
    characterId: CharacterId,
    character: CharacterDefinition
  ) => void;
  save: () => boolean;
  resetCharacter: (characterId: CharacterId) => void;
  resetAll: () => void;
}

function getBrowserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function getInitialSettings(): CharacterSettings {
  return loadCharacterSettings(getBrowserStorage()).settings;
}

function getValidationMessage(candidate: CharacterSettings): string {
  const result = characterSettingsSchema.safeParse(candidate);
  if (result.success) {
    return "";
  }

  const firstIssue = result.error.issues[0];
  if (!firstIssue) {
    return "入力内容を確認してください。";
  }

  return `保存できません: ${firstIssue.path.join(".")} ${firstIssue.message}`;
}

export function useCharacterSettings(): UseCharacterSettingsResult {
  const [settings, setSettings] = useState(getInitialSettings);
  const [savedSettings, setSavedSettings] = useState(getInitialSettings);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function updateCharacter(
    characterId: CharacterId,
    character: CharacterDefinition
  ): void {
    setSettings((currentSettings) => ({
      ...currentSettings,
      characters: {
        ...currentSettings.characters,
        [characterId]: character
      }
    }));
    setErrorMessage(null);
  }

  function persist(candidate: CharacterSettings): boolean {
    const validationMessage = getValidationMessage(candidate);
    if (validationMessage) {
      setErrorMessage(validationMessage);
      return false;
    }

    const storage = getBrowserStorage();
    if (!storage) {
      setErrorMessage("この環境では設定を保存できません。");
      return false;
    }

    try {
      const saved = saveCharacterSettings(storage, candidate);
      setSettings(saved);
      setSavedSettings(saved);
      setSavedAt(new Date());
      setErrorMessage(null);
      return true;
    } catch {
      setErrorMessage(
        "設定を保存できませんでした。ブラウザの保存領域を確認してください。"
      );
      return false;
    }
  }

  function save(): boolean {
    return persist(settings);
  }

  function resetCharacter(characterId: CharacterId): void {
    persist(resetCharacterToPreset(settings, characterId));
  }

  function resetAll(): void {
    persist(getDefaultCharacterSettings());
  }

  return {
    settings,
    savedSettings,
    errorMessage,
    savedAt,
    updateCharacter,
    save,
    resetCharacter,
    resetAll
  };
}
