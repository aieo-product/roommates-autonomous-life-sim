import { describe, expect, it, vi } from "vitest";
import type {
  AppServerAdapter,
} from "../src/agents/coordinator.js";
import type { CharacterDecisionInput, DirectorInput, GameSnapshot } from "@roommates/shared";
import { createInitialGameState } from "@roommates/shared";
import { ResilientAgentCoordinator } from "../src/agents/coordinator.js";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";

function snapshot(): GameSnapshot {
  const state = createInitialGameState();
  return {
    seed: state.seed,
    revision: state.revision,
    characters: {
      haru: state.characters.haru.state,
      aoi: state.characters.aoi.state,
    },
    shared: state.shared,
  };
}

function characterInput(): CharacterDecisionInput {
  const current = snapshot();
  return {
    turnId: "turn-invalid-json",
    characterId: "haru",
    snapshot: current,
    self: current.characters.haru,
    otherKnownInfo: {
      mood: current.characters.aoi.mood,
      location: current.characters.aoi.location,
      currentGoal: current.characters.aoi.currentGoal,
    },
    recentMemories: [],
    importantMemories: [],
    suggestion: sanitizeSuggestion("一緒に料理をしよう"),
  };
}

describe("ResilientAgentCoordinator", () => {
  it("retries invalid structured output once and safely falls back", async () => {
    const decide = vi.fn(async () => ({ value: { decision: "NOT_VALID" }, threadId: "thread-haru" }));
    const real: AppServerAdapter = {
      decide,
      resolve: vi.fn(async (_input: DirectorInput) => ({ value: {}, threadId: "thread-director" })),
      shutdown: vi.fn(async () => undefined),
    };
    const coordinator = new ResilientAgentCoordinator("auto", 100, real);

    const result = await coordinator.decide("haru", characterInput());

    expect(decide).toHaveBeenCalledTimes(2);
    expect(result.runtime.source).toBe("fallback");
    expect(result.runtime.error).toContain("invalid structured JSON");
    expect(result.value.decision).toMatch(/ACCEPT|DECLINE|MODIFY|IGNORE|INITIATE/);
  });

  it("does not invoke App Server in explicit mock mode", async () => {
    const decide = vi.fn();
    const real: AppServerAdapter = {
      decide,
      resolve: vi.fn(),
      shutdown: vi.fn(async () => undefined),
    };
    const coordinator = new ResilientAgentCoordinator("mock", 100, real);

    const result = await coordinator.decide("haru", characterInput());

    expect(decide).not.toHaveBeenCalled();
    expect(result.runtime.source).toBe("mock");
  });
});
