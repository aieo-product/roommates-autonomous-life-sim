import type {
  CharacterId,
  CharacterState,
  Ending,
  GameSnapshot,
  Memory,
  RelationshipLabel,
  StatDelta,
} from "@roommates/shared";

const statKeys = ["energy", "stress", "affection", "trust", "romanticAwareness"] as const;

export function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function applyDelta(state: CharacterState, delta: StatDelta): CharacterState {
  const next = { ...state };
  for (const key of statKeys) next[key] = clamp(state[key] + (delta[key] ?? 0));
  return next;
}

export function deriveRelationship(
  characters: Record<CharacterId, CharacterState>,
  conflicts: string[],
  current: RelationshipLabel,
): RelationshipLabel {
  if (current === "couple") return "couple";
  const avg = (key: keyof Pick<CharacterState, "affection" | "trust" | "romanticAwareness">) =>
    (characters.haru[key] + characters.aoi[key]) / 2;
  if (avg("trust") < 15 && conflicts.length >= 2) return "broken";
  if (avg("affection") >= 50 && avg("trust") >= 45 && avg("romanticAwareness") >= 35)
    return "romantic_tension";
  if (avg("affection") >= 42 && avg("trust") >= 45) return "close_friends";
  if (avg("affection") >= 30 && avg("trust") >= 35) return "friends";
  return "roommates";
}

export function confessionEligible(snapshot: GameSnapshot, characters = snapshot.characters): boolean {
  const positiveMemory = snapshot.shared.sharedMemories
    .slice(-8)
    .some((memory) => memory.importance >= 6 && memory.emotionalImpact > 0);
  return (
    snapshot.shared.relationshipLabel === "romantic_tension" &&
    snapshot.shared.unresolvedConflicts.length === 0 &&
    positiveMemory &&
    ([characters.haru, characters.aoi] as CharacterState[]).every(
      (state) => state.affection >= 65 && state.trust >= 60 && state.romanticAwareness >= 50,
    )
  );
}

export function decorateCharacterState(state: CharacterState, id: CharacterId, positive: boolean): CharacterState {
  const exhausted = state.energy < 25;
  const tense = state.stress > 70;
  const mood = exhausted ? "くたくた" : tense ? "落ち着かない" : positive ? (id === "haru" ? "穏やか" : "ごきげん") : "考え中";
  return {
    ...state,
    mood,
    currentGoal: exhausted
      ? "少し休んで自分のペースを取り戻す"
      : positive
        ? id === "haru"
          ? "Aoiと自然な時間を重ねる"
          : "Haruの本音をもう少し知る"
        : "無理をせず共同生活を続ける",
  };
}

export function createMemory(
  partial: { title: string; summary: string; emotionalImpact: number; importance: number },
  day: number,
  phase: string,
  turnId: string,
): Memory {
  return {
    id: `memory-${turnId}`,
    sourceEventId: `log-${turnId}`,
    day,
    phase,
    title: partial.title,
    summary: partial.summary,
    emotionalImpact: partial.emotionalImpact,
    importance: partial.importance,
    participants: ["haru", "aoi"],
  };
}

export function endingFor(
  relationship: RelationshipLabel,
  characters: Record<CharacterId, CharacterState>,
): Ending {
  const affection = (characters.haru.affection + characters.aoi.affection) / 2;
  const awareness = (characters.haru.romanticAwareness + characters.aoi.romanticAwareness) / 2;
  if (relationship === "couple")
    return { kind: "couple", title: "ふたりの、はじまり", narration: "きっかけの先で、二人は自分たちの意志で恋人になることを選んだ。" };
  if (relationship === "broken")
    return { kind: "broken", title: "閉じた扉", narration: "すれ違いは最後まで解けなかった。それでも、この七日間は二人の記憶に残る。" };
  if (affection >= 55 && awareness >= 42)
    return { kind: "unspoken", title: "言葉になる前の気持ち", narration: "二人は互いへの好意に気づいた。でも、答えを急がないことを選んだ。" };
  if (relationship === "close_friends" || relationship === "romantic_tension")
    return { kind: "close_friends", title: "いちばん近いルームメイト", narration: "恋人にはならなかったが、二人だけの信頼が暮らしの中に根づいた。" };
  return { kind: "roommates", title: "それぞれの朝", narration: "二人はルームメイトのまま、それぞれの日常へ歩き出した。" };
}
