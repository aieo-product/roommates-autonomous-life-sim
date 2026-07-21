import { useMemo, useState } from "react";
import {
  characterSettingsSchema,
  type CharacterId,
  type CharacterSettings,
} from "@roommates/shared";
import type { PersonalityCharacter } from "./model";
import { cloneCharacterSettings } from "./model";
import {
  defaultCharacterSettings,
  loadCharacterSettings,
  resetCharacterSetting,
  saveCharacterSettings,
} from "./storage";

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function validationMessage(candidate: CharacterSettings): string | undefined {
  const result = characterSettingsSchema.safeParse(candidate);
  if (result.success) return undefined;
  const issue = result.error.issues[0];
  if (!issue) return "入力内容を確認してください。";
  const field = issue.path.length ? issue.path.join(".") : "設定";
  return `${field}: ${issue.message}`;
}

export type CharacterSettingsController = {
  settings: CharacterSettings;
  savedSettings: CharacterSettings;
  isDirty: boolean;
  message?: string;
  error?: string;
  savedAt?: Date;
  updateCharacter: (id: CharacterId, character: PersonalityCharacter) => void;
  save: () => boolean;
  discard: () => void;
  resetCharacter: (id: CharacterId) => void;
  resetAll: () => void;
};

export function useCharacterSettings(): CharacterSettingsController {
  const [initial] = useState(() => loadCharacterSettings(browserStorage()));
  const [settings, setSettings] = useState(() => cloneCharacterSettings(initial.settings));
  const [savedSettings, setSavedSettings] = useState(() => cloneCharacterSettings(initial.settings));
  const [message, setMessage] = useState<string | undefined>(initial.warning);
  const [error, setError] = useState<string | undefined>();
  const [savedAt, setSavedAt] = useState<Date | undefined>();

  const isDirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [savedSettings, settings],
  );

  const updateCharacter = (id: CharacterId, character: PersonalityCharacter): void => {
    setSettings((current) => ({
      ...current,
      characters: { ...current.characters, [id]: character },
    }));
    setError(undefined);
    setMessage(undefined);
  };

  const persist = (candidate: CharacterSettings, successMessage: string): boolean => {
    const invalid = validationMessage(candidate);
    if (invalid) {
      setError(`保存できません。${invalid}`);
      setMessage(undefined);
      return false;
    }
    const storage = browserStorage();
    if (!storage) {
      setError("このブラウザでは設定を保存できません。");
      setMessage(undefined);
      return false;
    }
    try {
      const saved = saveCharacterSettings(storage, candidate);
      setSettings(cloneCharacterSettings(saved));
      setSavedSettings(cloneCharacterSettings(saved));
      setSavedAt(new Date());
      setMessage(successMessage);
      setError(undefined);
      return true;
    } catch {
      setError("設定を保存できませんでした。入力値とブラウザの保存領域を確認してください。");
      setMessage(undefined);
      return false;
    }
  };

  const save = (): boolean => persist(settings, "個性設定を保存しました。次のターンから反映されます。");

  const discard = (): void => {
    setSettings(cloneCharacterSettings(savedSettings));
    setError(undefined);
    setMessage("未保存の変更を取り消しました。");
  };

  const resetCharacter = (id: CharacterId): void => {
    const displayName = settings.characters[id].profile.name;
    setSettings((current) => resetCharacterSetting(current, id));
    setError(undefined);
    setMessage(`${displayName}を初期値へ戻しました。保存すると反映されます。`);
  };

  const resetAll = (): void => {
    setSettings(defaultCharacterSettings());
    setError(undefined);
    setMessage("二人の個性を初期値へ戻しました。保存すると反映されます。");
  };

  return {
    settings,
    savedSettings,
    isDirty,
    message,
    error,
    savedAt,
    updateCharacter,
    save,
    discard,
    resetCharacter,
    resetAll,
  };
}
