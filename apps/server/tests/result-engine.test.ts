import { describe, expect, it } from "vitest";
import type {
  AgentResultReflection,
  CharacterDecision,
  CharacterDecisionInput,
  CharacterId,
  DirectorInput,
  GameResult,
  GameState,
  ResolvedEvent,
  StreamEvent,
} from "@roommates/shared";
import { createInitialGameState } from "@roommates/shared";
import type {
  AgentCoordinator,
  AgentResult,
} from "../src/agents/coordinator.js";
import {
  fallbackAgentReflection,
  type AgentReflectionInput,
} from "../src/agents/reflection.js";
import { GameEngine } from "../src/engine/game-engine.js";
import type { GameRepository } from "../src/persistence/repository.js";
import {
  acceptedDecision,
  mockResult,
  resolvedEvent,
} from "./helpers.js";

type ReadyResult = Extract<GameResult, { status: "ready" }>;
type PartialResult = Extract<GameResult, { status: "partial" }>;

class RecordingRepository implements GameRepository {
  private state: GameState | undefined;
  readonly saves: GameState[] = [];

  constructor(initial?: GameState) {
    this.state = initial ? structuredClone(initial) : undefined;
  }

  async load(): Promise<GameState | undefined> {
    return this.state ? structuredClone(this.state) : undefined;
  }

  async save(state: GameState): Promise<void> {
    this.state = structuredClone(state);
    this.saves.push(structuredClone(state));
  }

  async clear(): Promise<void> {
    this.state = undefined;
  }
}

class ResultCoordinator implements AgentCoordinator {
  readonly reflectionCalls: Array<{
    id: CharacterId;
    input: AgentReflectionInput;
  }> = [];

  constructor(private readonly failingReflection?: CharacterId | "all") {}

  async decide(
    _id: CharacterId,
    _input: CharacterDecisionInput,
  ): Promise<AgentResult<CharacterDecision>> {
    return mockResult(structuredClone(acceptedDecision));
  }

  async resolve(_input: DirectorInput): Promise<AgentResult<ResolvedEvent>> {
    return mockResult(structuredClone(resolvedEvent));
  }

  async reflect(
    id: CharacterId,
    input: AgentReflectionInput,
  ): Promise<AgentResult<AgentResultReflection>> {
    this.reflectionCalls.push({ id, input: structuredClone(input) });
    if (this.failingReflection === id || this.failingReflection === "all") {
      throw new Error(`${id} reflection unavailable`);
    }
    return mockResult(fallbackAgentReflection(input));
  }
}

function lastTurnState(seed = "result-engine-seed"): GameState {
  const initial = createInitialGameState(seed);
  return {
    ...initial,
    revision: 27,
    shared: {
      ...initial.shared,
      day: 7,
      phase: "night",
    },
  };
}

async function initializedEngine(
  coordinator: AgentCoordinator,
  initial: GameState = lastTurnState(),
) {
  const repository = new RecordingRepository(initial);
  const engine = new GameEngine(repository, coordinator);
  await engine.initialize();
  return { engine, repository };
}

function requireReady(state: GameState): ReadyResult {
  expect(state.result?.status).toBe("ready");
  if (state.result?.status !== "ready") {
    throw new Error("expected a ready result");
  }
  return state.result;
}

function requirePartial(state: GameState): PartialResult {
  expect(state.result?.status).toBe("partial");
  if (state.result?.status !== "partial") {
    throw new Error("expected a partial result");
  }
  return state.result;
}

