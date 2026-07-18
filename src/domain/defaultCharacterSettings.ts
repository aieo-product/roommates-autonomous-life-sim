import type { CharacterSettings } from "./characterSettings";

export const DEFAULT_CHARACTER_SETTINGS: CharacterSettings = {
  version: 1,
  characters: {
    haru: {
      id: "haru",
      profile: {
        name: "Haru",
        age: 27,
        occupation: "家具デザイナー",
        introduction:
          "穏やかで聞き上手。自分の気持ちは、時間をかけて言葉にする。",
        likes: ["深煎りコーヒー", "木工", "朝の散歩"],
        dislikes: ["急かされること", "大きな物音"],
        lifeStyle:
          "朝型。仕事の後は一人で静かに過ごすと元気を取り戻せる。",
        romanceView:
          "信頼を積み重ねてから関係を進めたい。相手の意思を尊重する。",
        speechStyle:
          "短く穏やかな話し方。考えてから答え、やわらかい相づちを打つ。"
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
        valuesPartnerInitiative: 80
      }
    },
    aoi: {
      id: "aoi",
      profile: {
        name: "Aoi",
        age: 25,
        occupation: "フードスタイリスト",
        introduction:
          "好奇心旺盛で、気持ちを素直に伝える。暮らしの小さな楽しみを見つけるのが得意。",
        likes: ["季節の料理", "古着屋めぐり", "音楽"],
        dislikes: ["曖昧な返事", "散らかった台所"],
        lifeStyle:
          "夜型。誰かと料理や会話をしながら一日を締めくくるのが好き。",
        romanceView:
          "気になる相手には自分から近づきたい。一緒に楽しめることを大切にする。",
        speechStyle:
          "テンポがよく表情豊か。相手の名前を呼び、感じたことを率直に伝える。"
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
        valuesPartnerInitiative: 28
      }
    }
  }
};

export function cloneCharacterSettings(
  settings: CharacterSettings
): CharacterSettings {
  return structuredClone(settings);
}

export function getDefaultCharacterSettings(): CharacterSettings {
  return cloneCharacterSettings(DEFAULT_CHARACTER_SETTINGS);
}
