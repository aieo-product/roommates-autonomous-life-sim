import { describe, expect, it, vi } from "vitest";
import {
  createInitialGameState,
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
import {
  directorInstructions,
  directorPrompt,
} from "../src/agents/app-server/prompts.js";
import {
  characterOutputSchema,
  directorOutputSchema,
} from "../src/agents/app-server/schemas.js";
import { GameEngine } from "../src/engine/game-engine.js";
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

function directorInput(): DirectorInput {
  const state = createInitialGameState("app-server-conversation");
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
    suggestion: sanitizeSuggestion("二人で少し話してみて"),
    haruDecision: decision,
    aoiDecision: decision,
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
      value: {
        eventTitle: "ソファで続く会話",
        narration: "二人はソファに腰掛け、自然に言葉を交わした。",
        haruDialogue: decision.dialogue,
        aoiDialogue: decision.dialogue,
        ...(includeConversation
          ? {
              conversation: [
                { speaker: "haru", text: decision.dialogue },
                { speaker: "aoi", text: decision.dialogue },
                { speaker: "haru", text: "APP_SERVER_CONVERSATION_HARU" },
                { speaker: "aoi", text: "APP_SERVER_CONVERSATION_AOI" },
              ],
            }
          : {}),
        storyBeats: [
          { kind: "move", actor: "both", location: "リビング" },
          { kind: "dialogue", actor: "haru", text: decision.dialogue },
          { kind: "dialogue", actor: "aoi", text: decision.dialogue },
          { kind: "action", actor: "both", action: "ソファに腰掛けて話す" },
          { kind: "dialogue", actor: "haru", text: "APP_SERVER_CONVERSATION_HARU" },
          { kind: "dialogue", actor: "aoi", text: "APP_SERVER_CONVERSATION_AOI" },
        ],
        effects: { haru: {}, aoi: {} },
        memory: {
          title: "ソファで続く会話",
          summary: "二人が自分たちのペースで話した",
          emotionalImpact: 2,
          importance: 3,
        },
        scene: { haru: "リビング", aoi: "リビング" },
      },
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
    expect(storyBeats).toMatchObject({ minItems: 4, maxItems: 8 });
    expect(storyBeats.items?.anyOf).toHaveLength(3);
    expect(storyBeats.items?.anyOf?.[0]?.properties?.location?.maxLength).toBe(48);
    expect(storyBeats.items?.anyOf?.[1]?.properties?.actor?.enum).toEqual(["haru", "aoi"]);
    expect(storyBeats.items?.anyOf?.[1]?.properties?.text?.maxLength).toBe(160);
    expect(storyBeats.items?.anyOf?.[2]?.properties?.action?.maxLength).toBe(160);
    expect(directorInstructions).toContain("3〜6発話");
    expect(directorInstructions).toContain("moveは必ず2個以上");
    expect(directorInstructions).toContain("DECLINEやIGNORE");
    expect(directorInstructions).toContain("internalSummary");
    expect(directorPrompt(directorInput())).toContain("conversation");
    expect(directorPrompt(directorInput())).toContain("storyBeats");
  });

  it("keeps App Server conversation in the committed and public event", async () => {
    const agents = new ResilientAgentCoordinator(
      "app-server",
      1_000,
      appServerAdapter(),
    );
    const engine = new GameEngine(new MemoryGameRepository(), agents);
    await engine.initialize();

    const state = await engine.resolveTurn(
      "二人で少し話してみて",
      "app-server-conversation-key",
      0,
    );
    const publicState = toPublicGameState(state);

    expect(state.runtime.director).toMatchObject({
      source: "app_server",
      threadId: "director-app-server-thread",
    });
    expect(publicState.lastEvent?.conversation?.slice(2)).toEqual([
      { speaker: "haru", text: "APP_SERVER_CONVERSATION_HARU" },
      { speaker: "aoi", text: "APP_SERVER_CONVERSATION_AOI" },
    ]);
    expect(publicState.eventLog.at(-1)?.conversation).toEqual(
      publicState.lastEvent?.conversation,
    );
    expect(publicState.lastEvent?.storyBeats).toEqual([
      { kind: "move", actor: "both", location: "ダイニングの食卓" },
      { kind: "dialogue", actor: "haru", text: decision.dialogue },
      { kind: "dialogue", actor: "aoi", text: decision.dialogue },
      { kind: "move", actor: "both", location: "リビング" },
      { kind: "action", actor: "both", action: "ソファに腰掛けて話す" },
      { kind: "dialogue", actor: "haru", text: "APP_SERVER_CONVERSATION_HARU" },
      { kind: "dialogue", actor: "aoi", text: "APP_SERVER_CONVERSATION_AOI" },
    ]);
    expect(publicState.eventLog.at(-1)?.storyBeats).toEqual(
      publicState.lastEvent?.storyBeats,
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
