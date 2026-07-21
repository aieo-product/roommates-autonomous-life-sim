import { z } from "zod";
import {
  decisions,
  characterDisplayName,
  characterIdentitySchema,
  otherCharacterId,
  phases,
  relationshipLabels,
  type AgentResultReflection,
  type CharacterId,
  type CharacterRoster,
  type GameState,
} from "@roommates/shared";

export type { AgentResultReflection } from "@roommates/shared";

export const REFLECTION_VERSION = "reflection-v1" as const;

const publicText = z.string().trim().min(1).max(2_000);
const shortPublicText = z.string().trim().min(1).max(600);
const eventLogId = z.string().trim().min(1).max(200);

const publicCharacterStateSchema = z
  .object({
    energy: z.number().finite().min(0).max(100),
    stress: z.number().finite().min(0).max(100),
    affection: z.number().finite().min(0).max(100),
    trust: z.number().finite().min(0).max(100),
    romanticAwareness: z.number().finite().min(0).max(100),
    mood: shortPublicText,
    location: shortPublicText,
    currentGoal: shortPublicText,
  })
  .strict();

const publicReflectionEventSchema = z
  .object({
    eventLogId,
    day: z.number().int().min(1).max(7),
    phase: z.enum(phases),
    eventDefinitionId: z.string().trim().min(1).max(200),
    eventTitle: shortPublicText,
    narration: publicText,
    relationshipBefore: z.enum(relationshipLabels),
    relationshipAfter: z.enum(relationshipLabels),
    selfDecision: z.enum(decisions).optional(),
    selfAction: shortPublicText.optional(),
    selfDialogue: publicText.optional(),
    selfPublicReason: shortPublicText.optional(),
    memoryId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const publicReflectionMemorySchema = z
  .object({
    memoryId: z.string().trim().min(1).max(200),
    sourceEventLogId: z.string().trim().min(1).max(200).optional(),
    day: z.number().int().min(1).max(7),
    phase: z.string().trim().min(1).max(40),
    title: shortPublicText,
    summary: publicText,
  })
  .strict();

export const agentReflectionInputSchema = z
  .object({
    characterId: z.enum(["haru", "aoi"]),
    characterIdentity: characterIdentitySchema.optional(),
    otherCharacterIdentity: characterIdentitySchema.optional(),
    finalRelationship: z.enum(relationshipLabels),
    ending: z
      .object({
        kind: z.enum(["couple", "unspoken", "close_friends", "roommates", "broken"]),
        title: shortPublicText,
        narration: publicText,
      })
      .strict()
      .nullable(),
    selfFinalState: publicCharacterStateSchema,
    sharedEvents: z.array(publicReflectionEventSchema).max(64),
    selfMemories: z.array(publicReflectionMemorySchema).max(64),
    highlightEventLogIds: z.array(eventLogId).max(4),
  })
  .strict()
  .superRefine((input, context) => {
    const knownIds = new Set(input.sharedEvents.map((event) => event.eventLogId));
    const seen = new Set<string>();
    input.highlightEventLogIds.forEach((id, index) => {
      if (seen.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "highlightEventLogIds must not contain duplicates",
          path: ["highlightEventLogIds", index],
        });
      }
      if (!knownIds.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "highlightEventLogIds must reference a shared event",
          path: ["highlightEventLogIds", index],
        });
      }
      seen.add(id);
    });
  });

export type AgentReflectionInput = z.infer<typeof agentReflectionInputSchema>;

export const agentResultReflectionSchema = z
  .object({
    characterId: z.enum(["haru", "aoi"]),
    seasonImpression: z.string().trim().min(80).max(160),
    notableEventComments: z
      .array(
        z
          .object({
            eventLogId,
            comment: z.string().trim().min(1).max(240),
          })
          .strict(),
      )
      .max(4),
    bestMomentEventLogId: eventLogId.nullable(),
    turningPointEventLogId: eventLogId.nullable(),
    messageToProducer: z.string().trim().min(1).max(240),
    reflectionVersion: z.literal(REFLECTION_VERSION),
  })
  .strict();

/**
 * Narrows the static output schema to the IDs and character in a single request.
 * This prevents a model from referring to a scene it was not shown.
 */
