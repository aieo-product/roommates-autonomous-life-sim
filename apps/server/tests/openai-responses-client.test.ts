import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHARACTER_SETTINGS,
  createInitialGameState,
  directorResolvedEventDraftSchema,
  directorResolvedEventSchema,
  type CharacterDecision,
  type CharacterDecisionInput,
  type CharacterId,
  type DirectorInput,
  type NavigatorInput,
} from "@roommates/shared";
import {
  characterInstructions,
  navigatorInstructions,
  navigatorPrompt,
} from "../src/agents/app-server/prompts.js";
import {
  DEFAULT_OPENAI_RESPONSES_MODEL,
  OPENAI_RESPONSES_ENDPOINT,
  OPENAI_RESPONSES_MAX_OUTPUT_TOKENS,
  OpenAIResponsesClient,
  OpenAIResponsesClientError,
  characterResponsesOutputSchema,
} from "../src/agents/openai/responses-client.js";
import type { AgentReflectionInput } from "../src/agents/reflection.js";
import { EVENT_DEFINITIONS_BY_ID } from "../src/engine/event-definitions.js";
import { resolveSuggestion } from "../src/engine/suggestion.js";

const SECRET = "sk-proj-RESPONSES_CLIENT_SECRET_DO_NOT_LEAK";
const ZERO_EFFECTS = {
  energy: 0,
  stress: 0,
  affection: 0,
  trust: 0,
  romanticAwareness: 0,
};

const decisionOutput = {
  decision: "ACCEPT" as const,
  action: "食卓へ移動して話す",
  dialogue: "少し話してみよう。",
  publicReason: "落ち着いて話せそうだから",
  internalSummary: "会話への関心がある",
  expectedEffects: ZERO_EFFECTS,
  initiative: null,
};

const directorOutput = {
  eventTitle: "食卓からリビングへ",
  narration: "二人は食卓で話したあと、リビングへ移動して会話を続けた。",
  haruDialogue: decisionOutput.dialogue,
  aoiDialogue: decisionOutput.dialogue,
  conversation: [
    { speaker: "haru" as const, text: decisionOutput.dialogue },
    { speaker: "aoi" as const, text: decisionOutput.dialogue },
    { speaker: "haru" as const, text: "場所を変えると気分も変わるね。" },
    { speaker: "aoi" as const, text: "うん、もう少しここで話そう。" },
  ],
  storyBeats: [
    { kind: "move" as const, actor: "both" as const, location: "ダイニングの食卓" },
    { kind: "dialogue" as const, actor: "haru" as const, text: decisionOutput.dialogue },
    { kind: "dialogue" as const, actor: "aoi" as const, text: decisionOutput.dialogue },
    { kind: "move" as const, actor: "both" as const, location: "リビング" },
    { kind: "action" as const, actor: "both" as const, action: "ソファに腰掛ける" },
    { kind: "dialogue" as const, actor: "haru" as const, text: "場所を変えると気分も変わるね。" },
    { kind: "dialogue" as const, actor: "aoi" as const, text: "うん、もう少しここで話そう。" },
  ],
  effects: { haru: ZERO_EFFECTS, aoi: ZERO_EFFECTS },
  memory: {
    title: "場所を変えて続いた会話",
    summary: "二人で食卓からリビングへ移り、会話を続けた。",
    emotionalImpact: 2,
    importance: 3,
  },
  scene: { haru: "リビング", aoi: "リビング" },
  conflictUpdate: { add: [], resolve: [] },
};

const reflectionInput: AgentReflectionInput = {
  characterId: "haru",
  finalRelationship: "roommates",
  ending: null,
  selfFinalState: {
    energy: 50,
    stress: 20,
    affection: 30,
    trust: 30,
    romanticAwareness: 10,
    mood: "穏やか",
    location: "リビング",
    currentGoal: "一週間を振り返る",
  },
  sharedEvents: [],
  selfMemories: [],
  highlightEventLogIds: [],
};

