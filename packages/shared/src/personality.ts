import { z } from "zod";
import type { CharacterId } from "./domain.js";

export const characterIds = ["haru", "aoi"] as const satisfies readonly CharacterId[];
export const characterIdSchema = z.enum(characterIds);

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
  "valuesPartnerInitiative",
] as const;

export type PersonalityKey = (typeof personalityKeys)[number];

const personalityValueSchema = z.number().int().min(0).max(100);

export const personalitySchema = z
  .object({
    sociability: personalityValueSchema,
    compassion: personalityValueSchema,
    initiative: personalityValueSchema,
    expressiveness: personalityValueSchema,
    romanticCaution: personalityValueSchema,
    independence: personalityValueSchema,
    cooperativeness: personalityValueSchema,
    cleanliness: personalityValueSchema,
    solitudeWhenTired: personalityValueSchema,
    valuesPartnerInitiative: personalityValueSchema,
  })
  .strict();

export type Personality = z.infer<typeof personalitySchema>;

const shortTextSchema = z.string().trim().min(1).max(40);
const descriptionSchema = z.string().trim().min(1).max(160);

export const characterProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(20),
    age: z.number().int().min(18).max(100),
    occupation: shortTextSchema,
    introduction: descriptionSchema,
    likes: z.array(shortTextSchema).min(1).max(10),
    dislikes: z.array(shortTextSchema).min(1).max(10),
    lifeStyle: descriptionSchema,
    romanceView: descriptionSchema,
    speechStyle: descriptionSchema,
  })
  .strict();

export type CharacterProfile = z.infer<typeof characterProfileSchema>;

export const characterDefinitionSchema = z
  .object({
    id: characterIdSchema,
    profile: characterProfileSchema,
    personality: personalitySchema,
  })
  .strict();

export type CharacterDefinition = z.infer<typeof characterDefinitionSchema>;

export const characterSettingsSchema = z
  .object({
    version: z.literal(1),
    characters: z
      .object({
        haru: characterDefinitionSchema,
        aoi: characterDefinitionSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((settings, context) => {
    for (const characterId of characterIds) {
      if (settings.characters[characterId].id !== characterId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "キャラクターIDと設定の対応が一致しません。",
          path: ["characters", characterId, "id"],
        });
      }
    }
  });

export type CharacterSettings = z.infer<typeof characterSettingsSchema>;

export interface PersonalityMetadata {
  label: string;
  lowLabel: string;
  highLabel: string;
  description: string;
}

export const personalityMetadata: Record<PersonalityKey, PersonalityMetadata> = {
  sociability: {
    label: "社交性",
    lowLabel: "静かな交流",
    highLabel: "人と過ごすのが好き",
    description: "会話や共同活動へ参加しやすい度合い",
  },
  compassion: {
    label: "思いやり",
    lowLabel: "率直で現実的",
    highLabel: "相手を気遣う",
    description: "相手の状態や気持ちを判断に含める度合い",
  },
  initiative: {
    label: "積極性",
    lowLabel: "様子を見る",
    highLabel: "自分から動く",
    description: "提案や行動を自分から始める度合い",
  },
  expressiveness: {
    label: "感情表現",
    lowLabel: "控えめ",
    highLabel: "表情豊か",
    description: "台詞や態度へ感情を表す度合い",
  },
  romanticCaution: {
    label: "恋愛への慎重さ",
    lowLabel: "直感を信じる",
    highLabel: "ゆっくり確かめる",
    description: "恋愛的な提案を慎重に受け止める度合い",
  },
  independence: {
    label: "自立心",
    lowLabel: "支え合い重視",
    highLabel: "自分のペース重視",
    description: "単独の目的や時間を守ろうとする度合い",
  },
  cooperativeness: {
    label: "協調性",
    lowLabel: "こだわり優先",
    highLabel: "歩調を合わせる",
    description: "共同生活で相手と調整しやすい度合い",
  },
  cleanliness: {
    label: "きれい好き度",
    lowLabel: "おおらか",
    highLabel: "整頓が好き",
    description: "掃除や家事の提案を重視する度合い",
  },
  solitudeWhenTired: {
    label: "疲労時の一人時間",
    lowLabel: "誰かと回復",
    highLabel: "一人で回復",
    description: "疲れているときに一人の時間を求める度合い",
  },
  valuesPartnerInitiative: {
    label: "相手の自発性重視",
    lowLabel: "自分から誘う",
    highLabel: "相手の一歩を待つ",
    description: "関係の進展で相手の自発的な行動を待つ度合い",
  },
};

const defaultCharacterSettings = {
  version: 1,
  characters: {
    haru: {
      id: "haru",
      profile: {
        name: "Haru",
        age: 27,
        occupation: "Webエンジニア",
        introduction: "穏やかで聞き上手。自分の気持ちは、時間をかけて言葉にする。",
        likes: ["深煎りコーヒー", "読書", "朝の散歩"],
        dislikes: ["急かされること", "大きな物音"],
        lifeStyle: "朝型。仕事の後は一人で静かに過ごすと元気を取り戻せる。",
        romanceView: "信頼を積み重ねてから関係を進めたい。相手の意思を尊重する。",
        speechStyle: "短く穏やかな話し方。考えてから答え、やわらかい相づちを打つ。",
      },
      personality: {
        sociability: 58,
        compassion: 84,
        initiative: 38,
        expressiveness: 35,
        romanticCaution: 82,
        independence: 72,
        cooperativeness: 66,
        cleanliness: 57,
        solitudeWhenTired: 86,
        valuesPartnerInitiative: 80,
      },
    },
    aoi: {
      id: "aoi",
      profile: {
        name: "Aoi",
        age: 26,
        occupation: "グラフィックデザイナー",
        introduction: "好奇心旺盛で、気持ちを素直に伝える。暮らしの小さな楽しみを見つけるのが得意。",
        likes: ["スケッチ", "古着屋めぐり", "音楽"],
        dislikes: ["曖昧な返事", "散らかった台所"],
        lifeStyle: "夜型。誰かと料理や会話をしながら一日を締めくくるのが好き。",
        romanceView: "気になる相手には自分から近づきたい。一緒に楽しめることを大切にする。",
        speechStyle: "テンポがよく表情豊か。相手の名前を呼び、感じたことを率直に伝える。",
      },
      personality: {
        sociability: 84,
        compassion: 72,
        initiative: 88,
        expressiveness: 82,
        romanticCaution: 34,
        independence: 55,
        cooperativeness: 79,
        cleanliness: 90,
        solitudeWhenTired: 36,
        valuesPartnerInitiative: 28,
      },
    },
  },
} satisfies CharacterSettings;

export const DEFAULT_CHARACTER_SETTINGS: CharacterSettings =
  characterSettingsSchema.parse(defaultCharacterSettings);

export function cloneCharacterSettings(settings: CharacterSettings): CharacterSettings {
  return characterSettingsSchema.parse(structuredClone(settings));
}

export function getDefaultCharacterSettings(): CharacterSettings {
  return cloneCharacterSettings(DEFAULT_CHARACTER_SETTINGS);
}

export function resetCharacterToPreset(
  currentSettings: CharacterSettings,
  characterId: CharacterId,
): CharacterSettings {
  const current = cloneCharacterSettings(currentSettings);
  const defaults = getDefaultCharacterSettings();
  current.characters[characterId] = defaults.characters[characterId];
  return characterSettingsSchema.parse(current);
}
