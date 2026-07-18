import type {
  CharacterAgent,
  CharacterDecision,
  CharacterDecisionInput,
  CharacterId,
  DecisionKind,
  ProposalTag,
} from "@roommates/shared";
import { jitter } from "./seed.js";

const affinity: Record<CharacterId, Partial<Record<ProposalTag, number>>> = {
  haru: { cook: 20, movie: 9, clean: 8, talk: 4, apology: 12, gift: 2, confession: -10, pressure: -25 },
  aoi: { cook: 8, movie: 14, clean: -4, talk: 14, apology: 16, gift: 14, confession: 5, pressure: -18 },
};

const actions: Record<ProposalTag, string> = {
  cook: "一緒にキッチンへ立つ",
  movie: "リビングで映画を選ぶ",
  clean: "役割を分けて部屋を整える",
  apology: "落ち着いて昨日のことを話す",
  talk: "温かい飲み物を用意して話す",
  gift: "花を飾る場所を一緒に探す",
  rest: "それぞれの時間を大切にする",
  confession: "自分の気持ちと向き合う",
  pressure: "急がず距離を置いて考える",
  other: "提案を自分たちなりに試してみる",
};

function primaryTag(input: CharacterDecisionInput): ProposalTag {
  return input.suggestion.tags.find((tag) => tag !== "pressure") ?? input.suggestion.tags[0] ?? "other";
}

function dialogue(id: CharacterId, decision: DecisionKind, tag: ProposalTag): string {
  if (decision === "DECLINE") return id === "haru" ? "ごめん、今日は少し一人でいたい。" : "今は無理しないほうがよさそう。別のときにしよ？";
  if (decision === "IGNORE") return id === "haru" ? "……今日は自分のことを片付けよう。" : "今はちょっと、別のことがしたいかな。";
  if (decision === "MODIFY") {
    if (tag === "cook") return id === "haru" ? "簡単な一品だけなら、一緒に作る？" : "手軽なメニューに変えて、一緒にやろうよ。";
    if (tag === "movie") return id === "haru" ? "短い映画なら、一緒に観てみる？" : "今日は一本だけ、気楽に観ない？";
    return id === "haru" ? "少しだけなら、一緒にやってみる？" : "それ、もう少し気楽な形に変えてみない？";
  }
  if (decision === "INITIATE") return id === "haru" ? "よかったら、少し一緒に過ごさない？" : "ねえ、せっかくだし二人で何かしようよ。";
  if (tag === "cook") return id === "haru" ? "簡単なものなら、一緒に作る？" : "味見係だけじゃなくて、私も手伝う！";
  if (tag === "movie") return id === "haru" ? "Aoiが見たいもの、選んでいいよ。" : "飲み物を用意して、映画会にしよう。";
  if (tag === "confession") return id === "haru" ? "急がず、自分の言葉で考えたい。" : "本当の気持ちなら、ちゃんと向き合いたい。";
  return id === "haru" ? "うん、やってみようか。" : "いいね。楽しそう！";
}

export class MockCharacterAgent implements CharacterAgent {
  constructor(private readonly id: CharacterId) {}

  async decide(input: CharacterDecisionInput): Promise<CharacterDecision> {
    const tag = primaryTag(input);
    const self = input.self;
    const pressure = input.suggestion.tags.includes("pressure");
    const key = `${input.snapshot.seed}:${input.snapshot.shared.day}:${input.snapshot.shared.phase}:${this.id}:${input.suggestion.text}`;

    if (input.suggestion.kind === "observe") {
      const initiative = self.energy * 0.25 + self.affection * 0.22 + self.trust * 0.18 - self.stress * 0.2 + jitter(key, -8, 8);
      const decision: DecisionKind = initiative >= 34 ? "INITIATE" : "IGNORE";
      return {
        decision,
        action: decision === "INITIATE" ? (this.id === "haru" ? "Aoiに温かい飲み物を淹れる" : "Haruをベランダへ誘う") : "自分のペースで休む",
        dialogue: dialogue(this.id, decision, "rest"),
        publicReason: decision === "INITIATE" ? "同じ家で自然に過ごしたいから" : "今日は静かな時間が必要だから",
        internalSummary: decision === "INITIATE" ? "命令されなくても、相手と少し近づきたい" : "無理をすると相手にも気を遣わせそう",
        expectedEffects: decision === "INITIATE" ? { energy: -2, stress: -2 } : { energy: 6, stress: -5 },
      };
    }

    let score =
      32 +
      self.energy * 0.25 -
      self.stress * 0.25 +
      self.trust * 0.12 +
      self.affection * 0.08 +
      (affinity[this.id][tag] ?? 0) +
      jitter(key, -8, 8);
    if (pressure) score -= 18;
    if (self.energy < 30 && !["rest", "apology"].includes(tag)) score -= 18;
    if (input.snapshot.shared.phase === "night" && ["movie", "talk"].includes(tag)) score += 7;

    const decision: DecisionKind = score >= 67 ? "ACCEPT" : score >= 50 ? "MODIFY" : score >= 32 ? "DECLINE" : "IGNORE";
    const action = decision === "DECLINE" || decision === "IGNORE" ? "提案には参加せず、自分の時間を過ごす" : actions[tag];
    return {
      decision,
      action,
      dialogue: dialogue(this.id, decision, tag),
      publicReason:
        decision === "ACCEPT"
          ? "今なら二人で楽しめそうだから"
          : decision === "MODIFY"
            ? "自分の余力に合う形なら試せそうだから"
            : "今の気分と体力を優先したいから",
      internalSummary:
        decision === "ACCEPT" || decision === "MODIFY"
          ? this.id === "haru"
            ? "Aoiと近づきたいが、自然なペースを守りたい"
            : "Haruがどう応えてくれるか楽しみにしている"
          : this.id === "haru"
            ? "断ることで嫌われないか、少し気になっている"
            : "強制されるより、自分で選べる関係を大切にしたい",
      expectedEffects: decision === "ACCEPT" ? { energy: -5, stress: -2 } : decision === "MODIFY" ? { energy: -3, stress: -1 } : { energy: 3, stress: -1 },
    };
  }
}
