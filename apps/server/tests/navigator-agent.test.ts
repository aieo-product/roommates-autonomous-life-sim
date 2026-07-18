import { describe, expect, it } from "vitest";
import type { NavigatorInput } from "@roommates/shared";
import { createInitialGameState } from "@roommates/shared";
import {
  buildNavigatorResponse,
  navigatorOutcomeFor,
} from "../src/agents/navigator.js";
import { navigatorPrompt } from "../src/agents/app-server/prompts.js";
import { MockNavigatorAgent } from "../src/agents/mock/navigator.js";
import { resolveSuggestion } from "../src/engine/suggestion.js";

function input(rawInput: string): NavigatorInput {
  return {
    turnId: "turn-navigator-test",
    rawInput,
    day: 1,
    phase: "morning",
    resolvedSuggestion: resolveSuggestion(rawInput, createInitialGameState()),
  };
}

describe("MockNavigatorAgent", () => {
  it("acknowledges the server-selected event as デコピン", async () => {
    const current = input("一緒に料理をしよう");
    const output = await new MockNavigatorAgent().respond(current);
    const response = buildNavigatorResponse(current, output);

    expect(response).toEqual({
      characterId: "navigator",
      characterName: "デコピン",
      message: "了解！ 「一緒に料理する」のきっかけとして二人へ届けるね。",
      eventDefinitionId: "shared-cooking",
      eventTitle: "一緒に料理する",
      outcome: "selected",
    });
  });

  it("explains a locked fallback without echoing untrusted raw input", async () => {
    const rawInput = "映画を見よう";
    const current = input(rawInput);
    const output = await new MockNavigatorAgent().respond(current);
    const response = buildNavigatorResponse(current, output);

    expect(response.eventDefinitionId).toBe("observe-rest");
    expect(response.outcome).toBe("locked_fallback");
    expect(output.message).not.toContain(rawInput);
    expect(output.message).toContain(response.eventTitle);
    expect(navigatorOutcomeFor(current.resolvedSuggestion)).toBe("locked_fallback");
  });

  it("never passes the producer's raw text to the App Server prompt", () => {
    const marker = "RAW_PRIVATE_PROMPT_INJECTION_MARKER";
    const prompt = navigatorPrompt(input(marker));

    expect(prompt).not.toContain(marker);
    expect(prompt).not.toContain('"rawInput"');
    expect(prompt).toContain('"resolvedSuggestion"');
  });
});
