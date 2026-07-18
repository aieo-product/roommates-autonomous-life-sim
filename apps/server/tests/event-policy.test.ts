import { describe, expect, it } from "vitest";
import {
  createInitialGameState,
  mutableStatKeys,
  type CharacterDecision,
  type EventDefinition,
  type EventLogEntry,
  type GameState,
  type Phase,
  type ResolvedEvent,
} from "@roommates/shared";
import { EVENT_DEFINITIONS_BY_ID } from "../src/engine/event-definitions.js";
import {
  constrainResolvedEvent,
  evaluateEventAvailability,
} from "../src/engine/event-policy.js";
import { acceptedDecision, resolvedEvent } from "./helpers.js";

function definition(id: string): EventDefinition {
  const value = EVENT_DEFINITIONS_BY_ID.get(id);
  if (!value) throw new Error(`Missing event definition fixture: ${id}`);
  return value;
}

function state(): GameState {
  return createInitialGameState("event-policy-test");
}

function usage(
  eventDefinitionId: string,
  day: number,
  phase: Phase,
  index = 0,
): EventLogEntry {
  return {
    id: `usage-${eventDefinitionId}-${day}-${phase}-${index}`,
    day,
    phase,
    eventDefinitionId,
    cueSafetyFlags: [],
    suggestion: "安全なイベント提案",
    haruReaction: "ACCEPT: 参加する",
    aoiReaction: "ACCEPT: 参加する",
    eventTitle: "テストイベント",
    narration: "二人が自分の意思で参加した。",
    relationshipBefore: "roommates",
    relationshipAfter: "roommates",
    createdAt: `2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  };
}

function decision(kind: CharacterDecision["decision"]): CharacterDecision {
  return {
    ...acceptedDecision,
    decision: kind,
    action: kind === "DECLINE" ? "参加せず休む" : acceptedDecision.action,
    dialogue: kind === "DECLINE" ? "今回はやめておくね。" : acceptedDecision.dialogue,
  };
}

describe("evaluateEventAvailability", () => {
  it("enforces allowed phases and character/world preconditions", () => {
    const current = state();
    const movie = definition("movie-night");

    expect(evaluateEventAvailability(movie, current)).toMatchObject({ available: false });

    const cooking = definition("shared-cooking");
    current.characters.haru.state.energy = (cooking.preconditions.minEnergy ?? 0) - 1;
    expect(evaluateEventAvailability(cooking, current)).toMatchObject({
      available: false,
      reason: expect.stringContaining("体力"),
    });

    const apologyState = state();
    apologyState.shared.phase = "afternoon";
    expect(
      evaluateEventAvailability(definition("targeted-apology"), apologyState),
    ).toMatchObject({
      available: false,
      reason: expect.stringContaining("すれ違い"),
    });
  });

  it("keeps a two-phase cooldown locked before the boundary and allows it at exactly two phases", () => {
    const cooking: EventDefinition = {
      ...definition("shared-cooking"),
      maxUsesPerDay: 4,
      maxUsesPerRun: 10,
      cooldownPhases: 2,
    };
    const current = state();
    current.eventLog = [usage(cooking.id, 1, "morning")];
    current.shared.phase = "afternoon";

    expect(evaluateEventAvailability(cooking, current)).toMatchObject({
      available: false,
      reason: expect.stringContaining("2フェーズ"),
    });

    current.shared.phase = "evening";
    expect(evaluateEventAvailability(cooking, current)).toEqual({ available: true });
  });

  it("enforces the per-day usage cap", () => {
    const cooking = definition("shared-cooking");
    const current = state();
    current.shared.phase = "evening";
    current.eventLog = [usage(cooking.id, 1, "morning")];

    expect(evaluateEventAvailability(cooking, current)).toMatchObject({
      available: false,
      reason: expect.stringContaining("今日は"),
    });
  });

  it("enforces the per-run usage cap", () => {
    const cooking: EventDefinition = {
      ...definition("shared-cooking"),
      cooldownPhases: 0,
      maxUsesPerDay: 4,
      maxUsesPerRun: 2,
    };
    const current = state();
    current.shared.day = 3;
    current.eventLog = [
      usage(cooking.id, 1, "morning", 1),
      usage(cooking.id, 2, "morning", 2),
    ];

    expect(evaluateEventAvailability(cooking, current)).toMatchObject({
      available: false,
      reason: expect.stringContaining("上限"),
    });
  });
});

describe("constrainResolvedEvent", () => {
  it("clamps extreme positive and negative Director effects to the event budget", () => {
    const cooking = definition("shared-cooking");
    const extreme: ResolvedEvent = {
      ...structuredClone(resolvedEvent),
      effects: {
        haru: Object.fromEntries(mutableStatKeys.map((key) => [key, 100])),
        aoi: Object.fromEntries(mutableStatKeys.map((key) => [key, -100])),
      },
    };

    const constrained = constrainResolvedEvent(
      cooking,
      extreme,
      { haru: decision("ACCEPT"), aoi: decision("ACCEPT") },
      [],
    );

    for (const stat of mutableStatKeys) {
      expect(constrained.effects.haru[stat]).toBe(cooking.effectBudget[stat]);
      expect(constrained.effects.aoi[stat]).toBe(-cooking.effectBudget[stat]);
    }
  });

  it("removes relationship gains from a character who declines", () => {
    const cooking = definition("shared-cooking");
    const positive: ResolvedEvent = {
      ...structuredClone(resolvedEvent),
      effects: {
        haru: { energy: 100, stress: -100, affection: 100, trust: 100, romanticAwareness: 100 },
        aoi: { affection: 100, trust: 100, romanticAwareness: 100 },
      },
    };

    const constrained = constrainResolvedEvent(
      cooking,
      positive,
      { haru: decision("DECLINE"), aoi: decision("ACCEPT") },
      [],
    );

    expect(constrained.effects.haru).toMatchObject({
      affection: 0,
      trust: 0,
      romanticAwareness: 0,
    });
    expect(constrained.effects.haru.energy).toBe(cooking.effectBudget.energy);
    expect(constrained.effects.haru.stress).toBe(-cooking.effectBudget.stress);
    expect(constrained.effects.aoi.affection).toBeGreaterThan(0);
    expect(constrained.effects.aoi.trust).toBeGreaterThan(0);
  });

  it("lets targeted apology resolve exactly one requested existing conflict", () => {
    const apology = definition("targeted-apology");
    const conflicts = ["食器を片付けなかった", "帰宅連絡を忘れた", "映画の約束に遅れた"];
    const event: ResolvedEvent = {
      ...structuredClone(resolvedEvent),
      conflictUpdate: {
        resolve: ["存在しない対立", conflicts[1]!, conflicts[0]!],
      },
    };

    const constrained = constrainResolvedEvent(
      apology,
      event,
      { haru: decision("ACCEPT"), aoi: decision("ACCEPT") },
      conflicts,
    );

    expect(constrained.conflictUpdate?.resolve).toEqual([conflicts[1]]);
    expect(constrained.conflictUpdate?.resolve).toHaveLength(1);
    expect(conflicts).toContain(constrained.conflictUpdate?.resolve?.[0]);
  });
});
