import type { Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
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
  type AgentWorkerClient as AgentWorkerProcessClient,
} from "../src/agent-worker-app.js";
import { AgentWorkerClient } from "../src/agents/app-server/remote-client.js";
import type { AppServerAdapter } from "../src/agents/coordinator.js";
import {
  buildAgentReflectionInput,
  fallbackAgentReflection,
} from "../src/agents/reflection.js";
import { buildAutonomousActionCandidates } from "../src/engine/autonomy/action-elements.js";
import { EVENT_DEFINITIONS_BY_ID } from "../src/engine/event-definitions.js";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = "contract-agent-worker-token";

type CapturedRequest = {
  method: string;
  path: string;
  headers: Headers;
  body?: string;
};

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === "string") return new URL(input);
  return input instanceof URL ? input : new URL(input.url);
}

function expressFetch(
  app: Express,
  captured: CapturedRequest[],
): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : undefined;
    captured.push({
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      ...(body === undefined ? {} : { body }),
    });

    let pending =
      method === "GET"
        ? request(app).get(`${url.pathname}${url.search}`)
        : request(app).post(`${url.pathname}${url.search}`);
    for (const [name, value] of headers) pending = pending.set(name, value);
    if (body !== undefined) pending = pending.send(body);
    const result = await pending;

    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(result.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) responseHeaders.append(name, String(item));
      } else if (value !== undefined) {
        responseHeaders.set(name, String(value));
      }
    }
    const responseBody =
      typeof result.text === "string"
        ? result.text
        : JSON.stringify(result.body ?? null);
    return new Response(responseBody, {
      status: result.status,
      headers: responseHeaders,
    });
  };
}

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
    turnId: "1-morning-1-contract",
    rawInput: "二人で話してみて",
    day: 1,
    phase: "morning",
    resolvedSuggestion: sanitizeSuggestion("二人で話してみて"),
  };
}

function characterInput(): CharacterDecisionInput {
  const state = createInitialGameState("agent-worker-contract");
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
    turnId: "1-morning-1-contract",
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
    autonomousCandidates: buildAutonomousActionCandidates(state, "haru"),
  };
}

function directorInput(): DirectorInput {
  const character = characterInput();
  return {
    turnId: character.turnId,
    snapshot: character.snapshot,
    suggestion: character.suggestion,
    eventDefinition: EVENT_DEFINITIONS_BY_ID.get(character.suggestion.eventDefinitionId),
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

function fixture() {
  const reflectionInput = buildAgentReflectionInput(
    createInitialGameState("agent-worker-contract-reflection"),
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
  };
  const processClient: AgentWorkerProcessClient = {
    ready: vi.fn(async () => undefined),
    scope: vi.fn(() => adapter),
    shutdown: vi.fn(async () => undefined),
  };
  return { adapter, processClient, reflectionInput };
}

describe("AgentWorker HTTP contract", () => {
  it("connects health and every scoped operation through the real client contract", async () => {
    const { adapter, processClient, reflectionInput } = fixture();
    const runtime = createAgentWorkerApp({ client: processClient, token: TOKEN });
    const captured: CapturedRequest[] = [];
    const client = new AgentWorkerClient({
      baseUrl: "https://agent-worker.contract.test",
      sessionId: SESSION_ID,
      token: TOKEN,
      fetchImpl: expressFetch(runtime.app, captured),
    });
    const navigator = navigatorInput();

    const firstNavigator = await client.navigate(navigator);
    const duplicateNavigator = await client.navigate(navigator);
    const character = await client.decide("haru", characterInput());
    const director = await client.resolve(directorInput());
    const reflection = await client.reflect("haru", reflectionInput);

    expect(firstNavigator).toEqual({
      value: { message: "会話のきっかけを二人へ届けるね。" },
      threadId: "navigator-thread",
    });
    expect(duplicateNavigator).toEqual(firstNavigator);
    expect(character).toMatchObject({
      value: { decision: "ACCEPT" },
      threadId: "haru-thread",
    });
    expect(adapter.decide).toHaveBeenCalledWith(
      "haru",
      expect.objectContaining({
        autonomousCandidates: expect.arrayContaining([
          expect.objectContaining({ id: expect.stringMatching(/^autonomous:/) }),
        ]),
      }),
    );
    expect(director).toMatchObject({
      value: { conversation: expect.any(Array) },
      threadId: "director-thread",
    });
    expect(reflection).toMatchObject({
      value: { characterId: "haru", reflectionVersion: "reflection-v1" },
      threadId: "reflection-thread",
    });

    expect(adapter.navigate).toHaveBeenCalledTimes(1);
    expect(adapter.decide).toHaveBeenCalledTimes(1);
    expect(adapter.resolve).toHaveBeenCalledTimes(1);
    expect(adapter.reflect).toHaveBeenCalledTimes(1);
    expect(processClient.scope).toHaveBeenCalledTimes(4);
    expect(processClient.scope).toHaveBeenCalledWith(SESSION_ID);
    expect(processClient.ready).toHaveBeenCalledTimes(5);

    const healthRequests = captured.filter(
      (entry) => entry.method === "GET" && entry.path === "/health",
    );
    const invokes = captured.filter(
      (entry) => entry.method === "POST" && entry.path === "/v1/invoke",
    );
    expect(healthRequests).toHaveLength(1);
    expect(invokes).toHaveLength(5);
    expect(
      captured.every(
        (entry) => entry.headers.get("Authorization") === `Bearer ${TOKEN}`,
      ),
    ).toBe(true);

    const invokeBodies = invokes.map((entry) =>
      JSON.parse(entry.body ?? "{}") as Record<string, unknown>,
    );
    expect(invokeBodies.map((body) => body.operation)).toEqual([
      "navigate",
      "navigate",
      "decide",
      "resolve",
      "reflect",
    ]);
    expect(invokeBodies.every((body) => body.sessionId === SESSION_ID)).toBe(
      true,
    );
    expect(invokes[0]?.headers.get("Idempotency-Key")).toBe(
      invokes[1]?.headers.get("Idempotency-Key"),
    );

    await runtime.shutdown();
    expect(processClient.shutdown).toHaveBeenCalledOnce();
  });

  it("rejects an incorrect Bearer token at the real health boundary", async () => {
    const { adapter, processClient } = fixture();
    const runtime = createAgentWorkerApp({ client: processClient, token: TOKEN });
    const captured: CapturedRequest[] = [];
    const client = new AgentWorkerClient({
      baseUrl: "https://agent-worker.contract.test",
      sessionId: SESSION_ID,
      token: "wrong-token",
      fetchImpl: expressFetch(runtime.app, captured),
    });

    await expect(client.navigate(navigatorInput())).rejects.toThrow(
      "readiness probe returned HTTP 401",
    );
    await expect(client.resolve(directorInput())).rejects.toThrow(
      "readiness probe returned HTTP 401",
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ method: "GET", path: "/health" });
    expect(adapter.navigate).not.toHaveBeenCalled();
    expect(adapter.resolve).not.toHaveBeenCalled();
    expect(processClient.ready).not.toHaveBeenCalled();
    expect(processClient.scope).not.toHaveBeenCalled();
    await runtime.shutdown();
  });
});
