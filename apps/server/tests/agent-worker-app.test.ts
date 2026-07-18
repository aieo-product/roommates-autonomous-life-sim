import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  DEFAULT_CHARACTER_SETTINGS,
  createInitialGameState,
  type CharacterDecision,
  type CharacterDecisionInput,
  type DirectorInput,
  type NavigatorInput,
} from "@roommates/shared";
import {
  createAgentWorkerApp,
  type AgentWorkerClient,
} from "../src/agent-worker-app.js";
import {
  readAgentWorkerSettings,
  resolveAgentWorkerCwd,
} from "../src/agent-worker.js";
import type { AppServerAdapter } from "../src/agents/coordinator.js";
import {
  buildAgentReflectionInput,
  fallbackAgentReflection,
} from "../src/agents/reflection.js";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = "test-agent-worker-token";

const decision: CharacterDecision = {
  decision: "ACCEPT",
  action: "リビングで話す",
  dialogue: "少し話そうか。",
  publicReason: "落ち着いて話せそうだから",
  internalSummary: "会話したい",
  expectedEffects: {},
};

function navigatorInput(): NavigatorInput {
  return {
    turnId: "1-morning-1-test",
    rawInput: "二人で話してみて",
    day: 1,
    phase: "morning",
    resolvedSuggestion: sanitizeSuggestion("二人で話してみて"),
  };
}

function characterInput(): CharacterDecisionInput {
  const state = createInitialGameState("agent-worker-test");
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
    turnId: "1-morning-1-test",
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
    suggestion: sanitizeSuggestion("二人で話してみて"),
  };
}

function directorInput(): DirectorInput {
  const character = characterInput();
  return {
    turnId: character.turnId,
    snapshot: character.snapshot,
    suggestion: character.suggestion,
    haruDecision: structuredClone(decision),
    aoiDecision: structuredClone(decision),
  };
}

function resolvedEvent() {
  return {
    eventTitle: "リビングの会話",
    narration: "二人はリビングで言葉を交わした。",
    haruDialogue: "少し話そうか。",
    aoiDialogue: "うん、そうしよう。",
    conversation: [
      { speaker: "haru" as const, text: "少し話そうか。" },
      { speaker: "aoi" as const, text: "うん、そうしよう。" },
      { speaker: "haru" as const, text: "今日はどんな一日だった？" },
    ],
    storyBeats: [
      { kind: "move" as const, actor: "both" as const, location: "リビング" },
      { kind: "dialogue" as const, actor: "haru" as const, text: "少し話そうか。" },
      { kind: "dialogue" as const, actor: "aoi" as const, text: "うん、そうしよう。" },
      { kind: "action" as const, actor: "both" as const, action: "ソファに腰掛ける" },
      { kind: "dialogue" as const, actor: "haru" as const, text: "今日はどんな一日だった？" },
    ],
    effects: { haru: {}, aoi: {} },
    memory: {
      title: "リビングの会話",
      summary: "二人が穏やかに話した",
      emotionalImpact: 1,
      importance: 2,
    },
    scene: { haru: "リビング", aoi: "リビング" },
    conflictUpdate: { add: [], resolve: [] },
  };
}

function maximumNormalReflectionInput() {
  const short = "あ".repeat(600);
  const long = "あ".repeat(2_000);
  const eventIds = Array.from({ length: 28 }, (_, index) => `event-${index}`);
  return {
    characterId: "haru" as const,
    finalRelationship: "roommates" as const,
    ending: {
      kind: "roommates" as const,
      title: short,
      narration: long,
    },
    selfFinalState: {
      energy: 50,
      stress: 50,
      affection: 50,
      trust: 50,
      romanticAwareness: 50,
      mood: short,
      location: short,
      currentGoal: short,
    },
    sharedEvents: eventIds.map((eventLogId, index) => ({
      eventLogId,
      day: (index % 7) + 1,
      phase: "night" as const,
      eventDefinitionId: `definition-${index}`,
      eventTitle: short,
      narration: long,
      relationshipBefore: "roommates" as const,
      relationshipAfter: "roommates" as const,
      selfDecision: "ACCEPT" as const,
      selfAction: short,
      selfDialogue: long,
      selfPublicReason: short,
      memoryId: `memory-${index}`,
    })),
    selfMemories: eventIds.map((_eventLogId, index) => ({
      memoryId: `memory-${index}`,
      sourceEventLogId: `event-${index}`,
      day: (index % 7) + 1,
      phase: "night",
      title: short,
      summary: long,
    })),
    highlightEventLogIds: eventIds.slice(0, 4),
  };
}

