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

const sharedActions: Record<ProposalTag, string> = {
  cook: "二人で材料を並べ、夕食を作る",
  movie: "二人で作品を選び、並んで映画を見る",
  clean: "役割を分けて部屋を整える",
  apology: "互いの話を遮らず、昨日のことを聞く",
  talk: "温かい飲み物を用意して、向き合って話す",
  gift: "贈り物を開き、部屋に飾る",
  rest: "それぞれ楽な姿勢で静かな時間を過ごす",
  confession: "急いで答えを決めず、伝えられた気持ちを受け止める",
  pressure: "無理をせず、その場から少し距離を置く",
  other: "二人で相談しながら、小さく試してみる",
};

const sharedRoutes: Record<ProposalTag, readonly [string, string]> = {
  cook: ["キッチンの調理台", "ダイニングの食卓"],
  movie: ["リビングのローテーブル", "リビングのソファ"],
  clean: ["キッチンの作業台", "リビングのローテーブル"],
  apology: ["ダイニングの食卓", "リビングのソファ"],
  talk: ["キッチンの調理台", "ダイニングの食卓"],
  gift: ["玄関", "リビングのローテーブル"],
  rest: ["ダイニングの食卓", "リビングのソファ"],
  confession: ["ベランダの窓際", "リビングのソファ"],
  pressure: ["廊下", "リビング"],
  other: ["廊下", "リビングのローテーブル"],
};

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
      const acknowledgement = haruJoins
        ? { speaker: "haru" as const, text: "わかった。今日はそれぞれのペースで過ごそう。" }
        : aoiJoins
          ? { speaker: "aoi" as const, text: "わかった。今日はそれぞれのペースで過ごそう。" }
          : { speaker: "haru" as const, text: "うん。今日はそれぞれの時間を大切にしよう。" };
      const haruDialogue = input.haruDecision.dialogue || "今は自分の時間を過ごすね。";
      const aoiDialogue = input.aoiDecision.dialogue || "私も自分のペースで過ごすね。";
      const independentActor = haruJoins ? "haru" : aoiJoins ? "aoi" : "haru";
      return {
        eventTitle: oneJoins ? "すれ違ったタイミング" : "それぞれの静かな時間",
        narration: oneJoins
          ? "片方は提案に心を向けたが、もう片方は今の自分のペースを選んだ。無理に同じ行動をすることはなかった。"
          : "二人は同じ部屋にいながら、それぞれの時間を過ごした。何も起こさないことも、ひとつの選択だった。",
        haruDialogue: input.haruDecision.dialogue,
        aoiDialogue: input.aoiDecision.dialogue,
        conversation: [
          { speaker: "haru", text: haruDialogue },
          { speaker: "aoi", text: aoiDialogue },
          acknowledgement,
        ],
        storyBeats: [
          { kind: "move", actor: "haru", location: "自室" },
          { kind: "dialogue", actor: "haru", text: haruDialogue },
          { kind: "move", actor: "aoi", location: "リビング" },
          { kind: "dialogue", actor: "aoi", text: aoiDialogue },
          {
            kind: "action",
            actor: independentActor,
            action: independentActor === "haru" ? "自室で自分の時間を整える" : "リビングで自分の時間を整える",
          },
          { kind: "dialogue", actor: acknowledgement.speaker, text: acknowledgement.text },
        ],
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
    const haruDialogue = input.haruDecision.dialogue || "一緒にやってみようか。";
    const aoiDialogue = input.aoiDecision.dialogue || "うん、やってみよう。";
    const [openingLocation, destination] = sharedRoutes[tag];
    const haruFollowUp = "それじゃ、できるところから始めよう。";
    const aoiFollowUp = "うん。二人のペースで進めよう。";
    return {
      eventTitle: titles[tag],
      narration: `二人は提案をそのまま命令としてではなく、自分たちなりのきっかけとして選び取った。${input.haruDecision.action}Haruと、${input.aoiDecision.action}Aoiの間に、少しだけ自然な空気が流れた。`,
      haruDialogue: input.haruDecision.dialogue,
      aoiDialogue: input.aoiDecision.dialogue,
      conversation: [
        { speaker: "haru", text: haruDialogue },
        { speaker: "aoi", text: aoiDialogue },
        { speaker: "haru", text: haruFollowUp },
        { speaker: "aoi", text: aoiFollowUp },
      ],
      storyBeats: [
        { kind: "move", actor: "both", location: openingLocation },
        { kind: "dialogue", actor: "haru", text: haruDialogue },
        { kind: "dialogue", actor: "aoi", text: aoiDialogue },
        { kind: "action", actor: "both", action: sharedActions[tag] },
        { kind: "move", actor: "both", location: destination },
        { kind: "dialogue", actor: "haru", text: haruFollowUp },
        { kind: "dialogue", actor: "aoi", text: aoiFollowUp },
      ],
      effects: { haru: base, aoi: scale(base, tag === "cook" ? 1.1 : 1) },
      memory: {
        title: titles[tag],
        summary: `${input.suggestion.text}というきっかけから、二人が自分の意思で時間を共有した`,
        emotionalImpact: pressure ? -2 : 6,
        importance: tag === "confession" ? 9 : 7,
      },
      scene: { haru: destination, aoi: destination },
      conflictUpdate:
        tag === "apology" && input.snapshot.shared.unresolvedConflicts[0]
          ? { resolve: [input.snapshot.shared.unresolvedConflicts[0]] }
          : undefined,
    };
  }
}
