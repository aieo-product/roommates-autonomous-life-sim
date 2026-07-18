import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHARACTER_SETTINGS,
  createInitialGameState,
  type CharacterDecision,
  type CharacterDecisionInput,
  type DirectorInput,
  type NavigatorInput,
} from "@roommates/shared";
import {
  AgentWorkerClient,
  MAX_AGENT_WORKER_RESPONSE_BYTES,
} from "../src/agents/app-server/remote-client.js";
import type { AgentReflectionInput } from "../src/agents/reflection.js";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";

const REMOTE_BASE_URL = "https://agent.example.test/gateway";
const LOCAL_BASE_URL = "http://127.0.0.1:8788";
const TOKEN = "secret-token";

const decision: CharacterDecision = {
  decision: "ACCEPT",
  action: "一緒に料理をする",
  dialogue: "やってみよう。",
  publicReason: "今なら楽しめそうだから",
  internalSummary: "少し興味がある",
  expectedEffects: {},
};

function inputs(): {
  navigator: NavigatorInput;
  character: CharacterDecisionInput;
  director: DirectorInput;
  reflection: AgentReflectionInput;
} {
  const state = createInitialGameState("remote-client");
  const snapshot = {
    seed: state.seed,
    revision: state.revision,
    characters: {
      haru: state.characters.haru.state,
      aoi: state.characters.aoi.state,
    },
    shared: state.shared,
  };
  const suggestion = sanitizeSuggestion("一緒に料理をしよう");
  return {
    navigator: {
      turnId: "turn-1",
      rawInput: "一緒に料理をしよう",
      day: 1,
      phase: "morning",
      resolvedSuggestion: suggestion,
    },
    character: {
      turnId: "turn-1",
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
      suggestion,
    },
    director: {
      turnId: "turn-1",
      snapshot,
      suggestion,
      haruDecision: decision,
      aoiDecision: decision,
    },
    reflection: {
      characterId: "haru",
      finalRelationship: state.shared.relationshipLabel,
      ending: null,
      selfFinalState: state.characters.haru.state,
      sharedEvents: [],
      selfMemories: [],
      highlightEventLogIds: [],
    },
  };
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("expected a JSON body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function successfulInvoke(value: unknown = {}): Response {
  return new Response(JSON.stringify({ value, threadId: "thread-1" }));
}

function readyFetch(invokeImpl: typeof fetch) {
  return vi.fn<typeof fetch>(async (input, init) => {
    if (init?.method === "GET") {
      return new Response(JSON.stringify({ ok: true }));
    }
    return invokeImpl(input, init);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentWorkerClient", () => {
  it.each([
    "http://localhost:8788",
    "http://127.0.0.1:8788",
    "http://[::1]:8788",
    "https://localhost:8788",
  ])("permits a token-free loopback URL: %s", (baseUrl) => {
    expect(
      () => new AgentWorkerClient({ baseUrl, sessionId: "session-123" }),
    ).not.toThrow();
  });

  it.each([
    "http://agent.example.test",
    "http://127.0.0.2:8788",
    "ftp://agent.example.test",
  ])("rejects a non-HTTPS, non-loopback URL: %s", (baseUrl) => {
    expect(
      () =>
        new AgentWorkerClient({
          baseUrl,
          sessionId: "session-123",
          token: TOKEN,
        }),
    ).toThrow("must use HTTPS");
  });

  it.each([
    "https://user@agent.example.test",
    "https://user:password@agent.example.test",
    "http://user@localhost:8788",
  ])("rejects URL userinfo: %s", (baseUrl) => {
    expect(
      () =>
        new AgentWorkerClient({
          baseUrl,
          sessionId: "session-123",
          token: TOKEN,
        }),
    ).toThrow("must not contain userinfo");
  });

  it("requires a token for every non-loopback URL", () => {
    expect(
      () =>
        new AgentWorkerClient({
          baseUrl: "https://agent.example.test",
          sessionId: "session-123",
        }),
    ).toThrow("token is required for non-loopback URLs");
  });

  it("probes readiness once, then sends every operation with auth and idempotency", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: requestUrl(input), init });
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ ok: true }));
      }
      const payload = requestBody(init);
      return successfulInvoke({ operation: payload.operation });
    };
    const client = new AgentWorkerClient({
      baseUrl: REMOTE_BASE_URL,
      sessionId: "session-123",
      token: TOKEN,
      fetchImpl,
    });
    const input = inputs();

    await client.navigate(input.navigator);
    await client.decide("haru", input.character);
    await client.resolve(input.director);
    await client.reflect("haru", input.reflection);

    const probes = requests.filter((request) => request.init?.method === "GET");
    const invokes = requests.filter((request) => request.init?.method === "POST");
    expect(probes).toHaveLength(1);
    expect(probes[0]?.url).toBe("https://agent.example.test/gateway/health");
    expect(new Headers(probes[0]?.init?.headers).get("Authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(invokes.map((request) => request.url)).toEqual(
      Array(4).fill("https://agent.example.test/gateway/v1/invoke"),
    );
    expect(invokes.map((request) => requestBody(request.init))).toEqual([
      {
        operation: "navigate",
        sessionId: "session-123",
        input: input.navigator,
      },
      {
        operation: "decide",
        characterId: "haru",
        sessionId: "session-123",
        input: input.character,
      },
      {
        operation: "resolve",
        sessionId: "session-123",
        input: input.director,
      },
      {
        operation: "reflect",
        characterId: "haru",
        sessionId: "session-123",
        input: input.reflection,
      },
    ]);
    expect(
      invokes.map((request) =>
        new Headers(request.init?.headers).get("Authorization"),
      ),
    ).toEqual(Array(4).fill(`Bearer ${TOKEN}`));
    expect(
      invokes.map((request) =>
        new Headers(request.init?.headers).get("Idempotency-Key"),
      ),
    ).toEqual([
      "session-123:turn-1:navigate:-",
      "session-123:turn-1:decide:haru",
      "session-123:turn-1:resolve:-",
      expect.stringMatching(/^session-123:reflect:haru:[0-9a-f]{64}$/),
    ]);
  });

  it("sends a reset-specific conversation scope without changing the public session", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const keys: Array<string | null> = [];
    const fetchImpl = readyFetch(async (_input, init) => {
      bodies.push(requestBody(init));
      keys.push(new Headers(init?.headers).get("Idempotency-Key"));
      return successfulInvoke();
    });
    const client = new AgentWorkerClient({
      baseUrl: REMOTE_BASE_URL,
      sessionId: "session-123",
      scopeId: "session-123:4",
      token: TOKEN,
      fetchImpl,
    });

    await client.navigate(inputs().navigator);

    expect(bodies[0]).toMatchObject({
      sessionId: "session-123",
      scopeId: "session-123:4",
      operation: "navigate",
    });
    expect(keys[0]).toBe("session-123_4:turn-1:navigate:-");
  });

  it("shares one in-flight readiness probe between concurrent operations", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "GET") {
        await gate;
        return new Response(JSON.stringify({ ok: true }));
      }
      return successfulInvoke();
    });
    const client = new AgentWorkerClient({
      baseUrl: REMOTE_BASE_URL,
      sessionId: "session-123",
      token: TOKEN,
      fetchImpl,
    });
    const input = inputs();

    const pending = Promise.all([
      client.navigate(input.navigator),
      client.resolve(input.director),
    ]);
    await vi.waitFor(() => {
      expect(
        fetchImpl.mock.calls.filter(([, init]) => init?.method === "GET"),
      ).toHaveLength(1);
    });
    release();
    await pending;

    expect(
      fetchImpl.mock.calls.filter(([, init]) => init?.method === "GET"),
    ).toHaveLength(1);
    expect(
      fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(2);
  });

  it("derives a stable reflection idempotency key from the input", async () => {
    const keys: Array<string | null> = [];
    const fetchImpl = readyFetch(async (_input, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key"));
      return successfulInvoke();
    });
    const client = new AgentWorkerClient({
      baseUrl: REMOTE_BASE_URL,
      sessionId: "session-123",
      token: TOKEN,
      fetchImpl,
    });
    const reflection = inputs().reflection;
    const changed = structuredClone(reflection);
    changed.selfFinalState.mood = "別の気分";

    await client.reflect("haru", reflection);
    await client.reflect("haru", structuredClone(reflection));
    await client.reflect("haru", changed);

    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("omits Authorization for a token-free loopback probe and invoke", async () => {
    const authorizations: Array<string | null> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      authorizations.push(new Headers(init?.headers).get("Authorization"));
      return init?.method === "GET"
        ? new Response(JSON.stringify({ ok: true }))
        : successfulInvoke();
    };
    const client = new AgentWorkerClient({
      baseUrl: LOCAL_BASE_URL,
      sessionId: "session-123",
      fetchImpl,
    });

    await client.navigate(inputs().navigator);

    expect(authorizations).toEqual([null, null]);
  });

  it.each([
    ["HTTP failure", () => new Response(null, { status: 503 }), "returned HTTP 503"],
    ["invalid JSON", () => new Response("not-json"), "returned invalid JSON"],
    [
      "not-ready envelope",
      () => new Response(JSON.stringify({ ok: false })),
      "returned an invalid response",
    ],
  ])(
    "opens the circuit when the readiness probe has %s",
    async (_label, response, message) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => response());
      const client = new AgentWorkerClient({
        baseUrl: REMOTE_BASE_URL,
        sessionId: "session-123",
        token: TOKEN,
        fetchImpl,
      });

      await expect(client.navigate(inputs().navigator)).rejects.toThrow(message);
      await expect(client.resolve(inputs().director)).rejects.toThrow(message);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("aborts a timed-out readiness probe and keeps its circuit open", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const client = new AgentWorkerClient({
      baseUrl: REMOTE_BASE_URL,
      sessionId: "session-123",
      token: TOKEN,
      fetchImpl,
      probeTimeoutMs: 25,
      timeoutMs: 1_000,
    });

    const result = expect(client.navigate(inputs().navigator)).rejects.toThrow(
      "readiness probe timed out after 25ms",
    );
    await vi.advanceTimersByTimeAsync(25);

    await result;
    expect(signal?.aborted).toBe(true);
    await expect(client.resolve(inputs().director)).rejects.toThrow(
      "readiness probe timed out after 25ms",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("half-opens the readiness circuit after the retry cooldown", async () => {
    vi.useFakeTimers();
    let healthCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "GET") {
        healthCalls += 1;
        return healthCalls === 1
          ? new Response(null, { status: 503 })
          : new Response(JSON.stringify({ ok: true }));
      }
      return successfulInvoke();
    });
    const client = new AgentWorkerClient({
      baseUrl: REMOTE_BASE_URL,
      sessionId: "session-123",
      token: TOKEN,
      fetchImpl,
      retryAfterMs: 25,
    });

    await expect(client.navigate(inputs().navigator)).rejects.toThrow(
      "readiness probe returned HTTP 503",
    );
    await expect(client.navigate(inputs().navigator)).rejects.toThrow(
      "readiness probe returned HTTP 503",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(25);
    await expect(client.navigate(inputs().navigator)).resolves.toMatchObject({
      threadId: "thread-1",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("opens the circuit after an invalid invoke JSON response", async () => {
    const fetchImpl = readyFetch(async () => new Response("not-json"));
    const client = new AgentWorkerClient({
      baseUrl: REMOTE_BASE_URL,
      sessionId: "session-123",
      token: TOKEN,
      fetchImpl,
    });

    await expect(client.navigate(inputs().navigator)).rejects.toThrow(
      "Agent Worker returned invalid JSON",
    );
    await expect(client.resolve(inputs().director)).rejects.toThrow(
      "Agent Worker returned invalid JSON",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 429, 500, 503, 504])(
    "opens the invoke circuit after HTTP %i",
    async (status) => {
      const fetchImpl = readyFetch(
        async () => new Response("unavailable", { status }),
      );
      const client = new AgentWorkerClient({
        baseUrl: REMOTE_BASE_URL,
        sessionId: "session-123",
        token: TOKEN,
        fetchImpl,
      });

      await expect(client.navigate(inputs().navigator)).rejects.toThrow(
        `Agent Worker returned HTTP ${status}`,
      );
      await expect(client.resolve(inputs().director)).rejects.toThrow(
        `Agent Worker returned HTTP ${status}`,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  it.each([400, 409, 502])(
    "keeps the invoke circuit available after role-specific HTTP %i",
    async (status) => {
      const fetchImpl = readyFetch(
        async () => new Response("request failed", { status }),
      );
      const client = new AgentWorkerClient({
        baseUrl: REMOTE_BASE_URL,
        sessionId: "session-123",
        token: TOKEN,
        fetchImpl,
      });

      await expect(client.navigate(inputs().navigator)).rejects.toThrow(
        `Agent Worker returned HTTP ${status}`,
      );
      await expect(client.resolve(inputs().director)).rejects.toThrow(
        `Agent Worker returned HTTP ${status}`,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    {},
    { value: {} },
    { value: {}, threadId: "" },
    { threadId: "thread-1" },
  ])("throws for an invalid invoke response envelope %#", async (envelope) => {
    const fetchImpl = readyFetch(
      async () => new Response(JSON.stringify(envelope)),
    );
    const client = new AgentWorkerClient({
      baseUrl: REMOTE_BASE_URL,
      sessionId: "session-123",
      token: TOKEN,
      fetchImpl,
    });

    await expect(client.navigate(inputs().navigator)).rejects.toThrow(
      "Agent Worker returned an invalid response envelope",
    );
  });

  it("stops reading an invoke response above the 256 KB hard limit", async () => {
    const oversized = JSON.stringify({
      value: { text: "x".repeat(MAX_AGENT_WORKER_RESPONSE_BYTES) },
      threadId: "thread-1",
    });
    const fetchImpl = readyFetch(async () => new Response(oversized));
    const client = new AgentWorkerClient({
      baseUrl: REMOTE_BASE_URL,
      sessionId: "session-123",
      token: TOKEN,
      fetchImpl,
    });

    await expect(client.navigate(inputs().navigator)).rejects.toThrow(
      `Agent Worker response exceeded ${MAX_AGENT_WORKER_RESPONSE_BYTES} bytes`,
    );
  });

  it("keeps the public operation timeout separate from readiness", async () => {
    vi.useFakeTimers();
    let operationSignal: AbortSignal | undefined;
    const fetchImpl = readyFetch(async (_input, init) => {
      operationSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const client = new AgentWorkerClient({
      baseUrl: REMOTE_BASE_URL,
      sessionId: "session-123",
      token: TOKEN,
      fetchImpl,
      probeTimeoutMs: 10,
      timeoutMs: 25,
    });

    const result = expect(client.navigate(inputs().navigator)).rejects.toThrow(
      "Agent Worker request timed out after 25ms",
    );
    await vi.advanceTimersByTimeAsync(25);

    await result;
    expect(operationSignal?.aborted).toBe(true);
    await expect(client.resolve(inputs().director)).rejects.toThrow(
      "Agent Worker request timed out after 25ms",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
