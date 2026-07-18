import { describe, expect, it, vi } from "vitest";
import { getDefaultCharacterSettings } from "../src/domain/characterSettings";
import {
  createCharacterAgentRequest,
  decideWithMockAgent,
  executeCharacterDecision,
  type CharacterAgentRequest,
  type CharacterAgentTransport,
  type CharacterDecision
} from "../src/services/characterAgent";

const situation = {
  energy: 68,
  stress: 26,
  trust: 52,
  relationship: 44
};

describe("character agent integration", () => {
  it("passes the complete profile and personality to the agent", () => {
    const character = getDefaultCharacterSettings().characters.haru;
    const request = createCharacterAgentRequest(
      character,
      "夕食後に話そう",
      "romance",
      situation
    );

    expect(request.character.profile.romanceView).toBe(
      character.profile.romanceView
    );
    expect(request.character.personality).toEqual(character.personality);
    expect(request.responseContract.allowedDecisions).toEqual([
      "ACCEPT",
      "DECLINE",
      "MODIFY",
      "IGNORE",
      "INITIATE"
    ]);
  });

  it("produces different decisions from the same proposal", () => {
    const settings = getDefaultCharacterSettings();
    const haruRequest = createCharacterAgentRequest(
      settings.characters.haru,
      "夕食のあと、二人でゆっくり話す時間を作ろう",
      "romance",
      situation
    );
    const aoiRequest = createCharacterAgentRequest(
      settings.characters.aoi,
      "夕食のあと、二人でゆっくり話す時間を作ろう",
      "romance",
      situation
    );

    const haruDecision = decideWithMockAgent(haruRequest);
    const aoiDecision = decideWithMockAgent(aoiRequest);

    expect(haruDecision.decision).not.toBe(aoiDecision.decision);
    expect(haruDecision.dialogue).not.toBe(aoiDecision.dialogue);
    expect(haruDecision.currentGoal).not.toBe(aoiDecision.currentGoal);
  });

  it("uses the same validated settings in Codex mode", async () => {
    const character = getDefaultCharacterSettings().characters.aoi;
    const response: CharacterDecision = {
      characterId: "aoi",
      decision: "INITIATE",
      dialogue: "Aoi: 私から準備するね。",
      reason: "自分から動きたいから。",
      currentGoal: "楽しい共有体験を作る",
      scores: {
        ACCEPT: 70,
        DECLINE: 5,
        MODIFY: 20,
        IGNORE: 3,
        INITIATE: 90
      }
    };
    const decide = vi.fn(
      async (_request: CharacterAgentRequest) => response
    );
    const transport: CharacterAgentTransport = { decide };

    await executeCharacterDecision({
      mode: "codex",
      character,
      proposalText: "一緒に料理をしよう",
      category: "chore",
      situation,
      transport
    });

    expect(decide).toHaveBeenCalledOnce();
    expect(decide.mock.calls[0]?.[0].character).toEqual(character);
  });
});
