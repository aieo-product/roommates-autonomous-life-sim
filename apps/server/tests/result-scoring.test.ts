import { describe, expect, it } from "vitest";
import type {
  CharacterId,
  CharacterState,
  DecisionKind,
  Ending,
  EventCategory,
  Phase,
  RelationshipLabel,
  TurnStateSnapshot,
} from "@roommates/shared";
import {
  EXPECTED_RUN_TURNS,
  PRODUCER_SCORE_RULES,
  PRODUCER_SCORING_VERSION,
  RESULT_NARRATIVE_VERSION,
  buildProducerResult,
  buildResultNarrative,
  selectHighlights,
  type StructuredEventLogEntry,
} from "../src/engine/result/index.js";

const PHASES = ["morning", "afternoon", "evening", "night"] as const;
const CATEGORIES: EventCategory[] = ["rest", "cook", "movie", "clean", "talk", "gift"];

function characterState(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    energy: 70,
    stress: 30,
    affection: 30,
    trust: 35,
    romanticAwareness: 10,
    mood: "calm",
    location: "living-room",
    currentGoal: "自分のペースで過ごす",
    ...overrides,
  };
}

function snapshot(
  relationshipLabel: RelationshipLabel = "roommates",
  overrides: {
    haru?: Partial<CharacterState>;
    aoi?: Partial<CharacterState>;
    unresolvedConflicts?: string[];
    memoryIds?: string[];
  } = {},
): TurnStateSnapshot {
  return {
    characters: {
      haru: characterState(overrides.haru),
      aoi: characterState(overrides.aoi),
    },
    shared: {
      relationshipLabel,
      unresolvedConflicts: overrides.unresolvedConflicts ?? [],
      memoryIds: overrides.memoryIds ?? [],
    },
  };
}

function publicDecision(decision: DecisionKind) {
  return {
    decision,
    action: `${decision}に対応する公開行動`,
    dialogue: `${decision}に対応する公開発言`,
    publicReason: `${decision}を選んだ公開理由`,
  };
}

function entry(
  index: number,
  overrides: Partial<StructuredEventLogEntry> = {},
): StructuredEventLogEntry {
  const day = Math.floor(index / 4) + 1;
  const phase: Phase = PHASES[index % 4]!;
  const category = CATEGORIES[index % CATEGORIES.length]!;
  const before = snapshot();
  const after = snapshot();
  const id = `event-${String(index + 1).padStart(2, "0")}`;
  return {
    id,
    turnId: `turn-${index + 1}`,
    day,
    phase,
    eventDefinitionId: `definition-${category}-${index}`,
    eventCategory: category,
    intimacyTier: category === "rest" ? 0 : 1,
    cueSafetyFlags: [],
    suggestion: `${category}を提案する`,
    haruReaction: "ACCEPT: 公開行動",
    aoiReaction: "ACCEPT: 公開行動",
    haruDecision: "ACCEPT",
    aoiDecision: "ACCEPT",
    haruAction: "参加する",
    aoiAction: "参加する",
    haruDialogue: "やってみよう",
    aoiDialogue: "いいね",
    haruPublicReason: "無理なく参加できるから",
    aoiPublicReason: "自分も興味があるから",
    cue: {
      kind: "proposal",
      text: `${category}を提案する`,
      category,
      tags: [category],
      safetyFlags: [],
      transformed: false,
    },
    inputMethod: "candidate",
    requestedEventId: `definition-${category}-${index}`,
    alternativesShown: [],
    cueOutcome: "selected",
    decisions: {
      haru: publicDecision("ACCEPT"),
      aoi: publicDecision("ACCEPT"),
    },
    resolutionBranch: "both_participated",
    before,
    after,
    appliedEffects: { haru: {}, aoi: {} },
    runtimeSources: { haru: "mock", aoi: "mock", director: "mock" },
    cooldownPhases: 0,
    eventTitle: `${category}の時間`,
    narration: `二人は${category}の時間を、それぞれの意思で過ごした。`,
    relationshipBefore: "roommates",
    relationshipAfter: "roommates",
    createdAt: `2026-07-${String(day).padStart(2, "0")}T${String(index % 4).padStart(2, "0")}:00:00.000Z`,
    ...overrides,
  };
}

function completeRun(): StructuredEventLogEntry[] {
  return Array.from({ length: EXPECTED_RUN_TURNS }, (_, index) => entry(index));
}

const friendshipEnding: Ending = {
  kind: "close_friends",
  title: "親しい友人として",
  narration: "二人は友情を選んだ。",
};