export function agentResultReflectionSchemaFor(input: AgentReflectionInput) {
  return agentResultReflectionSchema.superRefine((output, context) => {
    const eventIds = new Set(input.sharedEvents.map((event) => event.eventLogId));
    const expectedCommentIds = new Set(input.highlightEventLogIds);
    const actualCommentIds = new Set<string>();

    if (output.characterId !== input.characterId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "characterId must match the requested character",
        path: ["characterId"],
      });
    }

    output.notableEventComments.forEach((comment, index) => {
      if (!expectedCommentIds.has(comment.eventLogId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "notable event comments may reference only selected highlights",
          path: ["notableEventComments", index, "eventLogId"],
        });
      }
      if (actualCommentIds.has(comment.eventLogId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "notable event comments must not contain duplicates",
          path: ["notableEventComments", index, "eventLogId"],
        });
      }
      actualCommentIds.add(comment.eventLogId);
    });

    for (const id of expectedCommentIds) {
      if (!actualCommentIds.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing notable event comment for ${id}`,
          path: ["notableEventComments"],
        });
      }
    }

    if (output.bestMomentEventLogId && !eventIds.has(output.bestMomentEventLogId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bestMomentEventLogId must reference a shared event",
        path: ["bestMomentEventLogId"],
      });
    }
    if (output.turningPointEventLogId && !eventIds.has(output.turningPointEventLogId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "turningPointEventLogId must reference a shared event",
        path: ["turningPointEventLogId"],
      });
    }
  });
}

function cleanPublicText(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLength);
}

/**
 * Creates an explicit public-information allowlist from a full GameState.
 * Never spread records from GameState here: they contain private summaries and
 * may gain scoring/raw-input fields in future versions.
 */
export function buildAgentReflectionInput(
  state: GameState,
  characterId: CharacterId,
  highlightEventLogIds: readonly string[],
  characterRoster: CharacterRoster | undefined = state.characterRoster,
): AgentReflectionInput {
  const selfPrefix = characterId === "haru" ? "haru" : "aoi";
  const sharedEvents = state.eventLog.map((event) => {
    const structuredDecision = event.decisions?.[characterId];
    return {
      eventLogId: event.id,
      day: event.day,
      phase: event.phase,
      eventDefinitionId: event.eventDefinitionId,
      eventTitle: cleanPublicText(event.eventTitle, 600) ?? "記録された出来事",
      narration: cleanPublicText(event.narration, 2_000) ?? "出来事の公開記録はありません。",
      relationshipBefore: event.relationshipBefore,
      relationshipAfter: event.relationshipAfter,
      selfDecision:
        structuredDecision?.decision ??
        (selfPrefix === "haru" ? event.haruDecision : event.aoiDecision),
      selfAction: cleanPublicText(
        structuredDecision?.action ??
          (selfPrefix === "haru" ? event.haruAction : event.aoiAction),
        600,
      ),
      selfDialogue: cleanPublicText(
        structuredDecision?.dialogue ??
          (selfPrefix === "haru" ? event.haruDialogue : event.aoiDialogue),
        2_000,
      ),
      selfPublicReason: cleanPublicText(
        structuredDecision?.publicReason ??
          (selfPrefix === "haru" ? event.haruPublicReason : event.aoiPublicReason),
        600,
      ),
      memoryId: event.memoryId ?? event.memory?.id,
    };
  });
  const eventIds = new Set(sharedEvents.map((event) => event.eventLogId));
  const uniqueHighlightIds = [...new Set(highlightEventLogIds)]
    .filter((id) => eventIds.has(id))
    .slice(0, 4);
  const selfState = state.characters[characterId].state;

  return agentReflectionInputSchema.parse({
    characterId,
    ...(characterRoster
      ? {
          characterIdentity: characterRoster[characterId],
          otherCharacterIdentity: characterRoster[otherCharacterId(characterId)],
        }
      : {}),
    finalRelationship: state.shared.relationshipLabel,
    ending: state.ending
      ? {
          kind: state.ending.kind,
          title: cleanPublicText(state.ending.title, 600) ?? "7日間の結末",
          narration: cleanPublicText(state.ending.narration, 2_000) ?? "結末の公開記録はありません。",
        }
      : null,
    selfFinalState: {
      energy: selfState.energy,
      stress: selfState.stress,
      affection: selfState.affection,
      trust: selfState.trust,
      romanticAwareness: selfState.romanticAwareness,
      mood: cleanPublicText(selfState.mood, 600) ?? "記録なし",
      location: cleanPublicText(selfState.location, 600) ?? "記録なし",
      currentGoal: cleanPublicText(selfState.currentGoal, 600) ?? "記録なし",
    },
    sharedEvents,
    selfMemories: state.shared.sharedMemories
      .filter((memory) => memory.participants.includes(characterId))
      .map((memory) => ({
        memoryId: memory.id,
        sourceEventLogId: memory.sourceEventId,
        day: memory.day,
        phase: memory.phase,
        title: cleanPublicText(memory.title, 600) ?? "記録された思い出",
        summary: cleanPublicText(memory.summary, 2_000) ?? "思い出の公開記録はありません。",
      })),
    highlightEventLogIds: uniqueHighlightIds,
  });
}

function unavailableSeasonImpression(characterId: CharacterId): string {
  return `${characterDisplayName(undefined, characterId)}のアフターインタビューを取得できませんでした。ログにない感情や出来事は補わず、7日間の各場面で保存された本人の公開発言と選択だけを振り返りとして表示し、推測による補完は行いません。`;
}

/** A non-generative failure path: it repeats only saved public material. */
export function fallbackAgentReflection(input: AgentReflectionInput): AgentResultReflection {
  const byId = new Map(input.sharedEvents.map((event) => [event.eventLogId, event]));
  const comments = input.highlightEventLogIds.map((id) => {
    const event = byId.get(id);
    const savedComment =
      event?.selfDialogue ??
      event?.selfPublicReason ??
      event?.selfAction ??
      "コメントを取得できませんでした。";
    return {
      eventLogId: id,
      comment: savedComment.slice(0, 240),
    };
  });
  const firstEvent = input.sharedEvents[0];
  const bestMomentEventLogId = input.highlightEventLogIds[0] ?? firstEvent?.eventLogId ?? null;

  return agentResultReflectionSchemaFor(input).parse({
    characterId: input.characterId,
    seasonImpression: input.characterIdentity
      ? `${input.characterIdentity.displayName}のアフターインタビューを取得できませんでした。ログにない感情や出来事は補わず、7日間の各場面で保存された本人の公開発言と選択だけを振り返りとして表示し、推測による補完は行いません。`
      : unavailableSeasonImpression(input.characterId),
    notableEventComments: comments,
    bestMomentEventLogId,
    turningPointEventLogId: null,
    messageToProducer:
      "アフターインタビューを取得できなかったため、保存済みログにない新しいメッセージはありません。",
    reflectionVersion: REFLECTION_VERSION,
  });
}
