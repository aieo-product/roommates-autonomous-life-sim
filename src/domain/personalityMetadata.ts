import type { PersonalityKey } from "./characterSettings";

export interface PersonalityMetadata {
  label: string;
  lowLabel: string;
  highLabel: string;
  description: string;
}

export const personalityMetadata: Record<
  PersonalityKey,
  PersonalityMetadata
> = {
  sociability: {
    label: "社交性",
    lowLabel: "静かな交流",
    highLabel: "人と過ごすのが好き",
    description: "会話や共同活動へ参加しやすい度合い"
  },
  compassion: {
    label: "思いやり",
    lowLabel: "率直で現実的",
    highLabel: "相手を気遣う",
    description: "相手の状態や気持ちを判断に含める度合い"
  },
  initiative: {
    label: "積極性",
    lowLabel: "様子を見る",
    highLabel: "自分から動く",
    description: "提案や行動を自分から始める度合い"
  },
  expressiveness: {
    label: "感情表現",
    lowLabel: "控えめ",
    highLabel: "表情豊か",
    description: "台詞や態度へ感情を表す度合い"
  },
  romanticCaution: {
    label: "恋愛への慎重さ",
    lowLabel: "直感を信じる",
    highLabel: "ゆっくり確かめる",
    description: "恋愛的な提案を慎重に受け止める度合い"
  },
  independence: {
    label: "自立心",
    lowLabel: "支え合い重視",
    highLabel: "自分のペース重視",
    description: "単独の目的や時間を守ろうとする度合い"
  },
  cooperativeness: {
    label: "協調性",
    lowLabel: "こだわり優先",
    highLabel: "歩調を合わせる",
    description: "共同生活で相手と調整しやすい度合い"
  },
  cleanliness: {
    label: "きれい好き度",
    lowLabel: "おおらか",
    highLabel: "整頓が好き",
    description: "掃除や家事の提案を重視する度合い"
  },
  solitudeWhenTired: {
    label: "疲労時の一人時間",
    lowLabel: "誰かと回復",
    highLabel: "一人で回復",
    description: "疲れているときに一人の時間を求める度合い"
  },
  valuesPartnerInitiative: {
    label: "相手の自発性重視",
    lowLabel: "自分から誘う",
    highLabel: "相手の一歩を待つ",
    description: "関係の進展で相手の自発的な行動を待つ度合い"
  }
};