describe("buildProducerResult", () => {
  it("is deterministic, versioned, complete, and independent from the Ending kind", () => {
    const eventLog = completeRun();
    const friendship = buildProducerResult(eventLog, friendshipEnding);
    const couple = buildProducerResult(eventLog, {
      kind: "couple",
      title: "恋人として",
      narration: "二人は恋愛関係を選んだ。",
    });

    expect(friendship).toEqual(buildProducerResult(eventLog, friendshipEnding));
    expect(friendship).toEqual(couple);
    expect(friendship.scoringVersion).toBe(PRODUCER_SCORING_VERSION);
    expect(friendship.coverage).toMatchObject({
      ratio: 1,
      completeTurns: 28,
      expectedTurns: 28,
      missing: [],
    });
  });

  it("does not punish a refusal and rewards a recovery-oriented next intervention", () => {
    const acceptedLog = completeRun();
    const respectedLog = completeRun();
    respectedLog[0] = entry(0, {
      decisions: { haru: publicDecision("DECLINE"), aoi: publicDecision("ACCEPT") },
      haruDecision: "DECLINE",
    });
    respectedLog[1] = entry(1, {
      eventDefinitionId: "rest-after-no",
      requestedEventId: "rest-after-no",
      eventCategory: "rest",
      intimacyTier: 0,
      cue: {
        kind: "proposal",
        text: "今日は休む",
        category: "rest",
        tags: ["rest"],
        safetyFlags: [],
        transformed: false,
      },
    });

    const accepted = buildProducerResult(acceptedLog);
    const respected = buildProducerResult(respectedLog);
    const agencyRuleIds = respected.axes.find((axis) => axis.id === "agency")!.evidence.map(
      (evidence) => evidence.ruleId,
    );

    expect(respected.overallScore).toBeGreaterThanOrEqual(accepted.overallScore);
    expect(agencyRuleIds).toContain("AG-01");
    expect(agencyRuleIds).not.toContain("AG-10");
  });

  it("applies stable pressure, safety, condition, repetition, and conflict rules with caps", () => {
    const pressured = completeRun();
    for (let index = 0; index < 5; index += 1) {
      const strained = snapshot("roommates", {
        haru: { energy: 20, stress: 80 },
        aoi: { energy: 25, stress: 75 },
      });
      pressured[index] = entry(index, {
        eventDefinitionId: "forced-confession",
        requestedEventId: "forced-confession",
        eventCategory: "confession",
        intimacyTier: 3,
        cueSafetyFlags: ["coercion"],
        cue: {
          kind: "proposal",
          text: "告白を強制する",
          category: "confession",
          tags: ["confession", "pressure"],
          safetyFlags: ["coercion"],
          transformed: index === 0,
        },
        cueOutcome: index === 0 ? "transformed" : "selected",
        decisions: { haru: publicDecision("DECLINE"), aoi: publicDecision("ACCEPT") },
        haruDecision: "DECLINE",
        before: strained,
        after: strained,
        conflictUpdate: { add: [`pressure-conflict-${index}`], resolve: [] },
        cooldownPhases: 3,
      });
    }

    const result = buildProducerResult(pressured);
    const evidence = result.axes.flatMap((axis) => axis.evidence);
    const ruleIds = new Set(evidence.map((item) => item.ruleId));

    for (const ruleId of ["AG-10", "AG-11", "WB-10", "WB-12", "CA-12", "PC-10", "PC-11"]) {
      expect(ruleIds).toContain(ruleId);
    }
    const agencyPressure = evidence
      .filter((item) => item.ruleId === "AG-10")
      .reduce((sum, item) => sum + item.points, 0);
    expect(agencyPressure).toBe(-12);
    expect(result.overallScore).toBeLessThan(buildProducerResult(completeRun()).overallScore);
  });

  it("reports old or incomplete logs as unavailable without parsing reaction strings", () => {
    const legacy = entry(0, {
      cue: undefined,
      inputMethod: undefined,
      cueOutcome: undefined,
      decisions: undefined,
      haruDecision: undefined,
      aoiDecision: undefined,
      haruAction: undefined,
      aoiAction: undefined,
      haruDialogue: undefined,
      aoiDialogue: undefined,
      haruPublicReason: undefined,
      aoiPublicReason: undefined,
      before: undefined,
      after: undefined,
      appliedEffects: undefined,
      runtimeSources: undefined,
      eventCategory: undefined,
      intimacyTier: undefined,
      cooldownPhases: undefined,
      haruReaction: "DECLINE: 今回はやめておく",
      aoiReaction: "ACCEPT: 一人で参加する",
    });

    const result = buildProducerResult([legacy]);
    expect(result.coverage.ratio).toBe(0);
    expect(result.coverage.completeTurns).toBe(0);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("95%未満"),
        expect.stringContaining("総合ランクを断定できません"),
      ]),
    );
    expect(result.axes.flatMap((axis) => axis.evidence).map((item) => item.ruleId)).not.toContain(
      "AG-01",
    );
  });

  it("publishes the complete fixed rule-id table", () => {
    expect(Object.keys(PRODUCER_SCORE_RULES)).toEqual([
      "AG-01",
      "AG-02",
      "AG-03",
      "AG-10",
      "AG-11",
      "WB-01",
      "WB-02",
      "WB-10",
      "WB-11",
      "WB-12",
      "CA-01",
      "CA-02",
      "CA-03",
      "CA-10",
      "CA-11",
      "CA-12",
      "PC-01",
      "PC-02",
      "PC-10",
      "PC-11",
      "PC-12",
      "ST-01",
      "ST-02",
      "ST-03",
      "ST-04",
      "ST-10",
      "ST-11",
    ]);
  });
});

