import {
  createInitialGameState,
  getDefaultCharacterSettings,
  type CharacterDecision,
  type CharacterDecisionInput,
  type DirectorInput,
} from "@roommates/shared";
import { describe, expect, it } from "vitest";
import {
  characterInstructions,
  characterPrompt,
  directorInstructions,
  directorPrompt,
  reflectionInstructions,
} from "../src/agents/app-server/prompts.js";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";

const roster = {
  haru: { id: "haru", displayName: "蓮", role: "male" },
  aoi: { id: "aoi", displayName: "凛", role: "female" },
} as const;

function decision(): CharacterDecision {
  return {
    decision: "ACCEPT",
    action: "一緒に料理をする",
    dialogue: "一緒にやってみよう。",
    publicReason: "楽しめそうだから",
    internalSummary: "公開しない要約",
    expectedEffects: {},
  };
}

describe("replaceable character display contract", () => {
  it("keeps stable actor IDs while prompts consume configured names and roles", () => {
    const state = createInitialGameState("display-contract");
    const settings = getDefaultCharacterSettings();
    settings.characters.haru.profile.name = "蓮";
    settings.characters.aoi.profile.name = "凛";
    const snapshot = {
      seed: state.seed,
      revision: state.revision,
      characterRoster: roster,
      characters: {
        haru: state.characters.haru.state,
        aoi: state.characters.aoi.state,
      },
      shared: state.shared,
    };
    const suggestion = sanitizeSuggestion("一緒に夕食を作ってみたら？");
    const characterInput: CharacterDecisionInput = {
      turnId: "turn-display-contract",
      characterId: "haru",
      character: settings.characters.haru,
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
    };
    const directorInput: DirectorInput = {
      turnId: characterInput.turnId,
      snapshot,
      suggestion,
      haruDecision: decision(),
      aoiDecision: decision(),
    };

    const instructionText = [
      characterInstructions("haru"),
      directorInstructions,
      reflectionInstructions("aoi"),
    ].join("\n");
    expect(instructionText).not.toMatch(/Haru|Aoi/u);
    expect(characterPrompt(characterInput)).toContain('"displayName":"蓮"');
    expect(characterPrompt(characterInput)).toContain('"role":"female"');
    expect(directorPrompt(directorInput)).toContain('"displayName":"凛"');
    expect(directorPrompt(directorInput)).not.toContain("公開しない要約");
  });
});
