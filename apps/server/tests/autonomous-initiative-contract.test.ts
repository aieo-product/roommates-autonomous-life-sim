import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHARACTER_SETTINGS,
  autonomousActionCandidateSchema,
  characterDecisionSchema,
  createInitialGameState,
  publicCharacterDecisionSchema,
  type AutonomousActionCandidate,
  type CharacterDecisionInput,
  type GameSnapshot,
} from "@roommates/shared";
import { characterPrompt } from "../src/agents/app-server/prompts.js";
import { characterOutputSchema } from "../src/agents/app-server/schemas.js";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";

const candidate: AutonomousActionCandidate = {
  id: "haru-morning-breakfast",
  eventDefinitionId: "easy-breakfast-prep",
  title: "簡単な朝食を用意する",
  category: "cook",
  intimacyTier: 0,
  location: "キッチン／ダイニング",
  publicIntent: "簡単な朝食を用意して、参加したい人に声をかける",
  invitationOptions: ["solo", "open"],
  durationMinutes: 25,
  energyCost: 4,
  minEnergy: 20,
  maxStress: 85,
  participantMode: "optional_companion",
  consent: {
    allowPass: true,
    allowModify: true,
    physicalContact: "none",
    secrets: "forbidden",
    coercion: "forbidden",
  },
  effectBudget: {
    energy: 6,
    stress: 5,
    affection: 5,
    trust: 6,
    romanticAwareness: 2,
  },
  allowedPhases: ["morning"],
};

function characterInput(
  autonomousCandidates: AutonomousActionCandidate[] = [],
): CharacterDecisionInput {
  const state = createInitialGameState("initiative-contract");
  const snapshot: GameSnapshot = {
    seed: state.seed,
    revision: state.revision,
    characters: {
      haru: state.characters.haru.state,
      aoi: state.characters.aoi.state,
    },
    shared: state.shared,
  };
  return {
    turnId: "1-morning-1-initiative",
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
    suggestion: sanitizeSuggestion("見守る"),
    autonomousCandidates,
  };
}

describe("autonomous initiative contract", () => {
  it("validates the complete server-authored candidate mechanics", () => {
    expect(autonomousActionCandidateSchema.parse(candidate)).toEqual(candidate);
    expect(
      autonomousActionCandidateSchema.safeParse({
        ...candidate,
        invitationOptions: ["open", "open"],
      }).success,
    ).toBe(false);
    expect(
      autonomousActionCandidateSchema.safeParse({
        ...candidate,
        location: "",
      }).success,
    ).toBe(false);
    expect(
      autonomousActionCandidateSchema.safeParse({
        ...candidate,
        energyCost: candidate.effectBudget.energy + 1,
      }).success,
    ).toBe(false);
  });

  it("keeps legacy decisions valid and accepts a structurally valid initiative", () => {
    const legacyDecision = {
      decision: "IGNORE",
      action: "自室で休む",
      dialogue: "今は少し休むね。",
      publicReason: "疲れているから",
      internalSummary: "今日は無理をしない",
      expectedEffects: {},
    } as const;
    expect(characterDecisionSchema.safeParse(legacyDecision).success).toBe(true);
    expect(
      publicCharacterDecisionSchema.parse({
        decision: legacyDecision.decision,
        action: legacyDecision.action,
        dialogue: legacyDecision.dialogue,
        publicReason: legacyDecision.publicReason,
      }),
    ).toEqual({
      decision: legacyDecision.decision,
      action: legacyDecision.action,
      dialogue: legacyDecision.dialogue,
      publicReason: legacyDecision.publicReason,
    });

    const initiativeDecision = {
      ...legacyDecision,
      decision: "INITIATE",
      initiative: {
        candidateId: candidate.id,
        invitation: "open",
        publicIntent: candidate.publicIntent,
      },
    } as const;
    expect(characterDecisionSchema.safeParse(initiativeDecision).success).toBe(true);
    expect(
      publicCharacterDecisionSchema.parse({
        decision: initiativeDecision.decision,
        action: initiativeDecision.action,
        dialogue: initiativeDecision.dialogue,
        publicReason: initiativeDecision.publicReason,
        initiative: initiativeDecision.initiative,
      }).initiative,
    ).toEqual(initiativeDecision.initiative);
    expect(
      characterDecisionSchema.safeParse({
        ...legacyDecision,
        decision: "INITIATE",
        initiative: {
          candidateId: candidate.id,
          invitation: "private",
          publicIntent: candidate.publicIntent,
        },
      }).success,
    ).toBe(false);
    expect(
      characterDecisionSchema.safeParse({
        ...legacyDecision,
        initiative: {
          candidateId: candidate.id,
          invitation: "open",
          publicIntent: candidate.publicIntent,
        },
      }).success,
    ).toBe(false);
  });

  it("passes only server candidates to the prompt and states the selection guardrails", () => {
    const prompt = characterPrompt(characterInput([candidate]));

    expect(prompt).toContain(`"id":"${candidate.id}"`);
    expect(prompt).toContain("候補IDを1つだけ選び");
    expect(prompt).toContain("publicIntentと完全に同じ文章");
    expect(prompt).toContain("候補にない行動、効果、場所、所要時間、秘密");
    expect(prompt).toContain("INITIATE以外を選ぶ場合もinitiativeを省略");
  });

  it("represents initiative as optional in the App Server output schema", () => {
    expect(characterOutputSchema.properties.initiative).toMatchObject({
      type: "object",
      required: ["candidateId", "invitation", "publicIntent"],
      additionalProperties: false,
    });
    expect(characterOutputSchema.required).not.toContain("initiative");
  });
});