describe("selectHighlights and buildResultNarrative", () => {
  function resultRun(): StructuredEventLogEntry[] {
    const eventLog = completeRun();
    eventLog[0] = entry(0, {
      before: snapshot("roommates"),
      after: snapshot("friends", { memoryIds: ["memory-first-step"] }),
      relationshipBefore: "roommates",
      relationshipAfter: "friends",
      memory: {
        id: "memory-first-step",
        sourceEventId: "event-01",
        day: 1,
        phase: "morning",
        title: "最初の一歩",
        summary: "二人が初めて相手のペースを確かめた。",
        emotionalImpact: 7,
        participants: ["haru", "aoi"],
        importance: 9,
      },
    });
    eventLog[4] = entry(4, {
      conflictUpdate: { add: ["conflict-dishes"], resolve: [] },
      after: snapshot("friends", { unresolvedConflicts: ["conflict-dishes"] }),
      relationshipBefore: "friends",
      relationshipAfter: "friends",
    });
    eventLog[8] = entry(8, {
      decisions: { haru: publicDecision("INITIATE"), aoi: publicDecision("ACCEPT") },
      haruDecision: "INITIATE",
      resolutionBranch: "self_initiated",
      eventTitle: "Haruからの朝食",
    });
    eventLog[12] = entry(12, {
      eventCategory: "apology",
      before: snapshot("friends", { unresolvedConflicts: ["conflict-dishes"] }),
      after: snapshot("friends"),
      conflictUpdate: { add: [], resolve: ["conflict-dishes"] },
      eventTitle: "食器についての話し合い",
    });
    eventLog[16] = entry(16, {
      memory: {
        id: "memory-kindness",
        sourceEventId: "event-17",
        day: 5,
        phase: "morning",
        title: "何も決めない午後",
        summary: "言葉を急がないことも、二人の選択になった。",
        emotionalImpact: 6,
        participants: ["haru", "aoi"],
        importance: 8,
      },
    });
    eventLog[20] = entry(20, {
      decisions: { haru: publicDecision("DECLINE"), aoi: publicDecision("ACCEPT") },
      haruDecision: "DECLINE",
    });
    eventLog[21] = entry(21, {
      eventDefinitionId: "rest-after-no",
      requestedEventId: "rest-after-no",
      eventCategory: "rest",
      intimacyTier: 0,
      cue: {
        kind: "proposal",
        text: "少し休む",
        category: "rest",
        tags: ["rest"],
        safetyFlags: [],
        transformed: false,
      },
    });
    return eventLog;
  }

  it("selects at most four deterministic moments without duplicating a primary event", () => {
    const eventLog = resultRun();
    const highlights = selectHighlights(eventLog);

    expect(highlights).toEqual(selectHighlights(eventLog));
    expect(highlights).toHaveLength(4);
    expect(new Set(highlights.map((item) => item.kind)).size).toBe(4);
    const primaryIds = highlights.map((item) => item.eventLogIds.at(-1));
    expect(new Set(primaryIds).size).toBe(primaryIds.length);
    expect(highlights.flatMap((item) => item.eventLogIds)).toContain("event-01");
  });

  it("builds a stable seven-chapter article that references every turn", () => {
    const eventLog = resultRun();
    const narrative = buildResultNarrative(eventLog, friendshipEnding);
    const sourceIds = narrative.daySections.flatMap((section) =>
      section.paragraphs.flatMap((paragraph) => paragraph.sourceEventLogIds),
    );

    expect(narrative).toEqual(buildResultNarrative(eventLog, friendshipEnding));
    expect(narrative.narrativeVersion).toBe(RESULT_NARRATIVE_VERSION);
    expect(narrative.daySections.map((section) => section.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(sourceIds)).toEqual(new Set(eventLog.map((item) => item.id)));
    expect(sourceIds).toHaveLength(28);
    expect(narrative.daySections.every((section) => section.featuredEventLogId)).toBe(true);
  });

  it("keeps missing days visible without inventing events", () => {
    const narrative = buildResultNarrative([entry(0)], friendshipEnding);
    expect(narrative.daySections).toHaveLength(7);
    expect(narrative.daySections[1]).toMatchObject({
      day: 2,
      title: expect.stringContaining("記録のない一日"),
      paragraphs: [
        {
          text: expect.stringContaining("推測せず"),
          sourceEventLogIds: [],
        },
      ],
    });
  });
});
