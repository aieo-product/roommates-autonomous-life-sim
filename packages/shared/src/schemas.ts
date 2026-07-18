import { z } from "zod";
import {
  cueSafetyFlags,
  decisions,
  eventCategories,
  phases,
  relationshipLabels,
} from "./domain.js";
import { characterSettingsSchema } from "./personality.js";

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

export const resolvedEventSchema = z
  .object({
    eventTitle: text,
    narration: text,
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
  day: z.number().int().min(1).max(7),
  phase: z.string(),
  title: text,
  summary: text,
  emotionalImpact: z.number().min(-10).max(10),
  participants: z.array(z.string()),
  importance: z.number().min(0).max(10),
});

export const gameStateSchema = z.object({
  version: z.literal(1),
  seed: text,
  revision: z.number().int().nonnegative(),
  status: z.enum(["awaiting_suggestion", "resolving", "resolved", "ended"]),
  turnId: z.string().optional(),
  characters: z.object({
    haru: z.object({ state: characterStateSchema, lastDecision: characterDecisionSchema.optional(), internalSummary: z.string().optional() }),
    aoi: z.object({ state: characterStateSchema, lastDecision: characterDecisionSchema.optional(), internalSummary: z.string().optional() }),
  }),
  shared: z.object({
    day: z.number().int().min(1).max(7),
    phase: z.enum(phases),
    relationshipLabel: z.enum(relationshipLabels),
    unresolvedConflicts: z.array(z.string()),
    sharedMemories: z.array(memorySchema),
  }),
  lastEvent: resolvedEventSchema.optional(),
  eventLog: z.array(z.any()),
  ending: z.any().optional(),
  runtime: z.object({ haru: z.any(), aoi: z.any(), director: z.any() }),
});

export const turnRequestSchema = z.object({
  suggestion: z.string().max(500).default(""),
  idempotencyKey: z.string().min(1).max(100),
  revision: z.number().int().nonnegative(),
  characterSettings: characterSettingsSchema.optional(),
});

export const resetRequestSchema = z.object({ seed: z.string().trim().min(1).max(40).optional() }).default({});
