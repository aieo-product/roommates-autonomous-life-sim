import { describe, expect, it } from "vitest";
import {
  createInitialGameState,
  type CharacterDecision,
  type GameState,
  type StreamEvent,
} from "@roommates/shared";
import {
  PUBLIC_RESULT_FAILURE_REASONS,
  PUBLIC_STREAM_ERROR_MESSAGE,
  toPublicGameState,
  toPublicStreamEvent,
} from "../src/public-dto.js";

const publicDecision = {
  decision: "MODIFY" as const,
  action: "少しだけ話す",
  dialogue: "短い時間なら話したい。",
  publicReason: "今日は自分のペースを守りたいから",
};

function unsafeState(): GameState {
  const state = createInitialGameState("public-dto-test");
  Object.assign(state.characters.haru, {
    internalSummary: "PRIVATE_CHARACTER_SUMMARY",
    lastDecision: {
      ...publicDecision,
      internalSummary: "PRIVATE_DECISION_SUMMARY",
      expectedEffects: { trust: 3 },
    } satisfies CharacterDecision,
  });
  state.runtime.haru = {
    source: "app_server",
    latencyMs: 42,
    threadId: "PRIVATE_THREAD_ID",
    error: "PRIVATE_RUNTIME_ERROR",
  };
  Object.assign(state, {
    result: {
      status: "partial",
      reflections: {
        haru: {
          characterId: "haru",
          runtime: {
            source: "fallback",
            latencyMs: 17,
            threadId: "PRIVATE_REFLECTION_THREAD",
            error: "PRIVATE_REFLECTION_ERROR",
          },
        },
      },
      failures: [
        {
          component: "haru_reflection",
          reason: "PRIVATE_PROVIDER_FAILURE",
          retryable: true,
          stack: "PRIVATE_FAILURE_STACK",
        },
      ],
    },
  });
  return state;
}

describe("public DTO projection", () => {
  it("removes private state and runtime fields while keeping public result data", () => {
    const state = unsafeState();
    const projected = toPublicGameState(state) as unknown as Record<string, any>;
    const serialized = JSON.stringify(projected);

    expect(projected.characters.haru.lastDecision).toEqual(publicDecision);
    expect(projected.runtime.haru).toEqual({ source: "app_server", latencyMs: 42 });
    expect(projected.result.reflections.haru.runtime).toEqual({
      source: "fallback",
      latencyMs: 17,
    });
    expect(projected.result.failures).toEqual([
      {
        component: "haru_reflection",
        reason: PUBLIC_RESULT_FAILURE_REASONS.haru_reflection,
        retryable: true,
      },
    ]);
    for (const marker of [
      "PRIVATE_CHARACTER_SUMMARY",
      "PRIVATE_DECISION_SUMMARY",
      "PRIVATE_THREAD_ID",
      "PRIVATE_RUNTIME_ERROR",
      "PRIVATE_REFLECTION_THREAD",
      "PRIVATE_REFLECTION_ERROR",
      "PRIVATE_PROVIDER_FAILURE",
      "PRIVATE_FAILURE_STACK",
      "internalSummary",
      "expectedEffects",
      "threadId",
    ]) {
      expect(serialized).not.toContain(marker);
    }

    // Projection must not mutate the authoritative in-memory state.
    expect(state.runtime.haru.threadId).toBe("PRIVATE_THREAD_ID");
  });

  it("keeps agent.completed public fields and removes private decision fields", () => {
    const event = toPublicStreamEvent({
      type: "agent.completed",
      agent: "haru",
      message: "Haru: MODIFY",
      data: {
        ...publicDecision,
        internalSummary: "PRIVATE_SSE_SUMMARY",
        expectedEffects: { trust: 3 },
      },
    });

    expect(event).toEqual({
      type: "agent.completed",
      agent: "haru",
      message: "Haru: MODIFY",
      data: publicDecision,
    });
  });

  it("replaces raw SSE errors with a fixed public message and drops their data", () => {
    const event = toPublicStreamEvent({
      type: "error",
      agent: "director",
      message: "PRIVATE_DATABASE_PATH /private/state.json",
      data: { error: "PRIVATE_STACK", threadId: "PRIVATE_THREAD" },
    } satisfies StreamEvent);

    expect(event).toEqual({
      type: "error",
      agent: "director",
      message: PUBLIC_STREAM_ERROR_MESSAGE,
    });
  });
});
