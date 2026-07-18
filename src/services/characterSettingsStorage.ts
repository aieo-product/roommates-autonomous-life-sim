import {
  characterSettingsSchema,
  getDefaultCharacterSettings,
  type CharacterId,
  type CharacterSettings
} from "../domain/characterSettings";

export const CHARACTER_SETTINGS_STORAGE_KEY =
  "roommates.character-settings.v1";

export interface CharacterSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LoadCharacterSettingsResult {
  settings: CharacterSettings;
  source: "preset" | "saved";
}

export function loadCharacterSettings(
  storage: CharacterSettingsStorage | null
): LoadCharacterSettingsResult {
  if (!storage) {
    return {
      settings: getDefaultCharacterSettings(),
      source: "preset"
    };
  }

  try {
    const storedValue = storage.getItem(CHARACTER_SETTINGS_STORAGE_KEY);
    if (!storedValue) {
      return {
        settings: getDefaultCharacterSettings(),
        source: "preset"
      };
    }

    const parsedSettings = characterSettingsSchema.safeParse(
      JSON.parse(storedValue)
    );

    if (!parsedSettings.success) {
      return {
        settings: getDefaultCharacterSettings(),
        source: "preset"
      };
    }

    return {
      settings: parsedSettings.data,
      source: "saved"
    };
  } catch {
    return {
      settings: getDefaultCharacterSettings(),
      source: "preset"
    };
  }
}

export function saveCharacterSettings(
  storage: CharacterSettingsStorage,
  candidate: CharacterSettings
): CharacterSettings {
  const settings = characterSettingsSchema.parse(candidate);
  storage.setItem(
    CHARACTER_SETTINGS_STORAGE_KEY,
    JSON.stringify(settings)
  );
  return settings;
}

export function resetCharacterToPreset(
  currentSettings: CharacterSettings,
  characterId: CharacterId
): CharacterSettings {
  const defaults = getDefaultCharacterSettings();
  const candidate = {
    ...currentSettings,
    characters: {
      ...currentSettings.characters,
      [characterId]: defaults.characters[characterId]
    }
  };

  return characterSettingsSchema.parse(candidate);
}
