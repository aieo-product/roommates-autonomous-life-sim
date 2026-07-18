import { z } from "zod";
import {
  cueSafetyFlags,
  decisions,
  eventCategories,
  phases,
  relationshipLabels,
} from "./domain.js";

const text = z.string().trim().min(1).max(2_000);
const cueText = z.string().trim().min(1).max(240);
const proposalTags = [...eventCategories, "pressure", "other"] as const;
const intimacyTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const producerCueSchema = z
  .object({
    kind: z.enum(["proposal", "observe"]),
    text: cueText,
    category: z.enum([...eventCategories, "unknown"]),
    tags: z.array(z.enum(proposalTags)),
    safetyFlags: z.array(z.enum(cueSafetyFlags)),
    transformed: z.boolean(),
  })
  .strict();

export const eventCandidateSchema = z
  .object({
    id: text,
    title: text,
    category: z.enum(eventCategories),
    intimacyTier: intimacyTierSchema,
  })
  .strict();

export const eventLockSchema = z
  .object({
    requestedEventId: text.optional(),
    reason: text,
    fallbackEventId: text,
  })
  .strict();

export const safeSuggestionSchema = z
  .object({
    kind: z.enum(["proposal", "observe"]),
    text: cueText,
    tags: z.array(z.enum(proposalTags)),
    cue: producerCueSchema,
    eventDefinitionId: text,
    eventTitle: text,
    intimacyTier: intimacyTierSchema,
    lock: eventLockSchema.optional(),
    alternatives: z.array(eventCandidateSchema),
  })
  .strict();

export const navigatorAgentOutputSchema = z
  .object({
    message: cueText,
  })
  .strict();

export const navigatorResponseSchema = navigatorAgentOutputSchema
  .extend({
    characterId: z.literal("navigator"),
    characterName: z.literal("デコピン"),
    eventDefinitionId: text,
    eventTitle: text,
    outcome: z.enum(["selected", "transformed", "locked_fallback", "observed"]),
  })
  .strict();

const effectBudgetSchema = z
  .object({
    energy: z.number().finite().min(0).max(10),
    stress: z.number().finite().min(0).max(10),
    affection: z.number().finite().min(0).max(10),
    trust: z.number().finite().min(0).max(10),
    romanticAwareness: z.number().finite().min(0).max(10),
  })
  .strict();

