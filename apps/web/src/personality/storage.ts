import {
  DEFAULT_CHARACTER_SETTINGS,
  characterSettingsSchema,
  type CharacterId,
  type CharacterSettings,
} from "@roommates/shared";
import { cloneCharacterSettings } from "./model";

export const CHARACTER_SETTINGS_STORAGE_KEY = "roommates.character-settings.v1";

export type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export type LoadedCharacterSettings = {
  settings: CharacterSettings;
  source: "preset" | "saved";
  warning?: string;
};

export function defaultCharacterSettings(): CharacterSettings {
  return cloneCharacterSettings(DEFAULT_CHARACTER_SETTINGS);
}

export function loadCharacterSettings(storage: SettingsStorage | null): LoadedCharacterSettings {
  if (!storage) return { settings: defaultCharacterSettings(), source: "preset" };

  try {
    const serialized = storage.getItem(CHARACTER_SETTINGS_STORAGE_KEY);
    if (!serialized) return { settings: defaultCharacterSettings(), source: "preset" };
    const result = characterSettingsSchema.safeParse(JSON.parse(serialized));
    if (!result.success) {
      return {
        settings: defaultCharacterSettings(),
        source: "preset",
        warning: "保存済み設定が正しくなかったため、初期設定を読み込みました。",
      };
    }
    return { settings: cloneCharacterSettings(result.data), source: "saved" };
  } catch {
    return {
      settings: defaultCharacterSettings(),
      source: "preset",
      warning: "保存済み設定を読み込めなかったため、初期設定を読み込みました。",
    };
  }
}

export function saveCharacterSettings(
  storage: SettingsStorage,
  candidate: CharacterSettings,
): CharacterSettings {
  const valid = characterSettingsSchema.parse(candidate);
  storage.setItem(CHARACTER_SETTINGS_STORAGE_KEY, JSON.stringify(valid));
  return cloneCharacterSettings(valid);
}

export function resetCharacterSetting(
  settings: CharacterSettings,
  characterId: CharacterId,
): CharacterSettings {
  const defaults = defaultCharacterSettings();
  return {
    ...cloneCharacterSettings(settings),
    characters: {
      ...structuredClone(settings.characters),
      [characterId]: defaults.characters[characterId],
    },
  };
}
