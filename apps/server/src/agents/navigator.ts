import type {
  CueResolutionOutcome,
  NavigatorAgentOutput,
  NavigatorInput,
  NavigatorResponse,
  SafeSuggestion,
} from "@roommates/shared";

export function navigatorOutcomeFor(
  suggestion: SafeSuggestion,
): CueResolutionOutcome {
  if (suggestion.lock) return "locked_fallback";
  if (suggestion.kind === "observe") return "observed";
  return suggestion.cue.transformed ? "transformed" : "selected";
}

export function fallbackNavigatorOutput(
  input: Pick<NavigatorInput, "resolvedSuggestion">,
): NavigatorAgentOutput {
  const suggestion = input.resolvedSuggestion;
  if (suggestion.lock) {
    return {
      message: `そのお願いは今はそのまま反映できないから、代わりに「${suggestion.eventTitle}」として二人へ届けるね。`,
    };
  }
  if (suggestion.kind === "observe") {
    return { message: "了解！ 今は二人を急かさず、そっと見守るね。" };
  }
  if (suggestion.cue.transformed) {
    return {
      message: `お願いを安全な形に整えて、「${suggestion.eventTitle}」のきっかけとして二人へ届けるね。`,
    };
  }
  return {
    message: `了解！ 「${suggestion.eventTitle}」のきっかけとして二人へ届けるね。`,
  };
}

/**
 * Builds the trusted public envelope around an agent-authored message. Event
 * metadata always comes from the server-resolved suggestion, never AI output.
 */
export function buildNavigatorResponse(
  input: Pick<NavigatorInput, "resolvedSuggestion">,
  output: NavigatorAgentOutput,
): NavigatorResponse {
  const suggestion = input.resolvedSuggestion;
  return {
    characterId: "navigator",
    characterName: "デコピン",
    message: output.message,
    eventDefinitionId: suggestion.eventDefinitionId,
    eventTitle: suggestion.eventTitle,
    outcome: navigatorOutcomeFor(suggestion),
  };
}