export const eventDefinitionSchema = z
  .object({
    id: text,
    title: text,
    category: z.enum(eventCategories),
    intimacyTier: intimacyTierSchema,
    allowedPhases: z.array(z.enum(phases)).min(1),
    minDay: z.number().int().min(1).max(7),
    maxDay: z.number().int().min(1).max(7),
    participantRange: z
      .object({
        min: z.number().int().min(0).max(2),
        max: z.number().int().min(0).max(2),
      })
      .strict(),
    location: text,
    durationMinutes: z.number().int().nonnegative(),
    preconditions: z
      .object({
        minEnergy: z.number().finite().min(0).max(100).optional(),
        maxStress: z.number().finite().min(0).max(100).optional(),
        minTrust: z.number().finite().min(0).max(100).optional(),
        minAffection: z.number().finite().min(0).max(100).optional(),
        minRomanticAwareness: z.number().finite().min(0).max(100).optional(),
        relationshipLabels: z.array(z.enum(relationshipLabels)).optional(),
        requiresConflict: z.boolean().optional(),
        requiresNoConflicts: z.boolean().optional(),
        minPositiveMemories: z.number().int().nonnegative().optional(),
      })
      .strict(),
    producerControls: z.array(text),
    characterChoices: z.array(z.enum(decisions)).min(1),
    effectBudget: effectBudgetSchema,
    cooldownPhases: z.number().int().nonnegative(),
    maxUsesPerDay: z.number().int().positive(),
    maxUsesPerRun: z.number().int().positive(),
    consent: z
      .object({
        allowPass: z.boolean(),
        allowModify: z.boolean(),
        physicalContact: z.enum(["none", "opt_in"]),
        secrets: z.enum(["forbidden", "optional"]),
      })
      .strict(),
    branches: z
      .object({
        bothParticipate: text,
        oneParticipates: text,
        bothDecline: text,
        modified: text,
      })
      .strict(),
    fallbackEventId: text,
    sourceNotes: z.array(text).optional(),
    safetyNotes: z.array(text),
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.minDay > definition.maxDay) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "minDay must be less than or equal to maxDay",
        path: ["minDay"],
      });
    }
    if (definition.participantRange.min > definition.participantRange.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "participantRange.min must be less than or equal to participantRange.max",
        path: ["participantRange", "min"],
      });
    }
    if (
      definition.preconditions.requiresConflict === true &&
      definition.preconditions.requiresNoConflicts === true
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "requiresConflict and requiresNoConflicts cannot both be true",
        path: ["preconditions"],
      });
    }
    for (const requiredChoice of ["ACCEPT", "MODIFY", "DECLINE", "IGNORE"] as const) {
      if (!definition.characterChoices.includes(requiredChoice)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing required character choice: ${requiredChoice}`,
          path: ["characterChoices"],
        });
      }
    }
  });

export const eventDefinitionCatalogSchema = z
  .array(eventDefinitionSchema)
  .min(3)
  .superRefine((definitions, context) => {
    const ids = new Set<string>();
    definitions.forEach((definition, index) => {
      if (ids.has(definition.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate event definition id: ${definition.id}`,
          path: [index, "id"],
        });
      }
      ids.add(definition.id);
    });
    definitions.forEach((definition, index) => {
      if (!ids.has(definition.fallbackEventId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown fallback event id: ${definition.fallbackEventId}`,
          path: [index, "fallbackEventId"],
        });
      }
    });
  });

export const statDeltaSchema = z
  .object({
    energy: z.number().finite().min(-100).max(100).optional(),
    stress: z.number().finite().min(-100).max(100).optional(),
    affection: z.number().finite().min(-100).max(100).optional(),
    trust: z.number().finite().min(-100).max(100).optional(),
    romanticAwareness: z.number().finite().min(-100).max(100).optional(),
  })
  .strict();

export const characterDecisionSchema = z
  .object({
    decision: z.enum(decisions),
    action: text,
    dialogue: z.string().max(2_000),
    publicReason: text,
    internalSummary: text,
    expectedEffects: statDeltaSchema.default({}),
  })
  .strict();

export const publicCharacterDecisionSchema = z
  .object({
    decision: z.enum(decisions),
    action: text,
    dialogue: z.string().max(2_000),
    publicReason: text,
  })
  .strict();

export const resolvedEventSchema = z
  .object({
    eventTitle: text,
    narration: text,
    navigatorMessage: cueText.optional(),
    haruDialogue: z.string().max(2_000),
    aoiDialogue: z.string().max(2_000),
    effects: z.object({ haru: statDeltaSchema, aoi: statDeltaSchema }).strict(),
    memory: z
      .object({
        title: text,
        summary: text,
        emotionalImpact: z.number().finite().min(-10).max(10),
        importance: z.number().finite().min(0).max(10),
      })
      .strict(),
    scene: z.object({ haru: text.optional(), aoi: text.optional() }).strict().optional(),
    conflictUpdate: z
      .object({ add: z.array(text).optional(), resolve: z.array(text).optional() })
      .strict()
      .optional(),
  })
  .strict();

export const characterStateSchema = z.object({
  energy: z.number().min(0).max(100),
  stress: z.number().min(0).max(100),
  affection: z.number().min(0).max(100),
  trust: z.number().min(0).max(100),
  romanticAwareness: z.number().min(0).max(100),
  mood: text,
  location: text,
  currentGoal: text,
});

export const memorySchema = z.object({
  id: text,
  sourceEventId: text.optional(),
  day: z.number().int().min(1).max(7),
  phase: z.string(),
  title: text,
  summary: text,
  emotionalImpact: z.number().min(-10).max(10),
  participants: z.array(z.string()),
  importance: z.number().min(0).max(10),
});

export const runtimeAgentStateSchema = z
  .object({
    source: z.enum(["app_server", "mock", "fallback"]),
    threadId: z.string().optional(),
    latencyMs: z.number().finite().nonnegative().optional(),
    error: z.string().max(2_000).optional(),
  })
  .strict();

export const endingSchema = z
  .object({
    kind: z.enum(["couple", "unspoken", "close_friends", "roommates", "broken"]),
    title: text,
    narration: text,
  })
  .strict();

export const turnStateSnapshotSchema = z
  .object({
    characters: z
      .object({ haru: characterStateSchema, aoi: characterStateSchema })
      .strict(),
    shared: z
      .object({
        relationshipLabel: z.enum(relationshipLabels),
        unresolvedConflicts: z.array(z.string()),
        memoryIds: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

export const eventLogEntrySchema = z
  .object({
    id: text,
    turnId: text.optional(),
    day: z.number().int().min(1).max(7),
    phase: z.enum(phases),
    eventDefinitionId: text,
    eventCategory: z.enum(eventCategories).optional(),
    intimacyTier: intimacyTierSchema.optional(),
    cooldownPhases: z.number().int().nonnegative().optional(),
    cueSafetyFlags: z.array(z.enum(cueSafetyFlags)),
    suggestion: z.string().max(2_000),
    haruReaction: z.string().max(2_000),
    aoiReaction: z.string().max(2_000),
    haruDecision: z.enum(decisions).optional(),
    aoiDecision: z.enum(decisions).optional(),
    haruAction: z.string().max(2_000).optional(),
    aoiAction: z.string().max(2_000).optional(),
    haruDialogue: z.string().max(2_000).optional(),
    aoiDialogue: z.string().max(2_000).optional(),
    haruPublicReason: z.string().max(2_000).optional(),
    aoiPublicReason: z.string().max(2_000).optional(),
    scene: z.object({ haru: text.optional(), aoi: text.optional() }).strict().optional(),
    memoryId: text.optional(),
    cue: producerCueSchema.optional(),
    inputMethod: z.enum(["free_text", "candidate", "observe", "fast_forward"]).optional(),
    requestedEventId: text.optional(),
    alternativesShown: z.array(eventCandidateSchema).optional(),
    lock: eventLockSchema.optional(),
    cueOutcome: z.enum(["selected", "transformed", "locked_fallback", "observed"]).optional(),
    navigatorMessage: cueText.optional(),
    navigatorResponse: navigatorResponseSchema.optional(),
    decisions: z
      .object({ haru: publicCharacterDecisionSchema, aoi: publicCharacterDecisionSchema })
      .strict()
      .optional(),
    resolutionBranch: z
      .enum(["both_participated", "one_participated", "both_declined", "modified", "self_initiated", "fallback"])
      .optional(),
    before: turnStateSnapshotSchema.optional(),
    after: turnStateSnapshotSchema.optional(),
    appliedEffects: z.object({ haru: statDeltaSchema, aoi: statDeltaSchema }).strict().optional(),
    memory: memorySchema.optional(),
    conflictUpdate: z
      .object({ add: z.array(z.string()), resolve: z.array(z.string()) })
      .strict()
      .optional(),
    runtimeSources: z
      .object({
        haru: z.enum(["app_server", "mock", "fallback"]),
        aoi: z.enum(["app_server", "mock", "fallback"]),
        director: z.enum(["app_server", "mock", "fallback"]),
        navigator: z.enum(["app_server", "mock", "fallback"]).optional(),
      })
      .strict()
      .optional(),
    eventTitle: text,
    narration: text,
    relationshipBefore: z.enum(relationshipLabels),
    relationshipAfter: z.enum(relationshipLabels),
    createdAt: z.string(),
  })
  .strict();

export const producerScoreEvidenceSchema = z
  .object({
    id: text,
    ruleId: text,
    points: z.number().finite(),
    message: text,
    eventLogIds: z.array(z.string()),
    day: z.number().int().min(1).max(7).optional(),
    phase: z.enum(phases).optional(),
  })
  .strict();

export const resultHighlightSchema = z
  .object({
    id: text,
    kind: z.enum([
      "relationship_turn",
      "self_initiated",
      "respected_no",
      "conflict_repaired",
      "quiet_moment",
      "important_memory",
    ]),
    headline: text,
    reason: text,
    eventLogIds: z.array(z.string()).min(1),
    memoryId: z.string().optional(),
  })
  .strict();

export const producerResultSchema = z
  .object({
    overallScore: z.number().int().min(0).max(100),
    rank: z.enum(["S", "A", "B", "C"]),
    producerStyle: z.enum([
      "space_maker",
      "condition_reader",
      "relationship_mender",
      "pace_designer",
      "turning_point_editor",
    ]),
    scoringVersion: text,
    axes: z.array(
      z
        .object({
          id: z.enum(["agency", "wellbeing", "care", "pacing", "story"]),
          label: text,
          score: z.number().int().nonnegative(),
          maxScore: z.number().int().positive(),
          summary: text,
          evidence: z.array(producerScoreEvidenceSchema),
        })
        .strict(),
    ),
    topStrengths: z.array(producerScoreEvidenceSchema),
    improvements: z.array(producerScoreEvidenceSchema),
    highlights: z.array(resultHighlightSchema).max(4),
    keyMemoryIds: z.array(z.string()),
    turningPointEventLogIds: z.array(z.string()),
    statJourney: z
      .object({ start: turnStateSnapshotSchema, end: turnStateSnapshotSchema })
      .strict()
      .optional(),
    coverage: z
      .object({
        ratio: z.number().finite().min(0).max(1),
        completeTurns: z.number().int().nonnegative(),
        expectedTurns: z.number().int().positive(),
        missing: z.array(z.string()),
      })
      .strict(),
    warnings: z.array(z.string()),
  })
  .strict();

export const narrativeParagraphSchema = z
  .object({ text, sourceEventLogIds: z.array(z.string()) })
  .strict();

export const resultNarrativeSchema = z
  .object({
    headline: text,
    lead: z.array(narrativeParagraphSchema),
    daySections: z.array(
      z
        .object({
          day: z.number().int().min(1).max(7),
          title: text,
          paragraphs: z.array(narrativeParagraphSchema),
          featuredEventLogId: z.string().optional(),
        })
        .strict(),
    ),
    closing: z.array(narrativeParagraphSchema),
    narrativeVersion: text,
  })
  .strict();

export const agentResultReflectionSchema = z
  .object({
    characterId: z.enum(["haru", "aoi"]),
    seasonImpression: text,
    notableEventComments: z.array(
      z.object({ eventLogId: text, comment: text }).strict(),
    ),
    bestMomentEventLogId: z.string().nullable(),
    turningPointEventLogId: z.string().nullable(),
    messageToProducer: text,
    reflectionVersion: text,
    runtime: runtimeAgentStateSchema.optional(),
  })
  .strict();

const resultIdentityShape = {
  generationKey: text,
  endingRevision: z.number().int().nonnegative(),
  scoringVersion: text,
  narrativeVersion: text,
  reflectionVersion: text,
};

export const gameResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...resultIdentityShape,
      status: z.literal("generating"),
      ending: endingSchema,
      producer: producerResultSchema,
      startedAt: z.string(),
    })
    .strict(),
  z
    .object({
      ...resultIdentityShape,
      status: z.literal("ready"),
      ending: endingSchema,
      producer: producerResultSchema,
      narrative: resultNarrativeSchema,
      reflections: z.object({ haru: agentResultReflectionSchema, aoi: agentResultReflectionSchema }).strict(),
      generatedAt: z.string(),
      dataQuality: z.literal("complete"),
    })
    .strict(),
  z
    .object({
      ...resultIdentityShape,
      status: z.literal("partial"),
      ending: endingSchema,
      producer: producerResultSchema,
      narrative: resultNarrativeSchema.optional(),
      reflections: z.object({ haru: agentResultReflectionSchema, aoi: agentResultReflectionSchema }).partial().strict(),
      failures: z.array(
        z
          .object({
            component: z.enum(["narrative", "haru_reflection", "aoi_reflection"]),
            reason: text,
            retryable: z.boolean(),
          })
          .strict(),
      ),
      generatedAt: z.string(),
      dataQuality: z.literal("partial"),
    })
    .strict(),
]);

const persistedGameStateShape = {
  seed: text,
  revision: z.number().int().nonnegative(),
  status: z.enum(["awaiting_suggestion", "resolving", "resolved", "ended"]),
  turnId: z.string().optional(),
  shared: z.object({
    day: z.number().int().min(1).max(7),
    phase: z.enum(phases),
    relationshipLabel: z.enum(relationshipLabels),
    unresolvedConflicts: z.array(z.string()),
    sharedMemories: z.array(memorySchema),
  }),
  lastEvent: resolvedEventSchema.optional(),
  navigator: navigatorResponseSchema.optional(),
  eventLog: z.array(eventLogEntrySchema),
  ending: endingSchema.optional(),
  result: gameResultSchema.optional(),
  runtime: z.object({
    haru: runtimeAgentStateSchema,
    aoi: runtimeAgentStateSchema,
    director: runtimeAgentStateSchema,
    navigator: runtimeAgentStateSchema.optional(),
  }),
};

const characterRecordSchema = z
  .object({
    state: characterStateSchema,
    lastDecision: publicCharacterDecisionSchema.optional(),
  })
  .strict();

const legacyCharacterDecisionSchema = characterDecisionSchema.transform(
  ({ decision, action, dialogue, publicReason }) => ({
    decision,
    action,
    dialogue,
    publicReason,
  }),
);

const legacyCharacterRecordSchema = z
  .object({
    state: characterStateSchema,
    lastDecision: legacyCharacterDecisionSchema.optional(),
    internalSummary: z.string().optional(),
  })
  .transform(({ state, lastDecision }) => ({
    state,
    ...(lastDecision === undefined ? {} : { lastDecision }),
  }));

const gameStateV2Schema = z.object({
  version: z.literal(2),
  ...persistedGameStateShape,
  characters: z
    .object({ haru: characterRecordSchema, aoi: characterRecordSchema })
    .strict(),
});

const gameStateV1Schema = z
  .object({
    version: z.literal(1),
    ...persistedGameStateShape,
    characters: z
      .object({ haru: legacyCharacterRecordSchema, aoi: legacyCharacterRecordSchema })
      .strict(),
  })
  .transform((state) => ({ ...state, version: 2 as const }));

export const gameStateSchema = z.union([gameStateV2Schema, gameStateV1Schema]);

export const turnRequestSchema = z.object({
  suggestion: z.string().max(500).default(""),
  idempotencyKey: z.string().min(1).max(100),
  revision: z.number().int().nonnegative(),
});

export const resetRequestSchema = z.object({ seed: z.string().trim().min(1).max(40).optional() }).default({});