function createFixture(overrides: Partial<AppServerAdapter> = {}) {
  const reflectionInput = buildAgentReflectionInput(
    createInitialGameState("agent-worker-reflection"),
    "haru",
    [],
  );
  const adapter: AppServerAdapter = {
    navigate: vi.fn(async () => ({
      value: { message: "会話のきっかけを二人へ届けるね。" },
      threadId: "navigator-thread",
    })),
    decide: vi.fn(async () => ({
      value: structuredClone(decision),
      threadId: "haru-thread",
    })),
    resolve: vi.fn(async () => ({
      value: resolvedEvent(),
      threadId: "director-thread",
    })),
    reflect: vi.fn(async (_id, input) => ({
      value: fallbackAgentReflection(input),
      threadId: "reflection-thread",
    })),
    shutdown: vi.fn(async () => undefined),
    ...overrides,
  };
  const client: AgentWorkerClient = {
    ready: vi.fn(async () => undefined),
    scope: vi.fn(() => adapter),
    shutdown: vi.fn(async () => undefined),
  };
  return { adapter, client, reflectionInput };
}

function invoke(app: Express, body: object, key?: string) {
  const pending = request(app)
    .post("/v1/invoke")
    .set("Authorization", `Bearer ${TOKEN}`);
  if (key) pending.set("Idempotency-Key", key);
  return pending.send(body);
}

