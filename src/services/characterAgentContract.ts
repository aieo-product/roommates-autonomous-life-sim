import { z } from "zod";
import { characterDefinitionSchema } from "../domain/characterSettings";

export const characterDecisionTypes = [
  "ACCEPT",
  "DECLINE",
  "MODIFY",
  "IGNORE",
  "INITIATE"
] as const;

export const characterDecisionTypeSchema = z.enum(characterDecisionTypes);
export type CharacterDecisionType = z.infer<
  typeof characterDecisionTypeSchema
>;

export const proposalCategories = [
  "conversation",
  "sharedActivity",
  "chore",
  "romance",
  "rest"
] as const;

export const proposalCategorySchema = z.enum(proposalCategories);
export type ProposalCategory = z.infer<typeof proposalCategorySchema>;

export const characterSituationSchema = z.object({
  energy: z.number().int().min(0).max(100),
  stress: z.number().int().min(0).max(100),
  trust: z.number().int().min(0).max(100),
  relationship: z.number().int().min(0).max(100)
});

export type CharacterSituation = z.infer<typeof characterSituationSchema>;

export const characterAgentRequestSchema = z.object({
  schemaVersion: z.literal(1),
  character: characterDefinitionSchema,
  proposal: z.object({
    text: z.string().trim().min(1).max(240),
    category: proposalCategorySchema
  }),
  situation: characterSituationSchema,
  responseContract: z.object({
    allowedDecisions: z.tuple([
      z.literal("ACCEPT"),
      z.literal("DECLINE"),
      z.literal("MODIFY"),
      z.literal("IGNORE"),
      z.literal("INITIATE")
    ]),
    includeDialogue: z.literal(true),
    includeReason: z.literal(true),
    includeCurrentGoal: z.literal(true)
  })
});

export type CharacterAgentRequest = z.infer<
  typeof characterAgentRequestSchema
>;

export const characterDecisionSchema = z.object({
  characterId: z.enum(["haru", "aoi"]),
  decision: characterDecisionTypeSchema,
  dialogue: z.string().trim().min(1).max(240),
  reason: z.string().trim().min(1).max(240),
  currentGoal: z.string().trim().min(1).max(160),
  scores: z.record(characterDecisionTypeSchema, z.number())
});

export type CharacterDecision = z.infer<typeof characterDecisionSchema>;
export type CharacterAgentMode = "mock" | "codex";

export interface CharacterAgentTransport {
  decide(request: CharacterAgentRequest): Promise<CharacterDecision>;
}
