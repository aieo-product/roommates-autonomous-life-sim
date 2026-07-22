import { describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
  directorResolvedEventDraftSchema,
  directorResolvedEventSchema,
  getDefaultCharacterSettings,
  type CharacterDecision,
  type CharacterDecisionInput,
  type CharacterId,
  type DirectorInput,
  type NavigatorInput,
} from "@roommates/shared";
import {
  type AppServerAdapter,
  ResilientAgentCoordinator,
} from "../src/agents/coordinator.js";
import { ProviderCascadeAdapter } from "../src/agents/provider-cascade.js";
import {
  directorInstructions,
  directorPrompt,
} from "../src/agents/app-server/prompts.js";
import {
  characterOutputSchema,
  directorOutputSchema,
} from "../src/agents/app-server/schemas.js";
import { GameEngine } from "../src/engine/game-engine.js";
import { EVENT_DEFINITIONS_BY_ID } from "../src/engine/event-definitions.js";
import { MemoryGameRepository } from "../src/persistence/repository.js";
import { toPublicGameState } from "../src/public-dto.js";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";

const decision: CharacterDecision = {
  decision: "ACCEPT",
  action: "リビングで少し話す",
  dialogue: "ここで少し話そうか。",
  publicReason: "今なら落ち着いて話せそうだから",
  internalSummary: "PRIVATE_SUMMARY_MUST_NOT_BE_PUBLIC",
  expectedEffects: {},
};

const directorConversation = [
  { speaker: "aoi" as const, text: "ソファでは、どんな話から始めたい？" },
  { speaker: "haru" as const, text: "今日あったことを少し聞いてほしいな。" },
  { speaker: "aoi" as const, text: "うん。急がずに聞かせて。" },
  { speaker: "haru" as const, text: "ありがとう。落ち着いて話せそう。" },
] as const;