const reflectionOutput = {
  characterId: "haru" as const,
  seasonImpression:
    "共同生活の一週間を振り返ると、無理に距離を縮めず、お互いのペースを尊重できたことが心に残っています。何気ない時間の積み重ねを、これからも大切にしたいと思います。",
  notableEventComments: [],
  bestMomentEventLogId: null,
  turningPointEventLogId: null,
  messageToProducer: "静かな時間も見守ってくれてありがとう。",
  reflectionVersion: "reflection-v1" as const,
};

function navigatorInput(): NavigatorInput {
  const state = createInitialGameState("openai-navigator");
  return {
    turnId: "turn-openai-navigator",
    rawInput: "二人で料理して",
    day: state.shared.day,
    phase: state.shared.phase,
    resolvedSuggestion: resolveSuggestion("二人で料理して", state),
  };
}

function characterInput(id: CharacterId): CharacterDecisionInput {
  const state = createInitialGameState(`openai-character-${id}`);
  const otherId = id === "haru" ? "aoi" : "haru";
  return {
    turnId: `turn-openai-${id}`,
    characterId: id,
    character: structuredClone(DEFAULT_CHARACTER_SETTINGS.characters[id]),
    snapshot: {
      seed: state.seed,
      revision: state.revision,
      characters: {
        haru: state.characters.haru.state,
        aoi: state.characters.aoi.state,
      },
      shared: state.shared,
    },
    self: state.characters[id].state,
    otherKnownInfo: {
      mood: state.characters[otherId].state.mood,
      location: state.characters[otherId].state.location,
      currentGoal: state.characters[otherId].state.currentGoal,
    },
    recentMemories: [],
    importantMemories: [],
    suggestion: resolveSuggestion("二人で料理して", state),
  };
}

function directorInput(): DirectorInput {
  const state = createInitialGameState("openai-director");
  const suggestion = resolveSuggestion("二人で料理して", state);
  const decision: CharacterDecision = {
    ...decisionOutput,
    initiative: undefined,
  };
  return {
    turnId: "turn-openai-director",
    snapshot: {
      seed: state.seed,
      revision: state.revision,
      characters: {
        haru: state.characters.haru.state,
        aoi: state.characters.aoi.state,
      },
      shared: state.shared,
    },
    suggestion,
    eventDefinition: EVENT_DEFINITIONS_BY_ID.get(suggestion.eventDefinitionId),
    haruDecision: decision,
    aoiDecision: decision,
  };
}

