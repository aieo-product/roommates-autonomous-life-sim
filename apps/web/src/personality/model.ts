import {
  personalityKeys,
  personalityMetadata,
  type CharacterId,
  type CharacterSettings,
} from "@roommates/shared";

export type PersonalityCharacter = CharacterSettings["characters"][CharacterId];
export type CharacterProfile = PersonalityCharacter["profile"];
export type PersonalityKey = keyof PersonalityCharacter["personality"];

export type PersonalityField = {
  key: PersonalityKey;
  label: string;
  lowLabel: string;
  highLabel: string;
  description: string;
};

export const PERSONALITY_FIELDS: readonly PersonalityField[] = personalityKeys.map(
  (key) => ({ key, ...personalityMetadata[key] }),
);

export const CHARACTER_ACCENTS: Record<CharacterId, string> = {
  haru: "#48a9d8",
  aoi: "#f17c73",
};

export function cloneCharacterSettings(settings: CharacterSettings): CharacterSettings {
  return structuredClone(settings);
}

export function tendencyLabel(field: PersonalityField, value: number): string {
  if (value <= 35) return field.lowLabel;
  if (value >= 65) return field.highLabel;
  return "バランス型";
}
