import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHARACTER_SETTINGS,
  createInitialGameState,
  type CharacterDecisionInput,
} from "@roommates/shared";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";
import { createWorkerAgentCoordinator } from "../src/worker.js";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

afterEach(() => vi.restoreAllMocks());

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

function openAiResponse() {
  return new Response(
    JSON.stringify({
      id: "resp_worker_fallback",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                decision: "ACCEPT",
                action: "OpenAIと一緒に料理をする",
                dialogue: "やってみよう。",
                publicReason: "今なら楽しめそうだから",
                internalSummary: "少し興味がある",
                expectedEffects: {},
                initiative: null,
              }),
            },
          ],
        },
      ],
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

function fetchUrl(input: Parameters<typeof fetch>[0]): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input));
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

  it("uses Agent Worker first and does not send a configured OpenAI key", async () => {
    const openAiApiKey = "sk-test-must-not-reach-agent-worker";
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = fetchUrl(input);
      expect(url.origin).toBe("https://agent.example.test");
      const authorization = new Headers(init?.headers).get("Authorization");
      expect(authorization).toBe("Bearer worker-secret");
      expect(authorization).not.toContain(openAiApiKey);
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify(appServerResponse()));
    });
    const coordinator = createWorkerAgentCoordinator(
      SESSION_ID,
      {
        AGENT_WORKER_URL: "https://agent.example.test",
        AGENT_WORKER_TOKEN: "worker-secret",
        OPENAI_API_KEY: openAiApiKey,
      },
      fetchImpl,
    );

    const result = await coordinator.decide("haru", characterInput());

    expect(result.runtime.source).toBe("app_server");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses OpenAI directly when Agent Worker is not configured", async () => {
    const openAiApiKey = "sk-test-direct-openai";
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = fetchUrl(input);
      expect(url.toString()).toBe("https://api.openai.com/v1/responses");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${openAiApiKey}`,
      );
      expect(String(init?.body)).not.toContain(openAiApiKey);
      return openAiResponse();
    });
    const coordinator = createWorkerAgentCoordinator(
      SESSION_ID,
      { OPENAI_API_KEY: openAiApiKey },
      fetchImpl,
    );

    const result = await coordinator.decide("haru", characterInput());

    expect(result.runtime.source).toBe("openai_api");
    expect(result.value.action).toBe("OpenAIと一緒に料理をする");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cascades from an unavailable Agent Worker to OpenAI in the same call", async () => {
    const openAiApiKey = "sk-test-worker-to-openai";
    const origins: string[] = [];
    let agentWorkerAvailable = false;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = fetchUrl(input);
      origins.push(url.origin);
      if (url.origin === "https://agent.example.test") {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer worker-secret",
        );
        if (!agentWorkerAvailable) {
          return new Response(null, { status: 503 });
        }
        return init?.method === "GET"
          ? new Response(JSON.stringify({ ok: true }))
          : new Response(JSON.stringify(appServerResponse()));
      }
      expect(url.toString()).toBe("https://api.openai.com/v1/responses");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${openAiApiKey}`,
      );
      return openAiResponse();
    });
    const coordinator = createWorkerAgentCoordinator(
      SESSION_ID,
      {
        AGENT_WORKER_URL: "https://agent.example.test",
        AGENT_WORKER_TOKEN: "worker-secret",
        OPENAI_API_KEY: openAiApiKey,
      },
      fetchImpl,
    );

    const result = await coordinator.decide("haru", characterInput());

    expect(result.runtime.source).toBe("openai_api");
    expect(origins).toEqual([
      "https://agent.example.test",
      "https://api.openai.com",
    ]);

    agentWorkerAvailable = true;
    const nextTurn = createWorkerAgentCoordinator(
      SESSION_ID,
      {
        AGENT_WORKER_URL: "https://agent.example.test",
        AGENT_WORKER_TOKEN: "worker-secret",
        OPENAI_API_KEY: openAiApiKey,
      },
      fetchImpl,
      1,
    );
    const recovered = await nextTurn.decide("haru", characterInput());

    expect(recovered.runtime.source).toBe("app_server");
    expect(origins).toEqual([
      "https://agent.example.test",
      "https://api.openai.com",
      "https://agent.example.test",
      "https://agent.example.test",
    ]);
  });

  it("cascades to OpenAI when Agent Worker returns invalid structured output", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = fetchUrl(input);
      if (url.origin === "https://agent.example.test") {
        if (init?.method === "GET") {
          return new Response(JSON.stringify({ ok: true }));
        }
        return new Response(
          JSON.stringify({
            value: { decision: "NOT_VALID" },
            threadId: "invalid-agent-worker-thread",
          }),
        );
      }
      return openAiResponse();
    });
    const coordinator = createWorkerAgentCoordinator(
      SESSION_ID,
      {
        AGENT_WORKER_URL: "https://agent.example.test",
        AGENT_WORKER_TOKEN: "worker-secret",
        OPENAI_API_KEY: "sk-test-invalid-worker-output",
      },
      fetchImpl,
    );

    const result = await coordinator.decide("haru", characterInput());

    expect(result.runtime.source).toBe("openai_api");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(warning).toHaveBeenCalledWith(
      JSON.stringify({
        message: "ROOMMATES agent provider failed",
        source: "app_server",
        kind: "invalid_structured_output",
      }),
    );
  });

  it("uses the deterministic mock when both configured providers fail", async () => {
    const openAiApiKey = "sk-test-never-expose-this";
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = fetchUrl(input);
      if (url.origin === "https://agent.example.test") {
        return new Response(null, { status: 503 });
      }
      return new Response("upstream secret response body", { status: 500 });
    });
    const coordinator = createWorkerAgentCoordinator(
      SESSION_ID,
      {
        AGENT_WORKER_URL: "https://agent.example.test",
        AGENT_WORKER_TOKEN: "worker-secret",
        OPENAI_API_KEY: openAiApiKey,
      },
      fetchImpl,
    );

    const result = await coordinator.decide("haru", characterInput());

    expect(result.runtime.source).toBe("fallback");
    expect(result.value.decision).toMatch(/ACCEPT|DECLINE|MODIFY|IGNORE|INITIATE/);
    expect(result.runtime.error).toBe(
      "Configured agent providers are unavailable: app_server, openai_api",
    );
    expect(JSON.stringify(result)).not.toContain(openAiApiKey);
    expect(JSON.stringify(result)).not.toContain("upstream secret response body");
    const diagnostics = warning.mock.calls.map(([message]) => String(message));
    expect(diagnostics).toContain(
      JSON.stringify({
        message: "ROOMMATES agent provider failed",
        source: "app_server",
        kind: "provider_error",
      }),
    );
    expect(diagnostics).toContain(
      JSON.stringify({
        message: "ROOMMATES agent provider failed",
        source: "openai_api",
        kind: "provider_error",
        httpStatus: 500,
      }),
    );
    expect(diagnostics.join("\n")).not.toContain(openAiApiKey);
    expect(diagnostics.join("\n")).not.toContain("worker-secret");
    expect(diagnostics.join("\n")).not.toContain("upstream secret response body");
  });

  it("keeps falling back when the diagnostic logger fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("logging unavailable");
    });
    const coordinator = createWorkerAgentCoordinator(
      SESSION_ID,
      { OPENAI_API_KEY: "sk-test-logger-failure" },
      vi.fn<typeof fetch>(async () => new Response(null, { status: 429 })),
    );

    const result = await coordinator.decide("haru", characterInput());

    expect(result.runtime.source).toBe("fallback");
  });

  it("logs only a safe category for a Cloudflare fetch invocation failure", async () => {
    const openAiApiKey = "sk-test-cloudflare-fetch-secret";
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const coordinator = createWorkerAgentCoordinator(
      SESSION_ID,
      { OPENAI_API_KEY: openAiApiKey },
      vi.fn<typeof fetch>(async () => {
        throw new TypeError(`Illegal invocation: ${openAiApiKey}`);
      }),
    );

    const result = await coordinator.decide("haru", characterInput());

    expect(result.runtime.source).toBe("fallback");
    expect(warning).toHaveBeenCalledWith(
      JSON.stringify({
        message: "ROOMMATES agent provider failed",
        source: "openai_api",
        kind: "provider_error",
        failureCategory: "illegal_invocation",
      }),
    );
    expect(warning.mock.calls.flat().join("\n")).not.toContain(openAiApiKey);
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