describe("AgentWorker HTTP gateway", () => {
  it("requires its bearer token and reports App Server readiness", async () => {
    const { client } = createFixture();
    const runtime = createAgentWorkerApp({ client, token: TOKEN });

    await request(runtime.app).get("/health").expect(401);
    await request(runtime.app)
      .get("/health")
      .set("Authorization", "Bearer wrong")
      .expect(401);
    const health = await request(runtime.app)
      .get("/health")
      .set("Authorization", `Bearer ${TOKEN}`)
      .expect(200);

    expect(health.body).toEqual({
      ok: true,
      service: "roommates-agent-worker",
    });
    expect(client.ready).toHaveBeenCalledTimes(1);
  });

  it("marks every response as non-cacheable", async () => {
    const { client } = createFixture();
    const runtime = createAgentWorkerApp({ client, token: TOKEN });

    const unauthorized = await request(runtime.app).get("/health").expect(401);
    const healthy = await request(runtime.app)
      .get("/health")
      .set("Authorization", `Bearer ${TOKEN}`)
      .expect(200);
    const invalid = await invoke(runtime.app, {}).expect(400);
    const missing = await request(runtime.app)
      .get("/missing")
      .set("Authorization", `Bearer ${TOKEN}`)
      .expect(404);

    for (const response of [unauthorized, healthy, invalid, missing]) {
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("allows token-free development only over loopback", async () => {
    const { client } = createFixture();
    const runtime = createAgentWorkerApp({ client });

    await request(runtime.app).get("/health").expect(200);
    expect(() =>
      createAgentWorkerApp({ client, requireToken: true }),
    ).toThrow("AGENT_WORKER_TOKEN is required");
  });

  it("routes and validates all four scoped operations", async () => {
    const { adapter, client, reflectionInput } = createFixture();
    const runtime = createAgentWorkerApp({ client, token: TOKEN });

    const navigator = await invoke(runtime.app, {
      sessionId: SESSION_ID,
      operation: "navigate",
      input: navigatorInput(),
    }).expect(200);
    const character = await invoke(runtime.app, {
      sessionId: SESSION_ID,
      operation: "decide",
      characterId: "haru",
      input: characterInput(),
    }).expect(200);
    const director = await invoke(runtime.app, {
      sessionId: SESSION_ID,
      operation: "resolve",
      input: directorInput(),
    }).expect(200);
    const reflection = await invoke(runtime.app, {
      sessionId: SESSION_ID,
      operation: "reflect",
      characterId: "haru",
      input: reflectionInput,
    }).expect(200);

    expect(navigator.body).toMatchObject({
      value: { message: expect.any(String) },
      threadId: "navigator-thread",
    });
    expect(character.body).toMatchObject({
      value: { decision: "ACCEPT" },
      threadId: "haru-thread",
    });
    expect(director.body).toMatchObject({
      value: { conversation: expect.any(Array) },
      threadId: "director-thread",
    });
    expect(reflection.body).toMatchObject({
      value: { characterId: "haru", reflectionVersion: "reflection-v1" },
      threadId: "reflection-thread",
    });
    expect(client.scope).toHaveBeenCalledTimes(4);
    expect(client.scope).toHaveBeenCalledWith(SESSION_ID);
    expect(adapter.navigate).toHaveBeenCalledTimes(1);
    expect(adapter.decide).toHaveBeenCalledTimes(1);
    expect(adapter.resolve).toHaveBeenCalledTimes(1);
    expect(adapter.reflect).toHaveBeenCalledTimes(1);
  });

  it("isolates reset generations by scope, including idempotency entries", async () => {
    const { adapter, client } = createFixture();
    const runtime = createAgentWorkerApp({ client, token: TOKEN });
    const body = {
      sessionId: SESSION_ID,
      operation: "decide",
      characterId: "haru",
      input: characterInput(),
    };

    await invoke(
      runtime.app,
      { ...body, scopeId: "game:before-reset" },
      "same-turn-key",
    ).expect(200);
    await invoke(
      runtime.app,
      { ...body, scopeId: "game:after-reset" },
      "same-turn-key",
    ).expect(200);

    expect(client.scope).toHaveBeenNthCalledWith(1, "game:before-reset");
    expect(client.scope).toHaveBeenNthCalledWith(2, "game:after-reset");
    expect(adapter.decide).toHaveBeenCalledTimes(2);

    await invoke(runtime.app, {
      ...body,
      scopeId: "spaces are not allowed",
    }).expect(400);
    expect(adapter.decide).toHaveBeenCalledTimes(2);
  });

  it("accepts the largest normal 28-turn reflection payload under 1MiB", async () => {
    const { client } = createFixture();
    const runtime = createAgentWorkerApp({ client, token: TOKEN });
    const body = {
      sessionId: SESSION_ID,
      operation: "reflect",
      characterId: "haru",
      input: maximumNormalReflectionInput(),
    };
    const bytes = Buffer.byteLength(JSON.stringify(body));

    expect(bytes).toBeGreaterThan(256 * 1024);
    expect(bytes).toBeLessThan(1024 * 1024);
    await invoke(runtime.app, body).expect(200);
  });

  it("rejects invalid sessions and mismatched character envelopes", async () => {
    const { adapter, client } = createFixture();
    const runtime = createAgentWorkerApp({ client, token: TOKEN });

    await invoke(runtime.app, {
      sessionId: "not-a-session",
      operation: "navigate",
      input: navigatorInput(),
    }).expect(400);
    const mismatch = await invoke(runtime.app, {
      sessionId: SESSION_ID,
      operation: "decide",
      characterId: "aoi",
      input: characterInput(),
    }).expect(400);

    expect(mismatch.body.error.code).toBe("CHARACTER_MISMATCH");
    expect(adapter.navigate).not.toHaveBeenCalled();
    expect(adapter.decide).not.toHaveBeenCalled();
  });

  it("rejects invalid App Server output without exposing it", async () => {
    const decide = vi.fn(async () => ({
      value: { decision: "PRIVATE_INVALID_OUTPUT" },
      threadId: "bad-thread",
    }));
    const { client } = createFixture({ decide });
    const runtime = createAgentWorkerApp({ client, token: TOKEN });

    const response = await invoke(runtime.app, {
      sessionId: SESSION_ID,
      operation: "decide",
      characterId: "haru",
      input: characterInput(),
    }).expect(502);

    expect(response.body).toEqual({
      error: {
        code: "INVALID_APP_SERVER_RESPONSE",
        message: "Agent runtime returned an invalid response",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE_INVALID_OUTPUT");
  });

  it("shares an in-flight and successful result for one idempotency key", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decide = vi.fn(async () => {
      await gate;
      return { value: structuredClone(decision), threadId: "once-thread" };
    });
    const { client } = createFixture({ decide });
    const runtime = createAgentWorkerApp({ client, token: TOKEN });
    const body = {
      sessionId: SESSION_ID,
      operation: "decide",
      characterId: "haru",
      input: characterInput(),
    };

    const first = invoke(runtime.app, body, "same-turn-haru");
    const duplicate = invoke(runtime.app, body, "same-turn-haru");
    const pending = Promise.all([first, duplicate]);
    await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    release();
    const responses = await pending;

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    await invoke(runtime.app, body, "same-turn-haru").expect(200);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("limits global invocations without charging an idempotent duplicate twice", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decide = vi.fn(async () => {
      await gate;
      return { value: structuredClone(decision), threadId: "limited-thread" };
    });
    const { client } = createFixture({ decide });
    const runtime = createAgentWorkerApp({
      client,
      token: TOKEN,
      maxConcurrentInvocations: 1,
    });
    const body = {
      sessionId: SESSION_ID,
      operation: "decide",
      characterId: "haru",
      input: characterInput(),
    };

    const first = Promise.resolve(invoke(runtime.app, body, "limited-key"));
    const duplicate = Promise.resolve(
      invoke(runtime.app, body, "limited-key"),
    );
    await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    const overloaded = await invoke(runtime.app, body, "other-key").expect(429);
    release();
    const completed = await Promise.all([first, duplicate]);

    expect(overloaded.body.error.code).toBe("TOO_MANY_INVOCATIONS");
    expect(overloaded.headers["retry-after"]).toBe("1");
    expect(completed.map((response) => response.status)).toEqual([200, 200]);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("rate-limits new invocations without charging in-flight or cached duplicates", async () => {
    let currentTime = 1_000;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decide = vi.fn(async () => {
      await gate;
      return { value: structuredClone(decision), threadId: "rate-thread" };
    });
    const { client } = createFixture({ decide });
    const runtime = createAgentWorkerApp({
      client,
      token: TOKEN,
      maxInvocationsPerMinute: 1,
      rateLimitWindowMs: 60_000,
      now: () => currentTime,
    });
    const body = {
      sessionId: SESSION_ID,
      operation: "decide",
      characterId: "haru",
      input: characterInput(),
    };

    const first = Promise.resolve(invoke(runtime.app, body, "rate-key"));
    const duplicate = Promise.resolve(invoke(runtime.app, body, "rate-key"));
    await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    const limited = await invoke(runtime.app, body, "other-rate-key").expect(
      429,
    );

    expect(limited.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(limited.headers["retry-after"]).toBe("60");
    release();
    expect((await Promise.all([first, duplicate])).map(({ status }) => status)).toEqual([
      200,
      200,
    ]);

    await invoke(runtime.app, body, "rate-key").expect(200);
    expect(decide).toHaveBeenCalledTimes(1);

    currentTime += 60_000;
    await invoke(runtime.app, body, "other-rate-key").expect(200);
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("rejects reuse of an idempotency key for a different request", async () => {
    const { client } = createFixture();
    const runtime = createAgentWorkerApp({ client, token: TOKEN });
    const firstInput = characterInput();
    const secondInput = characterInput();
    secondInput.self = { ...secondInput.self, mood: "別の気分" };

    await invoke(
      runtime.app,
      {
        sessionId: SESSION_ID,
        operation: "decide",
        characterId: "haru",
        input: firstInput,
      },
      "reused-key",
    ).expect(200);
    const conflict = await invoke(
      runtime.app,
      {
        sessionId: SESSION_ID,
        operation: "decide",
        characterId: "haru",
        input: secondInput,
      },
      "reused-key",
    ).expect(409);

    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("expires successful idempotency results after the configured TTL", async () => {
    let currentTime = 1_000;
    const { adapter, client } = createFixture();
    const runtime = createAgentWorkerApp({
      client,
      token: TOKEN,
      now: () => currentTime,
      idempotencyTtlMs: 100,
    });
    const body = {
      sessionId: SESSION_ID,
      operation: "decide",
      characterId: "haru",
      input: characterInput(),
    };

    await invoke(runtime.app, body, "expiring-key").expect(200);
    currentTime += 101;
    await invoke(runtime.app, body, "expiring-key").expect(200);

    expect(adapter.decide).toHaveBeenCalledTimes(2);
  });

  it("does not evict an unexpired settled result when the cache is full", async () => {
    let currentTime = 1_000;
    const { adapter, client } = createFixture();
    const runtime = createAgentWorkerApp({
      client,
      token: TOKEN,
      now: () => currentTime,
      idempotencyTtlMs: 100,
      idempotencyMaxEntries: 1,
    });
    const body = {
      sessionId: SESSION_ID,
      operation: "decide",
      characterId: "haru",
      input: characterInput(),
    };

    await invoke(runtime.app, body, "settled-key").expect(200);
    await invoke(runtime.app, body, "settled-key").expect(200);
    const full = await invoke(runtime.app, body, "new-key").expect(503);
    expect(full.body.error.code).toBe("IDEMPOTENCY_CACHE_BUSY");
    expect(adapter.decide).toHaveBeenCalledTimes(1);

    currentTime += 101;
    await invoke(runtime.app, body, "new-key").expect(200);
    expect(adapter.decide).toHaveBeenCalledTimes(2);
  });

  it("bounds the idempotency cache without evicting an in-flight request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decide = vi.fn(async () => {
      await gate;
      return { value: structuredClone(decision), threadId: "bounded-thread" };
    });
    const { client } = createFixture({ decide });
    const runtime = createAgentWorkerApp({
      client,
      token: TOKEN,
      idempotencyMaxEntries: 1,
    });
    const body = {
      sessionId: SESSION_ID,
      operation: "decide",
      characterId: "haru",
      input: characterInput(),
    };

    const first = invoke(runtime.app, body, "in-flight-key");
    const firstResult = Promise.resolve(first);
    await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    const busy = await invoke(runtime.app, body, "second-key").expect(503);
    release();
    await firstResult;

    expect(busy.body.error.code).toBe("IDEMPOTENCY_CACHE_BUSY");
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("caps authenticated JSON request bodies at 1MiB", async () => {
    const { client } = createFixture();
    const runtime = createAgentWorkerApp({ client, token: TOKEN });
    const oversized = JSON.stringify({ oversized: "x".repeat(1024 * 1024) });
    await request(runtime.app)
      .post("/v1/invoke")
      .set("Content-Type", "application/json")
      .send(oversized)
      .expect(401);
    const response = await request(runtime.app)
      .post("/v1/invoke")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Content-Type", "application/json")
      .send(oversized)
      .expect(413);

    expect(response.body.error.code).toBe("BODY_TOO_LARGE");
  });

  it("uses an empty mode-0700 temporary cwd by default", () => {
    const selected = resolveAgentWorkerCwd({ NODE_ENV: "production" });
    try {
      expect(selected.temporary).toBe(true);
      expect(selected.cwd.startsWith(tmpdir())).toBe(true);
      expect(readdirSync(selected.cwd)).toEqual([]);
      expect(statSync(selected.cwd).mode & 0o777).toBe(0o700);
    } finally {
      selected.cleanup();
    }
    expect(existsSync(selected.cwd)).toBe(false);
  });

  it("requires an explicit production opt-in for a custom cwd", () => {
    expect(() =>
      resolveAgentWorkerCwd({
        NODE_ENV: "production",
        AGENT_WORKER_CWD: tmpdir(),
      }),
    ).toThrow("AGENT_WORKER_ALLOW_CUSTOM_CWD=true");

    const selected = resolveAgentWorkerCwd({
      NODE_ENV: "production",
      AGENT_WORKER_CWD: tmpdir(),
      AGENT_WORKER_ALLOW_CUSTOM_CWD: "true",
    });
    expect(selected).toMatchObject({ cwd: tmpdir(), temporary: false });
    selected.cleanup();
    expect(existsSync(tmpdir())).toBe(true);
  });

  it("reads rate, concurrency, and legacy App Server timeout env", () => {
    const settings = readAgentWorkerSettings({
      NODE_ENV: "production",
      AGENT_WORKER_TOKEN: TOKEN,
      AGENT_WORKER_MAX_CONCURRENT_INVOCATIONS: "3",
      AGENT_WORKER_MAX_INVOCATIONS_PER_MINUTE: "17",
      APP_SERVER_REQUEST_TIMEOUT_MS: "4321",
      APP_SERVER_TURN_TIMEOUT_MS: "98765",
    });

    expect(settings).toMatchObject({
      maxConcurrentInvocations: 3,
      maxInvocationsPerMinute: 17,
      requestTimeoutMs: 4_321,
      turnTimeoutMs: 98_765,
    });
  });

  it("prefers Agent Worker-prefixed App Server timeouts and defaults turns below 60s", () => {
    const prefixed = readAgentWorkerSettings({
      NODE_ENV: "production",
      AGENT_WORKER_TOKEN: TOKEN,
      APP_SERVER_REQUEST_TIMEOUT_MS: "4321",
      APP_SERVER_TURN_TIMEOUT_MS: "98765",
      AGENT_WORKER_APP_SERVER_REQUEST_TIMEOUT_MS: "5432",
      AGENT_WORKER_APP_SERVER_TURN_TIMEOUT_MS: "45678",
    });
    const defaults = readAgentWorkerSettings({
      NODE_ENV: "production",
      AGENT_WORKER_TOKEN: TOKEN,
    });

    expect(prefixed).toMatchObject({
      requestTimeoutMs: 5_432,
      turnTimeoutMs: 45_678,
    });
    expect(defaults).toMatchObject({
      requestTimeoutMs: 30_000,
      turnTimeoutMs: 50_000,
      maxInvocationsPerMinute: 60,
      modelPolicy: {
        model: "gpt-5.6-terra",
        fastReasoningEffort: "low",
        deliberateReasoningEffort: "medium",
      },
    });
  });

  it("allows Agent Worker-only model and reasoning overrides", () => {
    const settings = readAgentWorkerSettings({
      NODE_ENV: "production",
      AGENT_WORKER_TOKEN: TOKEN,
      AGENT_WORKER_MODEL: " gpt-5.6-sol ",
      AGENT_WORKER_FAST_REASONING_EFFORT: "minimal",
      AGENT_WORKER_DELIBERATE_REASONING_EFFORT: "high",
    });

    expect(settings.modelPolicy).toEqual({
      model: "gpt-5.6-sol",
      fastReasoningEffort: "minimal",
      deliberateReasoningEffort: "high",
    });
  });

  it("rejects invalid Agent Worker model policy settings", () => {
    const base = {
      NODE_ENV: "production",
      AGENT_WORKER_TOKEN: TOKEN,
    };

    expect(() =>
      readAgentWorkerSettings({ ...base, AGENT_WORKER_MODEL: "   " }),
    ).toThrow("AGENT_WORKER_MODEL");
    expect(() =>
      readAgentWorkerSettings({
        ...base,
        AGENT_WORKER_FAST_REASONING_EFFORT: "fast",
      }),
    ).toThrow("AGENT_WORKER_FAST_REASONING_EFFORT");
    expect(() =>
      readAgentWorkerSettings({
        ...base,
        AGENT_WORKER_DELIBERATE_REASONING_EFFORT: "FAST",
      }),
    ).toThrow("AGENT_WORKER_DELIBERATE_REASONING_EFFORT");
  });

  it("shuts down only the owning process client", async () => {
    const { client } = createFixture();
    const runtime = createAgentWorkerApp({ client, token: TOKEN });

    await runtime.shutdown();

    expect(client.shutdown).toHaveBeenCalledTimes(1);
  });
});
