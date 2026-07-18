import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHARACTER_SETTINGS,
  createInitialGameState,
  type CharacterDecisionInput,
} from "@roommates/shared";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";
import { createWorkerAgentCoordinator } from "../src/worker.js";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

function characterInput(): CharacterDecisionInput {
  const state = createInitialGameState("worker-agent-runtime");
  const snapshot = {
    seed: state.seed,
    revision: state.revision,
    characters: {
      haru: state.characters.haru.state,
      aoi: state.characters.aoi.state,
    },
    shared: state.shared,
  };
  return {
    turnId: "1-morning-1-runtime",
    characterId: "haru",
    character: structuredClone(DEFAULT_CHARACTER_SETTINGS.characters.haru),
    snapshot,
    self: snapshot.characters.haru,
    otherKnownInfo: {
      mood: snapshot.characters.aoi.mood,
      location: snapshot.characters.aoi.location,
      currentGoal: snapshot.characters.aoi.currentGoal,
    },
    recentMemories: [],
    importantMemories: [],
    suggestion: sanitizeSuggestion("一緒に料理をしよう"),
  };
}

function appServerResponse() {
  return {
    value: {
      decision: "ACCEPT",
      action: "一緒に料理をする",
      dialogue: "やってみよう。",
      publicReason: "今なら楽しめそうだから",
      internalSummary: "少し興味がある",
      expectedEffects: {},
    },
    threadId: "remote-haru-thread",
  };
}

describe("public Worker Agent Worker runtime", () => {
  it("does not contact Agent Worker when its URL is not configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const coordinator = createWorkerAgentCoordinator(
      SESSION_ID,
      undefined,
      fetchImpl,
    );

    const result = await coordinator.decide("haru", characterInput());

    expect(result.runtime.source).toBe("mock");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses authenticated Agent Worker output when the gateway is available", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer worker-secret",
      );
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ ok: true }));
      }
      expect(JSON.parse(String(init?.body))).toMatchObject({
        sessionId: SESSION_ID,
        operation: "decide",
        characterId: "haru",
      });
      return new Response(JSON.stringify(appServerResponse()));
    });
    const coordinator = createWorkerAgentCoordinator(
      SESSION_ID,
      {
        AGENT_WORKER_URL: "https://agent.example.test",
        AGENT_WORKER_TOKEN: "worker-secret",
      },
      fetchImpl,
    );

    const result = await coordinator.decide("haru", characterInput());

    expect(result.runtime).toMatchObject({
      source: "app_server",
      threadId: "remote-haru-thread",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back while unavailable and retries after a new turn coordinator is created", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(appServerResponse())),
      );
    const env = {
      AGENT_WORKER_URL: "https://agent.example.test",
      AGENT_WORKER_TOKEN: "worker-secret",
      AGENT_WORKER_TIMEOUT_MS: "1000",
    };

    const unavailable = createWorkerAgentCoordinator(
      SESSION_ID,
      env,
      fetchImpl,
    );
    const fallback = await unavailable.decide("haru", characterInput());
    expect(fallback.runtime.source).toBe("fallback");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const recovered = createWorkerAgentCoordinator(
      SESSION_ID,
      env,
      fetchImpl,
    );
    const live = await recovered.decide("haru", characterInput());
    expect(live.runtime.source).toBe("app_server");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("derives a new remote conversation scope from the persisted agent epoch", async () => {
    const scopes: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ ok: true }));
      }
      const body = JSON.parse(String(init?.body)) as { scopeId?: string };
      if (body.scopeId) scopes.push(body.scopeId);
      return new Response(JSON.stringify(appServerResponse()));
    });
    const env = {
      AGENT_WORKER_URL: "https://agent.example.test",
      AGENT_WORKER_TOKEN: "worker-secret",
    };

    await createWorkerAgentCoordinator(
      SESSION_ID,
      env,
      fetchImpl,
      4,
    ).decide("haru", characterInput());
    await createWorkerAgentCoordinator(
      SESSION_ID,
      env,
      fetchImpl,
      5,
    ).decide("haru", characterInput());

    expect(scopes).toEqual([`${SESSION_ID}:4`, `${SESSION_ID}:5`]);
  });
});