function completedResponse(value: unknown, id = "resp_test"): Response {
  return new Response(
    JSON.stringify({
      id,
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function clientWith(fetchMock: ReturnType<typeof vi.fn>, overrides = {}) {
  return new OpenAIResponsesClient({
    apiKey: SECRET,
    fetchImpl: fetchMock as unknown as typeof fetch,
    ...overrides,
  });
}

async function caughtError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
    throw new Error("Expected operation to reject");
  } catch (error) {
    return error as Error;
  }
}

describe("OpenAIResponsesClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends a stateless, tool-free Responses request with strict Structured Outputs", async () => {
    const input = navigatorInput();
    const fetchMock = vi.fn(async () => completedResponse({ message: "料理のきっかけを届けるね。" }, "resp_nav"));
    const client = clientWith(fetchMock);

    const result = await client.navigate(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    const body = JSON.parse(String(init.body)) as Record<string, any>;
    expect(url).toBe(OPENAI_RESPONSES_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(headers.get("Authorization")).toBe(`Bearer ${SECRET}`);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(body).toMatchObject({
      model: DEFAULT_OPENAI_RESPONSES_MODEL,
      instructions: navigatorInstructions,
      input: navigatorPrompt(input),
      reasoning: { effort: "none" },
      store: false,
      max_output_tokens: OPENAI_RESPONSES_MAX_OUTPUT_TOKENS,
      text: {
        format: {
          type: "json_schema",
          name: "navigator_output",
          strict: true,
          schema: expect.objectContaining({
            type: "object",
            required: ["message"],
            additionalProperties: false,
          }),
        },
      },
    });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("previous_response_id");
    expect(result).toMatchObject({
      value: { message: "料理のきっかけを届けるね。" },
      source: "openai_api",
      threadId: expect.stringMatching(/^openai:[a-f0-9]+:navigator:resp_nav$/),
    });
  });

  it("preserves the Cloudflare global receiver when using runtime fetch", async () => {
    const runtimeFetch = vi.fn(async function (this: unknown) {
      expect(this).toBe(globalThis);
      return completedResponse({ message: "受け取ったよ。" }, "resp_runtime_fetch");
    });
    vi.stubGlobal("fetch", runtimeFetch);
    const client = new OpenAIResponsesClient({ apiKey: SECRET });

    const result = await client.navigate(navigatorInput());

    expect(result.value).toEqual({ message: "受け取ったよ。" });
    expect(runtimeFetch).toHaveBeenCalledTimes(1);
  });

  it("uses the configured model and maps a nullable non-INITIATE field to the game contract", async () => {
    const fetchMock = vi.fn(async () => completedResponse(decisionOutput, "resp_haru"));
    const client = clientWith(fetchMock, { model: "gpt-5.6-luna" });

    const result = await client.decide("haru", characterInput("haru"));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, any>;
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.instructions).toBe(characterInstructions("haru"));
    expect(body.text.format.schema).toEqual(characterResponsesOutputSchema);
    expect(body.text.format.schema.required).toContain("initiative");
    expect(body.text.format.schema.properties.initiative.anyOf).toContainEqual({ type: "null" });
    expect(result.value).toEqual({
      ...decisionOutput,
      initiative: undefined,
    });
  });

  it("parses validated outputs for navigator, both characters, director, and reflection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completedResponse({ message: "二人へ届けるね。" }, "resp_nav"))
      .mockResolvedValueOnce(completedResponse(decisionOutput, "resp_haru"))
      .mockResolvedValueOnce(completedResponse(decisionOutput, "resp_aoi"))
      .mockResolvedValueOnce(completedResponse(directorOutput, "resp_director"))
      .mockResolvedValueOnce(completedResponse(reflectionOutput, "resp_reflection"));
    const client = clientWith(fetchMock, { scopeId: "game-session:1" });

    const navigator = await client.navigate(navigatorInput());
    const haru = await client.decide("haru", characterInput("haru"));
    const aoi = await client.decide("aoi", characterInput("aoi"));
    const director = await client.resolve(directorInput());
    const reflection = await client.reflect("haru", reflectionInput);

    expect(navigator.value).toEqual({ message: "二人へ届けるね。" });
    expect(haru.value).toMatchObject({ decision: "ACCEPT", action: decisionOutput.action });
    expect(aoi.value).toMatchObject({ decision: "ACCEPT", action: decisionOutput.action });
    expect(directorResolvedEventDraftSchema.safeParse(directorOutput).success).toBe(true);
    expect(directorResolvedEventSchema.safeParse(directorOutput).success).toBe(false);
    expect(director.value).toEqual(directorOutput);
    expect(reflection.value).toEqual(reflectionOutput);
    expect([navigator, haru, aoi, director, reflection].map((item) => item.threadId)).toEqual([
      expect.stringContaining(":navigator:resp_nav"),
      expect.stringContaining(":haru:resp_haru"),
      expect.stringContaining(":aoi:resp_aoi"),
      expect.stringContaining(":director:resp_director"),
      expect.stringContaining(":haru-reflection:resp_reflection"),
    ]);
  });

  it.each([401, 429, 500])("sanitizes HTTP %s failures without reading an error body", async (status) => {
    const fetchMock = vi.fn(async () =>
      new Response(`upstream echoed ${SECRET} and PRIVATE_BODY_MARKER`, { status }),
    );
    const error = await caughtError(clientWith(fetchMock).navigate(navigatorInput()));

    expect(error).toBeInstanceOf(OpenAIResponsesClientError);
    expect((error as OpenAIResponsesClientError).httpStatus).toBe(status);
    expect(error.message).toBe(`OpenAI Responses request failed with status ${status}`);
    expect(String(error)).not.toContain(SECRET);
    expect(String(error)).not.toContain("PRIVATE_BODY_MARKER");
  });

  it("classifies an illegal runtime invocation without exposing its message", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(`Illegal invocation: ${SECRET}`);
    });
    const error = await caughtError(clientWith(fetchMock).navigate(navigatorInput()));

    expect(error).toBeInstanceOf(OpenAIResponsesClientError);
    expect((error as OpenAIResponsesClientError).failureCategory).toBe(
      "illegal_invocation",
    );
    expect(error.message).toBe("OpenAI Responses request failed");
    expect(String(error)).not.toContain(SECRET);
  });

  it.each([
    {
      label: "refusal",
      response: {
        id: "resp_refusal",
        status: "completed",
        output: [{ content: [{ type: "refusal", refusal: `refused ${SECRET}` }] }],
      },
      message: "OpenAI Responses refused the request",
    },
    {
      label: "incomplete response",
      response: {
        id: "resp_incomplete",
        status: "incomplete",
        incomplete_details: { reason: `max_output_tokens ${SECRET}` },
        output: [],
      },
      message: "OpenAI Responses returned an incomplete response",
    },
    {
      label: "incomplete output item",
      response: {
        id: "resp_item_incomplete",
        status: "completed",
        output: [{ status: "incomplete", content: [] }],
      },
      message: "OpenAI Responses returned an incomplete response",
    },
  ])("rejects a $label without leaking provider text", async ({ response, message }) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    const error = await caughtError(clientWith(fetchMock).navigate(navigatorInput()));

    expect(error.message).toBe(message);
    expect(String(error)).not.toContain(SECRET);
  });

  it.each([
    {
      label: "malformed response JSON",
      response: () => new Response(`{"secret":"${SECRET}"`, { status: 200 }),
      message: "OpenAI Responses returned malformed JSON",
    },
    {
      label: "malformed structured output",
      response: () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [{ content: [{ type: "output_text", text: `not json ${SECRET}` }] }],
          }),
          { status: 200 },
        ),
      message: "OpenAI Responses returned invalid structured JSON",
    },
    {
      label: "schema-invalid structured output",
      response: () => completedResponse({ message: "", secret: SECRET }),
      message: "OpenAI Responses returned invalid structured JSON",
    },
  ])("rejects $label with a stable sanitized error", async ({ response, message }) => {
    const fetchMock = vi.fn(async () => response());
    const error = await caughtError(clientWith(fetchMock).navigate(navigatorInput()));

    expect(error.message).toBe(message);
    expect(String(error)).not.toContain(SECRET);
  });

  it("aborts a timed-out fetch and replaces the underlying error", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new Error(`network error exposed ${SECRET}`)),
          { once: true },
        );
      });
    });
    const client = clientWith(fetchMock, { timeoutMs: 1_000 });

    const pending = caughtError(client.navigate(navigatorInput()));
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending;

    expect(signal?.aborted).toBe(true);
    expect(error.message).toBe("OpenAI Responses request timed out after 1000ms");
    expect(String(error)).not.toContain(SECRET);
  });

  it("rejects oversized responses before parsing their contents", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "completed", secret: SECRET, padding: "x".repeat(512) })),
    );
    const error = await caughtError(
      clientWith(fetchMock, { maxResponseBytes: 64 }).navigate(navigatorInput()),
    );

    expect(error.message).toBe("OpenAI Responses response exceeded the size limit");
    expect(String(error)).not.toContain(SECRET);
  });

  it("replaces fetch implementation errors and validates configuration without echoing values", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error(`failed with ${SECRET} and PRIVATE_BODY_MARKER`);
    });
    const error = await caughtError(clientWith(fetchMock).navigate(navigatorInput()));

    expect(error.message).toBe("OpenAI Responses request failed");
    expect(String(error)).not.toContain(SECRET);
    expect(() => new OpenAIResponsesClient({ apiKey: "" })).toThrow("OpenAI API key is invalid");
    expect(() => new OpenAIResponsesClient({ apiKey: SECRET, timeoutMs: 999 })).toThrow(
      "OpenAI Responses timeout is invalid",
    );
    expect(() => new OpenAIResponsesClient({ apiKey: SECRET, timeoutMs: 120_001 })).toThrow(
      "OpenAI Responses timeout is invalid",
    );
  });
});
