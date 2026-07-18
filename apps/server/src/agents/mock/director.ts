import type { DirectorAgent, DirectorInput, ProposalTag, ResolvedEvent, StatDelta } from "@roommates/shared";

const cooperative = new Set(["ACCEPT", "MODIFY", "INITIATE"]);

const effects: Record<ProposalTag, StatDelta> = {
  cook: { energy: -6, stress: -3, affection: 8, trust: 7, romanticAwareness: 5 },
  movie: { energy: -3, stress: -7, affection: 7, trust: 4, romanticAwareness: 6 },
  clean: { energy: -5, stress: -6, affection: 4, trust: 8, romanticAwareness: 3 },
  apology: { energy: -2, stress: -9, affection: 5, trust: 10, romanticAwareness: 4 },
  talk: { energy: -3, stress: -5, affection: 7, trust: 9, romanticAwareness: 7 },
  gift: { energy: -2, stress: -3, affection: 9, trust: 5, romanticAwareness: 9 },
  rest: { energy: 6, stress: -5, affection: 2, trust: 2, romanticAwareness: 1 },
  confession: { energy: -3, stress: 2, affection: 8, trust: 7, romanticAwareness: 10 },
  pressure: { energy: -2, stress: 4, affection: -2, trust: -3, romanticAwareness: 0 },
  other: { energy: 2, stress: -1, affection: 0, trust: 0, romanticAwareness: 0 },
};

function scale(delta: StatDelta, factor: number): StatDelta {
  return Object.fromEntries(Object.entries(delta).map(([key, value]) => [key, Math.round((value ?? 0) * factor)])) as StatDelta;
}

export class MockDirectorAgent implements DirectorAgent {
  async resolve(input: DirectorInput): Promise<ResolvedEvent> {
    const tag = input.suggestion.tags.find((value) => value !== "pressure") ?? "other";
    const haruJoins = cooperative.has(input.haruDecision.decision);
    const aoiJoins = cooperative.has(input.aoiDecision.decision);
    const together = haruJoins && aoiJoins;
    const pressure = input.suggestion.tags.includes("pressure");

    if (!together) {
      const oneJoins = haruJoins || aoiJoins;
      const base = pressure ? effects.pressure : effects.rest;
      return {
        eventTitle: oneJoins ? "すれ違ったタイミング" : "それぞれの静かな時間",
        narration: oneJoins
          ? "片方は提案に心を向けたが、もう片方は今の自分のペースを選んだ。無理に同じ行動をすることはなかった。"
          : "二人は同じ部屋にいながら、それぞれの時間を過ごした。何も起こさないことも、ひとつの選択だった。",
        haruDialogue: input.haruDecision.dialogue,
        aoiDialogue: input.aoiDecision.dialogue,
        effects: {
          haru: scale(base, haruJoins ? 0.3 : 0.8),
          aoi: scale(base, aoiJoins ? 0.3 : 0.8),
        },
        memory: {
          title: oneJoins ? "合わなかった歩幅" : "同じ家の別々の時間",
          summary: "提案に無理に従わず、それぞれが自分の意思で過ごした",
          emotionalImpact: pressure ? -2 : 0,
          importance: pressure ? 4 : 2,
        },
        scene: { haru: "自室", aoi: "リビング" },
      };
    }

    const base = effects[tag];
    const titles: Record<ProposalTag, string> = {
      cook: "少し不格好な共同料理",
      movie: "ソファの端から始まる映画会",
      clean: "二人で整える暮らし",
      apology: "言葉にした、昨日のこと",
      talk: "湯気の向こうの本音",
      gift: "リビングに増えた一輪",
      rest: "何もしない午後",
      confession: "まだ名前のない気持ち",
      pressure: "急かされた心",
      other: "二人なりの小さな挑戦",
    };
    return {
      eventTitle: titles[tag],
      narration: `二人は提案をそのまま命令としてではなく、自分たちなりのきっかけとして選び取った。${input.haruDecision.action}Haruと、${input.aoiDecision.action}Aoiの間に、少しだけ自然な空気が流れた。`,
      haruDialogue: input.haruDecision.dialogue,
      aoiDialogue: input.aoiDecision.dialogue,
      effects: { haru: base, aoi: scale(base, tag === "cook" ? 1.1 : 1) },
      memory: {
        title: titles[tag],
        summary: `${input.suggestion.text}というきっかけから、二人が自分の意思で時間を共有した`,
        emotionalImpact: pressure ? -2 : 6,
        importance: tag === "confession" ? 9 : 7,
      },
      scene: { haru: tag === "cook" ? "キッチン" : "リビング", aoi: tag === "cook" ? "キッチン" : "リビング" },
      conflictUpdate:
        tag === "apology" && input.snapshot.shared.unresolvedConflicts[0]
          ? { resolve: [input.snapshot.shared.unresolvedConflicts[0]] }
          : undefined,
    };
  }
}