describe("GameEngine result generation", () => {
  it("persists the score, seven-day article, highlights, and both reflections after Day 7 night", async () => {
    const coordinator = new ResultCoordinator();
    const { engine, repository } = await initializedEngine(coordinator);
    const streamed: StreamEvent[] = [];

    const state = await engine.resolveTurn(
      "今日は二人で映画を見よう",
      "final-turn-ready",
      27,
      (event) => streamed.push(event),
    );
    const result = requireReady(state);

    expect(state).toMatchObject({ status: "ended", revision: 28 });
    expect(state.ending).toBeDefined();
    expect(state.eventLog).toHaveLength(1);
    expect(result.producer).toMatchObject({
      overallScore: expect.any(Number),
      rank: expect.stringMatching(/^[SABC]$/),
      scoringVersion: "producer-v1",
    });
    expect(result.producer.axes).toHaveLength(5);
    expect(result.producer.highlights.length).toBeGreaterThan(0);
    expect(result.narrative).toMatchObject({
      headline: expect.any(String),
      narrativeVersion: "result-narrative-v1",
    });
    expect(result.narrative.daySections).toHaveLength(7);
    expect(result.narrative.daySections[6]?.featuredEventLogId).toBe(
      state.eventLog[0]?.id,
    );
    expect(result.reflections.haru.characterId).toBe("haru");
    expect(result.reflections.aoi.characterId).toBe("aoi");
    expect(coordinator.reflectionCalls.map(({ id }) => id).sort()).toEqual([
      "aoi",
      "haru",
    ]);
    expect(
      coordinator.reflectionCalls.every(
        ({ input }) => input.highlightEventLogIds.length > 0,
      ),
    ).toBe(true);

    expect(
      repository.saves.some(({ result: saved }) => saved?.status === "generating"),
    ).toBe(true);
    expect(repository.saves.at(-1)?.result?.status).toBe("ready");
    expect(streamed.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "result.generating",
        "agent.reflecting",
        "agent.reflected",
        "result.completed",
        "turn.completed",
      ]),
    );
    expect(
      streamed.find(({ type }) => type === "result.completed")?.data,
    ).toMatchObject({ status: "ready" });
  });

  it("keeps the committed ending and event log when one reflection fails, then saves a partial result", async () => {
    const coordinator = new ResultCoordinator("haru");
    const { engine, repository } = await initializedEngine(coordinator);
    const streamed: StreamEvent[] = [];

    const state = await engine.resolveTurn(
      "今日は二人で映画を見よう",
      "final-turn-partial",
      27,
      (event) => streamed.push(event),
    );
    const result = requirePartial(state);

    expect(state.status).toBe("ended");
    expect(state.revision).toBe(28);
    expect(state.ending).toBeDefined();
    expect(state.eventLog).toHaveLength(1);
    expect(state.eventLog[0]?.eventTitle).toBe(resolvedEvent.eventTitle);
    expect(result.ending).toEqual(state.ending);
    expect(result.narrative?.daySections).toHaveLength(7);
    expect(result.reflections.haru).toMatchObject({
      characterId: "haru",
      runtime: {
        source: "fallback",
        error: "haru reflection unavailable",
      },
    });
    expect(result.reflections.aoi?.characterId).toBe("aoi");
    expect(result.failures).toEqual([
      {
        component: "haru_reflection",
        reason: "haru reflection unavailable",
        retryable: true,
      },
    ]);
    expect(repository.saves.at(-1)).toMatchObject({
      status: "ended",
      revision: 28,
      result: { status: "partial" },
    });
    expect(
      streamed.find(({ type }) => type === "result.completed")?.data,
    ).toMatchObject({ status: "partial" });
  });

  it("isolates reflection input failures to one character and still completes a partial result", async () => {
    const initial = lastTurnState("result-input-failure");
    initial.shared.sharedMemories = [
      {
        id: "legacy-haru-only-memory",
        day: 1,
        phase: "",
        title: "旧データの思い出",
        summary: "Haruだけに紐づく移行前の記録",
        emotionalImpact: 1,
        participants: ["haru"],
        importance: 5,
      },
    ];
    const coordinator = new ResultCoordinator();
    const { engine } = await initializedEngine(coordinator, initial);

    const state = await engine.resolveTurn(
      "今日は二人で映画を見よう",
      "final-turn-input-failure",
      27,
    );
    const result = requirePartial(state);

    expect(coordinator.reflectionCalls.map(({ id }) => id)).toEqual(["aoi"]);
    expect(result.reflections.haru).toBeUndefined();
    expect(result.reflections.aoi?.characterId).toBe("aoi");
    expect(result.failures).toContainEqual({
      component: "haru_reflection",
      reason: "Reflection input could not be built from the saved public log",
      retryable: false,
    });
  });

  it("recovers a persisted generating result locally and never repeats external reflections", async () => {
    const firstCoordinator = new ResultCoordinator();
    const { engine: firstEngine } = await initializedEngine(firstCoordinator);
    const terminal = await firstEngine.resolveTurn(
      "今日は二人で映画を見よう",
      "final-turn-resume-fixture",
      27,
    );
    const ready = requireReady(terminal);
    const generating: Extract<GameResult, { status: "generating" }> = {
      generationKey: ready.generationKey,
      endingRevision: ready.endingRevision,
      scoringVersion: ready.scoringVersion,
      narrativeVersion: ready.narrativeVersion,
      reflectionVersion: ready.reflectionVersion,
      status: "generating",
      ending: ready.ending,
      producer: ready.producer,
      startedAt: "2026-07-18T00:00:00.000Z",
    };
    const interruptedState: GameState = { ...terminal, result: generating };

    const resumeCoordinator = new ResultCoordinator();
    const resumeRepository = new RecordingRepository(interruptedState);
    const resumedEngine = new GameEngine(resumeRepository, resumeCoordinator);
    await resumedEngine.initialize();

    const resumed = requirePartial(resumedEngine.getState());
    expect(resumed.generationKey).toBe(ready.generationKey);
    expect(resumeCoordinator.reflectionCalls).toHaveLength(0);
    expect(resumed.reflections.haru?.runtime?.source).toBe("fallback");
    expect(resumed.reflections.aoi?.runtime?.source).toBe("fallback");
    expect(resumed.failures.map(({ component }) => component).sort()).toEqual([
      "aoi_reflection",
      "haru_reflection",
    ]);
    expect(resumed.narrative?.daySections).toHaveLength(7);
    expect(resumeRepository.saves.at(-1)?.result?.status).toBe("partial");

    const noOpCoordinator = new ResultCoordinator();
    const partialRepository = new RecordingRepository(resumedEngine.getState());
    const partialEngine = new GameEngine(partialRepository, noOpCoordinator);
    await partialEngine.initialize();

    expect(partialEngine.getState().result).toEqual(resumed);
    expect(noOpCoordinator.reflectionCalls).toHaveLength(0);
    expect(partialRepository.saves).toHaveLength(0);
  });
});