function directorInput(): DirectorInput {
  const state = createInitialGameState("app-server-conversation");
  const suggestion = sanitizeSuggestion("二人で少し話してみて");
  return {
    turnId: "turn-app-server-conversation",
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

function directorDraft(includeConversation = true) {
  return {
    eventTitle: "ソファで続く会話",
    narration: "二人はソファに腰掛け、自然に言葉を交わした。",
    haruDialogue: directorConversation[1].text,
    aoiDialogue: directorConversation[0].text,
    ...(includeConversation
      ? {
          conversation: directorConversation,
        }
      : {}),
    // Shape-valid provider draft, but the third agreement is misplaced after
    // the action. The event policy must repair this before commit.
    storyBeats: [
      { kind: "move" as const, actor: "both" as const, location: "リビング" },
      { kind: "dialogue" as const, actor: "aoi" as const, text: directorConversation[0].text },
      { kind: "dialogue" as const, actor: "haru" as const, text: directorConversation[1].text },
      { kind: "action" as const, actor: "both" as const, action: "ソファに腰掛けて話す" },
      { kind: "dialogue" as const, actor: "aoi" as const, text: directorConversation[2].text },
      { kind: "dialogue" as const, actor: "haru" as const, text: directorConversation[3].text },
    ],
    effects: { haru: {}, aoi: {} },
    memory: {
      title: "ソファで続く会話",
      summary: "二人が自分たちのペースで話した",
      emotionalImpact: 2,
      importance: 3,
    },
    scene: { haru: "リビング", aoi: "リビング" },
  };
}

function appServerAdapter(includeConversation = true): AppServerAdapter {
  return {
    navigate: vi.fn(async (_input: NavigatorInput) => ({
      value: { message: "二人へ会話のきっかけを届けるね。" },
      threadId: "navigator-app-server-thread",
    })),
    decide: vi.fn(async (_id: CharacterId, _input: CharacterDecisionInput) => ({
      value: structuredClone(decision),
      threadId: "character-app-server-thread",
    })),
    resolve: vi.fn(async (_input: DirectorInput) => ({
      value: directorDraft(includeConversation),
      threadId: "director-app-server-thread",
    })),
    shutdown: vi.fn(async () => undefined),
  };
}

describe("App Server Director conversation contract", () => {
  it("declares and prompts the bounded public exchange", () => {
    const conversation = Reflect.get(directorOutputSchema.properties, "conversation") as {
      minItems?: number;
      maxItems?: number;
    };
    const characterDialogue = characterOutputSchema.properties.dialogue;
    const storyBeats = Reflect.get(directorOutputSchema.properties, "storyBeats") as unknown as {
      minItems?: number;
      maxItems?: number;
      items?: {
        anyOf?: Array<{
          properties?: Record<string, { enum?: string[]; maxLength?: number }>;
        }>;
      };
    };
    const haruDialogue = directorOutputSchema.properties.haruDialogue;
    const aoiDialogue = directorOutputSchema.properties.aoiDialogue;

    expect(directorOutputSchema.required).toContain("conversation");
    expect(directorOutputSchema.required).toContain("storyBeats");
    expect(directorOutputSchema.required).toEqual(
      expect.arrayContaining(["scene", "conflictUpdate"]),
    );
    expect(characterOutputSchema.properties.expectedEffects.required).toEqual([
      "energy",
      "stress",
      "affection",
      "trust",
      "romanticAwareness",
    ]);
    expect(characterDialogue).toMatchObject({ minLength: 1, maxLength: 160 });
    expect(haruDialogue).toMatchObject({ minLength: 1, maxLength: 160 });
    expect(aoiDialogue).toMatchObject({ minLength: 1, maxLength: 160 });
    expect(conversation).toMatchObject({ minItems: 3, maxItems: 6 });
    expect(storyBeats).toMatchObject({ minItems: 6, maxItems: 10 });
    expect(storyBeats.items?.anyOf).toHaveLength(3);
    expect(storyBeats.items?.anyOf?.[0]?.properties?.location?.maxLength).toBe(48);
    expect(storyBeats.items?.anyOf?.[1]?.properties?.actor?.enum).toEqual(["haru", "aoi"]);
    expect(storyBeats.items?.anyOf?.[1]?.properties?.text?.maxLength).toBe(160);
    expect(storyBeats.items?.anyOf?.[2]?.properties?.action?.maxLength).toBe(160);
    expect(directorInstructions).toContain("3〜6発話");
    expect(directorInstructions).toContain("質問または誘い→相手の直接の返答");
    expect(directorInstructions).toContain("各1回だけ");
    expect(directorInstructions).toContain("moveは2個以上");
    expect(directorInstructions).toContain("共同イベントでは");
    expect(directorInstructions).toContain("非共同イベントでは");
    expect(directorInstructions).toContain("最初の3発話");
    expect(directorInstructions).toContain("基本のconversationを4発話");
    expect(directorInstructions).toContain(
      "二人分の個別moveは同時の移動段階として連続してよい",
    );
    expect(directorInstructions).toContain("DECLINEやIGNORE");
    expect(directorInstructions).toContain("internalSummary");
    expect(directorInstructions).toContain("eventDefinition");
    expect(directorPrompt(directorInput())).toContain("physicalContact");
    expect(directorPrompt(directorInput())).toContain("conversation");
    expect(directorPrompt(directorInput())).toContain("storyBeats");
  });

  it("keeps App Server conversation in the committed and public event", async () => {
    const adapter = appServerAdapter();
    const cascade = new ProviderCascadeAdapter([
      { source: "app_server", adapter },
    ]);
    const agents = new ResilientAgentCoordinator(
      "app-server",
      1_000,
      cascade,
    );
    const engine = new GameEngine(new MemoryGameRepository(), agents);
    await engine.initialize();
    const settings = getDefaultCharacterSettings();
    settings.characters.haru.profile.name = "春";
    settings.characters.aoi.profile.name = "葵子";

    const state = await engine.resolveTurn(
      "二人で少し話してみて",
      "app-server-conversation-key",
      0,
      () => undefined,
      settings,
    );
    const publicState = toPublicGameState(state);

    expect(directorResolvedEventDraftSchema.safeParse(directorDraft()).success).toBe(true);
    expect(directorResolvedEventSchema.safeParse(directorDraft()).success).toBe(false);
    expect(state.runtime.director).toMatchObject({
      source: "app_server",
      threadId: "director-app-server-thread",
    });
    expect(publicState.lastEvent?.conversation).toEqual(directorConversation);
    expect(publicState.lastEvent?.conversation).not.toContainEqual({
      speaker: "haru",
      text: decision.dialogue,
    });
    expect(publicState.eventLog.at(-1)?.conversation).toEqual(
      publicState.lastEvent?.conversation,
    );
    expect(publicState.lastEvent?.storyBeats).toEqual([
      { kind: "move", actor: "both", location: "ダイニングの食卓" },
      { kind: "dialogue", actor: "aoi", text: directorConversation[0].text },
      { kind: "dialogue", actor: "haru", text: directorConversation[1].text },
      { kind: "dialogue", actor: "aoi", text: directorConversation[2].text },
      { kind: "move", actor: "both", location: "リビング" },
      {
        kind: "action",
        actor: "both",
        action: "リビングで少し話す。リビングで少し話す",
      },
      { kind: "dialogue", actor: "haru", text: directorConversation[3].text },
    ]);
    expect(directorResolvedEventSchema.safeParse(state.lastEvent).success).toBe(true);
    expect(adapter.resolve).toHaveBeenCalledTimes(1);
    expect(publicState.eventLog.at(-1)?.storyBeats).toEqual(
      publicState.lastEvent?.storyBeats,
    );
    expect(vi.mocked(adapter.resolve).mock.calls[0]?.[0].snapshot.characterRoster)
      .toMatchObject({
        haru: { displayName: "春" },
        aoi: { displayName: "葵子" },
      });
    expect(publicState.lastEvent?.characterRoster).toMatchObject({
      haru: { displayName: "春" },
      aoi: { displayName: "葵子" },
    });
    expect(publicState.eventLog.at(-1)?.characterRoster).toEqual(
      publicState.lastEvent?.characterRoster,
    );
    expect(JSON.stringify(publicState)).not.toContain("PRIVATE_SUMMARY_MUST_NOT_BE_PUBLIC");
  });

  it("retries a missing conversation and uses a compatible mock fallback", async () => {
    const adapter = appServerAdapter(false);
    const agents = new ResilientAgentCoordinator("app-server", 1_000, adapter);
    const result = await agents.resolve(directorInput());

    expect(adapter.resolve).toHaveBeenCalledTimes(2);
    expect(result.runtime).toMatchObject({
      source: "fallback",
      error: expect.stringContaining("invalid structured JSON"),
    });
    expect(result.value.conversation?.length).toBeGreaterThanOrEqual(3);
  });
});
