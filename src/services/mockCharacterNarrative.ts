import type { CharacterDefinition } from "../domain/characterSettings";
import type { CharacterDecisionType } from "./characterAgentContract";

export function getMockDialogue(
  character: CharacterDefinition,
  decision: CharacterDecisionType
): string {
  const expressive = character.personality.expressiveness >= 65;
  const name = character.profile.name;
  const firstPerson = character.id === "aoi" ? "私" : "僕";
  const dialogueByDecision: Record<CharacterDecisionType, string> = {
    ACCEPT: expressive
      ? "いいね、それ楽しそう！ 一緒にやってみよう。"
      : "うん、いいと思う。一緒にやろう。",
    DECLINE: expressive
      ? "誘ってくれてうれしい。でも今は、少し自分の時間がほしいな。"
      : "ありがとう。今は少し休ませてほしい。",
    MODIFY: expressive
      ? "いいね。もう少し気軽な形から始めてみるのはどう？"
      : "少しだけ形を変えるなら、やってみたい。",
    IGNORE: expressive
      ? "ごめん、今は考えをまとめたい。またあとで話してもいい？"
      : "……今は、少し考えさせて。",
    INITIATE: expressive
      ? `それなら${firstPerson}から準備するね。せっかくだし、楽しもう！`
      : `じゃあ、${firstPerson}から準備しておくよ。`
  };

  return `${name}: ${dialogueByDecision[decision]}`;
}

export function getMockReason(
  character: CharacterDefinition,
  decision: CharacterDecisionType
): string {
  const personality = character.personality;
  const reasonByDecision: Record<CharacterDecisionType, string> = {
    ACCEPT:
      personality.cooperativeness >= 70
        ? "相手と歩調を合わせ、共有する時間を大切にしたいから。"
        : "今の自分のペースを保ちながら参加できると感じたから。",
    DECLINE:
      personality.solitudeWhenTired >= 70
        ? "疲れたときは一人で回復する時間を優先したいから。"
        : "今の状況では無理をしないほうが誠実だと考えたから。",
    MODIFY:
      personality.romanticCaution >= 65
        ? "関係を急がず、安心できる距離から進めたいから。"
        : "提案の意図はうれしいが、自分らしい形へ調整したいから。",
    IGNORE:
      personality.expressiveness < 45
        ? "すぐには言葉にできず、考える時間が必要だから。"
        : "今は反応するより、状況を見守りたいから。",
    INITIATE:
      personality.initiative >= 70
        ? "自分から動くことで、二人の時間を前向きにしたいから。"
        : "相手の負担を減らし、自然なきっかけを作りたいから。"
  };

  return reasonByDecision[decision];
}

export function getMockCurrentGoal(
  character: CharacterDefinition,
  decision: CharacterDecisionType
): string {
  if (decision === "DECLINE" || decision === "IGNORE") {
    return character.personality.independence >= 65
      ? "自分のペースを整え、次に向き合える余白を作る"
      : "無理をせず、落ち着いて状況を見守る";
  }

  if (character.personality.romanticCaution >= 70) {
    return "安心できる会話を重ね、少しずつ信頼を確かめる";
  }

  if (character.personality.initiative >= 70) {
    return "自分から楽しい共有体験を作り、距離を縮める";
  }

  return "共同生活の心地よいリズムを二人で見つける";
}
