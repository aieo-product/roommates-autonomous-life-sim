import { describe, expect, it } from "vitest";
import {
  characterSettingsSchema,
  getDefaultCharacterSettings
} from "../src/domain/characterSettings";
import {
  CHARACTER_SETTINGS_STORAGE_KEY,
  loadCharacterSettings,
  resetCharacterToPreset,
  saveCharacterSettings,
  type CharacterSettingsStorage
} from "../src/services/characterSettingsStorage";

function createStorage(): CharacterSettingsStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}

describe("character settings", () => {
  it("provides valid and contrasting presets", () => {
    const settings = getDefaultCharacterSettings();

    expect(characterSettingsSchema.safeParse(settings).success).toBe(true);
    expect(
      settings.characters.aoi.personality.initiative
    ).toBeGreaterThan(settings.characters.haru.personality.initiative);
    expect(
      settings.characters.haru.personality.romanticCaution
    ).toBeGreaterThan(
      settings.characters.aoi.personality.romanticCaution
    );
  });

  it("rejects personality values outside 0 to 100", () => {
    const settings = getDefaultCharacterSettings();
    settings.characters.haru.personality.sociability = 101;

    expect(characterSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("rejects incomplete profile values", () => {
    const settings = getDefaultCharacterSettings();
    settings.characters.aoi.profile.name = "";

    expect(characterSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("stores and reloads settings independently", () => {
    const storage = createStorage();
    const settings = getDefaultCharacterSettings();
    settings.characters.haru.profile.occupation = "書店員";

    saveCharacterSettings(storage, settings);
    const loaded = loadCharacterSettings(storage);

    expect(loaded.source).toBe("saved");
    expect(loaded.settings.characters.haru.profile.occupation).toBe(
      "書店員"
    );
    expect(storage.values.has(CHARACTER_SETTINGS_STORAGE_KEY)).toBe(true);
  });

  it("falls back to presets when saved JSON is invalid", () => {
    const storage = createStorage();
    storage.setItem(CHARACTER_SETTINGS_STORAGE_KEY, "{invalid");

    const loaded = loadCharacterSettings(storage);

    expect(loaded.source).toBe("preset");
    expect(loaded.settings).toEqual(getDefaultCharacterSettings());
  });

  it("resets only the selected character", () => {
    const defaults = getDefaultCharacterSettings();
    const settings = getDefaultCharacterSettings();
    settings.characters.haru.profile.name = "春";
    settings.characters.aoi.profile.name = "碧";

    const reset = resetCharacterToPreset(settings, "haru");

    expect(reset.characters.haru).toEqual(defaults.characters.haru);
    expect(reset.characters.aoi.profile.name).toBe("碧");
  });
});
