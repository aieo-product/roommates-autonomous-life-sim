import { z } from "zod";

export const characterIds = ["haru", "aoi"] as const;
export const characterIdSchema = z.enum(characterIds);

export type CharacterId = z.infer<typeof characterIdSchema>;

export const personalityKeys = [
  "sociability",
  "compassion",
  "initiative",
  "expressiveness",
  "romanticCaution",
  "independence",
  "cooperativeness",
  "cleanliness",
  "solitudeWhenTired",
  "valuesPartnerInitiative"
] as const;

export type PersonalityKey = (typeof personalityKeys)[number];

const personalityValueSchema = z.number().int().min(0).max(100);

export const personalitySchema = z.object({
  sociability: personalityValueSchema,
  compassion: personalityValueSchema,
  initiative: personalityValueSchema,
  expressiveness: personalityValueSchema,
  romanticCaution: personalityValueSchema,
  independence: personalityValueSchema,
  cooperativeness: personalityValueSchema,
  cleanliness: personalityValueSchema,
  solitudeWhenTired: personalityValueSchema,
  valuesPartnerInitiative: personalityValueSchema
});

export type Personality = z.infer<typeof personalitySchema>;

const shortTextSchema = z.string().trim().min(1).max(40);
const descriptionSchema = z.string().trim().min(1).max(160);

export const characterProfileSchema = z.object({
  name: z.string().trim().min(1).max(20),
  age: z.number().int().min(18).max(100),
  occupation: shortTextSchema,
  introduction: descriptionSchema,
  likes: z.array(shortTextSchema).min(1).max(10),
  dislikes: z.array(shortTextSchema).min(1).max(10),
  lifeStyle: descriptionSchema,
  romanceView: descriptionSchema,
  speechStyle: descriptionSchema
});

export type CharacterProfile = z.infer<typeof characterProfileSchema>;

export const characterDefinitionSchema = z.object({
  id: characterIdSchema,
  profile: characterProfileSchema,
  personality: personalitySchema
});

export type CharacterDefinition = z.infer<typeof characterDefinitionSchema>;

export const characterSettingsSchema = z
  .object({
    version: z.literal(1),
    characters: z.object({
      haru: characterDefinitionSchema,
      aoi: characterDefinitionSchema
    })
  })
  .superRefine((settings, context) => {
    for (const characterId of characterIds) {
      if (settings.characters[characterId].id !== characterId) {
        context.addIssue({
          code: "custom",
          message: "キャラクターIDと設定の対応が一致しません。",
          path: ["characters", characterId, "id"]
        });
      }
    }
  });

export type CharacterSettings = z.infer<typeof characterSettingsSchema>;

export type { PersonalityMetadata } from "./personalityMetadata";
export { personalityMetadata } from "./personalityMetadata";
export {
  DEFAULT_CHARACTER_SETTINGS,
  cloneCharacterSettings,
  getDefaultCharacterSettings
} from "./defaultCharacterSettings";
