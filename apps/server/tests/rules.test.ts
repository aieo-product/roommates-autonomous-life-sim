import { describe, expect, it } from "vitest";
import { createInitialGameState } from "@roommates/shared";
import { applyDelta, clamp, deriveRelationship } from "../src/engine/rules.js";

describe("initial game state", () => {
  it("creates the specified Day 1 character state", () => {
    const state = createInitialGameState();

    expect(state.shared).toMatchObject({
      day: 1,
      phase: "morning",
      relationshipLabel: "roommates",
      unresolvedConflicts: [],
      sharedMemories: [],
    });
    expect(state.characters.haru.state).toMatchObject({
      energy: 70,
      stress: 25,
      affection: 20,
      trust: 30,
      romanticAwareness: 5,
    });
    expect(state.characters.aoi.state).toMatchObject({
      energy: 65,
      stress: 30,
      affection: 20,
      trust: 30,
      romanticAwareness: 5,
    });
    expect(state.status).toBe("awaiting_suggestion");
    expect(state.revision).toBe(0);
  });

  it("returns independent state objects", () => {
    const first = createInitialGameState();
    const second = createInitialGameState();

    first.characters.haru.state.energy = 0;
    first.shared.unresolvedConflicts.push("test conflict");

    expect(second.characters.haru.state.energy).toBe(70);
    expect(second.shared.unresolvedConflicts).toEqual([]);
  });
});
describe("numeric rules", () => {
  it.each([
    [-10, 0],
    [0, 0],
    [49.6, 50],
    [100, 100],
    [150, 100],
  ])("clamps %s to %s", (input, expected) => {
    expect(clamp(input)).toBe(expected);
  });

  it("clamps every mutable stat after applying a delta", () => {
    const initial = createInitialGameState().characters.haru.state;
    const next = applyDelta(initial, {
      energy: 100,
      stress: -100,
      affection: 500,
      trust: -500,
      romanticAwareness: 101,
    });

    expect(next).toMatchObject({
      energy: 100,
      stress: 0,
      affection: 100,
      trust: 0,
      romanticAwareness: 100,
    });
    expect(initial).toMatchObject({ energy: 70, stress: 25, affection: 20, trust: 30 });
  });

  it("never derives couple from stats alone", () => {
    const state = createInitialGameState();
    const characters = {
      haru: { ...state.characters.haru.state, affection: 100, trust: 100, romanticAwareness: 100 },
      aoi: { ...state.characters.aoi.state, affection: 100, trust: 100, romanticAwareness: 100 },
    };

    expect(deriveRelationship(characters, [], "roommates")).toBe("romantic_tension");
  });
});
