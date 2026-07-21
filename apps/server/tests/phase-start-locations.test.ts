import type { CharacterId, GameState, Phase } from "@roommates/shared";
import { createInitialGameState, phases } from "@roommates/shared";
import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine/game-engine.js";
import {
  PHASE_START_LOCATION_OPTIONS,
  phaseStartLocations,
} from "../src/engine/phase-start-locations.js";
import { MemoryGameRepository } from "../src/persistence/repository.js";
import { StaticAgentCoordinator } from "./helpers.js";

const characterIds = ["haru", "aoi"] as const satisfies readonly CharacterId[];

function nextBoundary(day: number, phase: Phase): { day: number; phase: Phase } {
  const currentIndex = phases.indexOf(phase);
  const wraps = currentIndex === phases.length - 1;
  return {
    day: wraps ? day + 1 : day,
    phase: phases[(currentIndex + 1) % phases.length]!,
  };
}

async function engineAtResolvedBoundary(day: number, phase: Phase) {
  const repository = new MemoryGameRepository();
  const agents = new StaticAgentCoordinator();
  const sourceEngine = new GameEngine(repository, agents);
  await sourceEngine.initialize();
  const resolved = await sourceEngine.resolveTurn(
    "二人で映画を見よう",
    `boundary-source-${day}-${phase}`,
    0,
  );
  const boundaryState: GameState = {
    ...resolved,
    seed: "phase-boundary-seed",
    shared: { ...resolved.shared, day, phase },
    characters: {
      haru: {
        ...resolved.characters.haru,
        state: {
          ...resolved.characters.haru.state,
          location: "直前イベントの臨時会場・haru",
        },
      },
      aoi: {
        ...resolved.characters.aoi,
        state: {
          ...resolved.characters.aoi.state,
          location: "直前イベントの臨時会場・aoi",
        },
      },
    },
  };
  await repository.save(boundaryState);

  const engine = new GameEngine(repository, agents);
  await engine.initialize();
  return { agents, boundaryState, engine, repository };
}

describe("phase starting locations", () => {
  it.each(phases)("chooses deterministic, day-varying %s locations", (phase) => {
    const input = {
      seed: "repeatable-schedule",
      day: 2,
      phase,
      current: { haru: "臨時会場A", aoi: "臨時会場B" },
    } as const;
    const first = phaseStartLocations(input);

    expect(phaseStartLocations(input)).toEqual(first);
    expect(phaseStartLocations({ ...input, day: 3 })).not.toEqual(first);
    for (const characterId of characterIds) {
      expect(
        PHASE_START_LOCATION_OPTIONS[phase].map((option) => option[characterId]),
      ).toContain(first[characterId]);
    }
  });

  it.each(phases)("avoids leaving a character in the same visible %s destination", (phase) => {
    const baseInput = {
      seed: "same-room-guard",
      day: 4,
      phase,
      current: { haru: "臨時会場A", aoi: "臨時会場B" },
    } as const;
    const initiallySelected = phaseStartLocations(baseInput);
    const relocated = phaseStartLocations({
      ...baseInput,
      current: initiallySelected,
    });

    expect(relocated.haru).not.toBe(initiallySelected.haru);
    expect(relocated.aoi).not.toBe(initiallySelected.aoi);
  });

  it.each([
    { day: 3, phase: "morning" as const, nextDay: 3, nextPhase: "afternoon" as const },
    { day: 3, phase: "afternoon" as const, nextDay: 3, nextPhase: "evening" as const },
    { day: 3, phase: "evening" as const, nextDay: 3, nextPhase: "night" as const },
    { day: 3, phase: "night" as const, nextDay: 4, nextPhase: "morning" as const },
  ])(
    "persists relocation across the $phase to $nextPhase boundary",
    async ({ day, phase, nextDay, nextPhase }) => {
      const { boundaryState, engine, repository } = await engineAtResolvedBoundary(day, phase);
      const historicalEvent = structuredClone(boundaryState.lastEvent);
      const historicalLog = structuredClone(boundaryState.eventLog);
      const expectedLocations = phaseStartLocations({
        seed: boundaryState.seed,
        day: nextDay,
        phase: nextPhase,
        current: {
          haru: boundaryState.characters.haru.state.location,
          aoi: boundaryState.characters.aoi.state.location,
        },
      });

      const advanced = await engine.advance();

      expect(advanced).toMatchObject({
        revision: boundaryState.revision + 1,
        status: "awaiting_suggestion",
        shared: { day: nextDay, phase: nextPhase },
      });
      expect(advanced.characters.haru.state.location).toBe(expectedLocations.haru);
      expect(advanced.characters.aoi.state.location).toBe(expectedLocations.aoi);
      expect(advanced.lastEvent).toEqual(historicalEvent);
      expect(advanced.eventLog).toEqual(historicalLog);

      const reloadedEngine = new GameEngine(repository, new StaticAgentCoordinator());
      await reloadedEngine.initialize();
      expect(reloadedEngine.getState()).toEqual(advanced);
    },
  );

  it("uses the relocated positions in the next character-agent snapshots", async () => {
    const { agents, boundaryState, engine } = await engineAtResolvedBoundary(2, "night");
    const expectedBoundary = nextBoundary(2, "night");
    const advanced = await engine.advance();

    expect(advanced.shared).toMatchObject(expectedBoundary);
    await engine.resolveTurn(
      "温かい飲み物を飲みながら話してみて",
      "turn-after-phase-relocation",
      advanced.revision,
    );

    expect(agents.inputs.haru?.snapshot.characters.haru.location).toBe(
      advanced.characters.haru.state.location,
    );
    expect(agents.inputs.aoi?.snapshot.characters.aoi.location).toBe(
      advanced.characters.aoi.state.location,
    );
    expect(agents.inputs.haru?.snapshot.characters.haru.location).not.toBe(
      boundaryState.characters.haru.state.location,
    );
    expect(agents.inputs.aoi?.snapshot.characters.aoi.location).not.toBe(
      boundaryState.characters.aoi.state.location,
    );
  });
});
