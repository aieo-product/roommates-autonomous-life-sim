import type { CharacterDefinition } from "../domain/characterSettings";
import {
  characterAgentRequestSchema,
  characterDecisionSchema,
  characterDecisionTypes,
  type CharacterAgentMode,
  type CharacterAgentRequest,
  type CharacterAgentTransport,
  type CharacterDecision,
  type CharacterSituation,
  type ProposalCategory
} from "./characterAgentContract";
import { decideWithMockAgent } from "./mockCharacterAgent";

export * from "./characterAgentContract";
export { decideWithMockAgent } from "./mockCharacterAgent";

export interface ExecuteCharacterDecisionInput {
  mode: CharacterAgentMode;
  character: CharacterDefinition;
  proposalText: string;
  category: ProposalCategory;
  situation: CharacterSituation;
  transport?: CharacterAgentTransport;
}

export function createCharacterAgentRequest(
  character: CharacterDefinition,
  proposalText: string,
  category: ProposalCategory,
  situation: CharacterSituation
): CharacterAgentRequest {
  return characterAgentRequestSchema.parse({
    schemaVersion: 1,
    character,
    proposal: {
      text: proposalText,
      category
    },
    situation,
    responseContract: {
      allowedDecisions: characterDecisionTypes,
      includeDialogue: true,
      includeReason: true,
      includeCurrentGoal: true
    }
  });
}

export async function executeCharacterDecision(
  input: ExecuteCharacterDecisionInput
): Promise<CharacterDecision> {
  const request = createCharacterAgentRequest(
    input.character,
    input.proposalText,
    input.category,
    input.situation
  );

  if (input.mode === "mock") {
    return decideWithMockAgent(request);
  }

  if (!input.transport) {
    throw new Error(
      "CodexモードにはCharacterAgentTransportの設定が必要です。"
    );
  }

  const response = await input.transport.decide(request);
  return characterDecisionSchema.parse(response);
}

export function createHttpCharacterAgentTransport(
  endpoint = "/api/character-decisions"
): CharacterAgentTransport {
  return {
    async decide(request) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(
          `Character Agentへの接続に失敗しました (${response.status})。`
        );
      }

      return characterDecisionSchema.parse(await response.json());
    }
  };
}
