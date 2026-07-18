import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHARACTER_SETTINGS,
  characterSettingsSchema,
  cloneCharacterSettings,
  getDefaultCharacterSettings,
  personalityKeys,
  personalityMetadata,
  resetCharacterToPreset,
  turnRequestSchema,
} from "@roommates/shared";

describe("character personality settings", () => {
  it("exports valid, contrasting defaults for the established characters", () => {
    const settings = getDefaultCharacterSettings();

    expect(characterSettingsSchema.parse(settings)).toEqual(settings);
    expect(settings.characters.haru.profile).toMatchObject({
      name: "Haru",
      age: 27,
      occupation: "Webエンジニア",
    });
    expect(settings.characters.aoi.profile).toMatchObject({
      name: "Aoi",
      age: 26,
      occupation: "グラフィックデザイナー",
    });
    expect(personalityKeys).toHaveLength(10);
    expect(Object.keys(personalityMetadata)).toEqual([...personalityKeys]);
    expect(settings.characters.aoi.personality.initiative).toBeGreaterThan(
      settings.characters.haru.personality.initiative,
    );
  });

  it("strictly rejects unknown, fractional, and out-of-range personality values", () => {
    const unknownKey = getDefaultCharacterSettings() as unknown as Record<string, unknown>;
    unknownKey.extra = true;
    expect(characterSettingsSchema.safeParse(unknownKey).success).toBe(false);

    const fractional = getDefaultCharacterSettings();
    fractional.characters.haru.personality.sociability = 50.5;
    expect(characterSettingsSchema.safeParse(fractional).success).toBe(false);

    const outOfRange = getDefaultCharacterSettings();
    outOfRange.characters.aoi.personality.cleanliness = 101;
    expect(characterSettingsSchema.safeParse(outOfRange).success).toBe(false);
  });

  it("rejects a character definition stored under the wrong id", () => {
    const settings = getDefaultCharacterSettings();
    settings.characters.haru.id = "aoi";

    expect(characterSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("returns independent clones and resets only the selected character", () => {
    const clone = cloneCharacterSettings(DEFAULT_CHARACTER_SETTINGS);
    clone.characters.haru.profile.name = "春";
    clone.characters.aoi.profile.name = "碧";

    expect(DEFAULT_CHARACTER_SETTINGS.characters.haru.profile.name).toBe("Haru");

    const reset = resetCharacterToPreset(clone, "haru");
    expect(reset.characters.haru).toEqual(DEFAULT_CHARACTER_SETTINGS.characters.haru);
    expect(reset.characters.aoi.profile.name).toBe("碧");
  });

  it("keeps old turn payloads valid and validates optional settings", () => {
    const baseRequest = {
      suggestion: "一緒に夕食を作ってみたら？",
      idempotencyKey: "turn-1",
      revision: 0,
    };

    expect(turnRequestSchema.safeParse(baseRequest).success).toBe(true);
    expect(
      turnRequestSchema.safeParse({
        ...baseRequest,
        characterSettings: getDefaultCharacterSettings(),
      }).success,
    ).toBe(true);

    const invalid = getDefaultCharacterSettings();
    invalid.characters.haru.personality.compassion = -1;
    expect(
      turnRequestSchema.safeParse({ ...baseRequest, characterSettings: invalid }).success,
    ).toBe(false);
  });
});
