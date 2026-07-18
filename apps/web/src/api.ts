import type {
  AgentDecision,
  CharacterState,
  GameEvent,
  GameState,
  Memory,
  Phase,
  RelationshipLabel,
  RuntimeInfo,
  StreamMessage,
} from "./types.js";
import type {
  ResultAgentReflection,
  ResultEnding,
  ResultEvidence,
  ResultFailure,
  ResultNarrative,
  ResultProducer,
  ResultScreenData,
} from "./result/types.js";

type JsonRecord = Record<string, unknown>;

const initialCharacter = (name: "haru" | "aoi"): CharacterState => ({
  energy: name === "haru" ? 70 : 65,
  stress: name === "haru" ? 25 : 30,
  affection: 20,
  trust: 30,
  romanticAwareness: 5,
  mood: name === "haru" ? "少し緊張している" : "新生活にわくわく",
  location: "リビング",
  currentGoal: name === "haru" ? "新しい生活に慣れる" : "居心地のいい部屋にする",
});

export const INITIAL_GAME_STATE: GameState = {
  version: 2,
  seed: "demo-heart",
  revision: 0,
  status: "awaiting_suggestion",
  haru: initialCharacter("haru"),
  aoi: initialCharacter("aoi"),
  shared: {
    day: 1,
    phase: "morning",
    relationshipLabel: "roommates",
    unresolvedConflicts: [],
    sharedMemories: [],
  },
  decisions: {},
  eventLog: [],
  runtime: { mode: "unknown" },
  completed: false,
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

const first = (...values: unknown[]): unknown =>
  values.find((value) => value !== undefined && value !== null);

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value : fallback;

const numeric = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
};

const finiteNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const normalizePhase = (value: unknown, fallback: Phase): Phase => {
  const normalized = text(value).toLowerCase();
  return ["morning", "afternoon", "evening", "night"].includes(normalized)
    ? (normalized as Phase)
    : fallback;
};

const normalizeRelationship = (
  value: unknown,
  fallback: RelationshipLabel,
): RelationshipLabel => {
  const normalized = text(value).toLowerCase();
  return [
    "strangers",
    "roommates",
    "friends",
    "close_friends",
    "romantic_tension",
    "couple",
    "broken",
  ].includes(normalized)
    ? (normalized as RelationshipLabel)
    : fallback;
};

const normalizeCharacter = (
  value: unknown,
  fallback: CharacterState,
): CharacterState => {
  const outer = record(value);
  const source = record(first(outer.state, outer));
  const stats = record(first(source.stats, source.status));
  return {
    energy: numeric(first(source.energy, stats.energy), fallback.energy),
    stress: numeric(first(source.stress, stats.stress), fallback.stress),
    affection: numeric(first(source.affection, stats.affection), fallback.affection),
    trust: numeric(first(source.trust, stats.trust), fallback.trust),
    romanticAwareness: numeric(
      first(
        source.romanticAwareness,
        source.romantic_awareness,
        stats.romanticAwareness,
      ),
      fallback.romanticAwareness,
    ),
    mood: text(first(source.mood, source.emotion), fallback.mood),
    location: text(source.location, fallback.location),
    currentGoal: text(
      first(source.currentGoal, source.current_goal, source.goal),
      fallback.currentGoal,
    ),
  };
};

const normalizeMemory = (value: unknown, index: number): Memory | undefined => {
  const source = record(value);
  const title = text(source.title);
  if (!title) return undefined;
  return {
    id: text(source.id, `memory-${index}-${title}`),
    sourceEventId:
      text(first(source.sourceEventId, source.source_event_id, source.eventLogId)) ||
      undefined,
    day: numeric(source.day, 1),
    phase: text(source.phase, "morning"),
    title,
    summary: text(source.summary),
    emotionalImpact: Number(source.emotionalImpact ?? source.emotional_impact ?? 0),
    participants: Array.isArray(source.participants)
      ? source.participants.filter((item): item is string => typeof item === "string")
      : ["Haru", "Aoi"],
    importance: numeric(source.importance, 5),
  };
};

const normalizeDecision = (value: unknown): AgentDecision | undefined => {
  const source = record(value);
  const decision = text(first(source.decision, source.choice)).toUpperCase();
  const allowed = ["ACCEPT", "DECLINE", "MODIFY", "IGNORE", "INITIATE"];
  if (!allowed.includes(decision)) return undefined;
  return {
    decision: decision as AgentDecision["decision"],
    action: text(source.action, "自分のペースで過ごす"),
    dialogue: text(source.dialogue) || undefined,
    publicReason: text(first(source.publicReason, source.public_reason)) || undefined,
  };
};

const normalizeDecisionType = (value: unknown): AgentDecision["decision"] | undefined => {
  const decision = text(value).toUpperCase();
  return ["ACCEPT", "DECLINE", "MODIFY", "IGNORE", "INITIATE"].includes(decision)
    ? (decision as AgentDecision["decision"])
    : undefined;
};

const actionFromReaction = (value: string): string | undefined => {
  if (!value) return undefined;
  const separator = value.indexOf(":");
  return separator >= 0 ? value.slice(separator + 1).trim() || undefined : value;
};

const normalizeSnapshot = (
  value: unknown,
): NonNullable<GameEvent["before"]> | undefined => {
  const source = record(value);
  const characters = record(source.characters);
  const normalizeSnapshotCharacter = (character: unknown) => {
    const state = record(character);
    if (!Object.keys(state).length) return undefined;
    return {
      energy: numeric(state.energy, 0),
      stress: numeric(state.stress, 0),
      affection: numeric(state.affection, 0),
      trust: numeric(state.trust, 0),
      romanticAwareness: numeric(
        first(state.romanticAwareness, state.romantic_awareness),
        0,
      ),
      mood: text(state.mood) || undefined,
      location: text(state.location) || undefined,
      currentGoal: text(first(state.currentGoal, state.current_goal)) || undefined,
    };
  };
  const haru = normalizeSnapshotCharacter(first(characters.haru, source.haru));
  const aoi = normalizeSnapshotCharacter(first(characters.aoi, source.aoi));
  const shared = record(source.shared);
  if (!haru && !aoi && !Object.keys(shared).length) return undefined;
  return {
    characters: {
      ...(haru ? { haru } : {}),
      ...(aoi ? { aoi } : {}),
    },
    shared: Object.keys(shared).length
      ? {
          relationshipLabel: normalizeRelationship(
            shared.relationshipLabel,
            "roommates",
          ),
          unresolvedConflictIds: stringArray(
            first(shared.unresolvedConflictIds, shared.unresolvedConflicts),
          ),
          memoryIds: stringArray(shared.memoryIds),
        }
      : undefined,
  };
};

const normalizeStatDelta = (value: unknown) => {
  const source = record(value);
  const result: Partial<Record<"energy" | "stress" | "affection" | "trust" | "romanticAwareness", number>> = {};
  for (const key of ["energy", "stress", "affection", "trust", "romanticAwareness"] as const) {
    if (Number.isFinite(Number(source[key]))) result[key] = Number(source[key]);
  }
  return Object.keys(result).length ? result : undefined;
};

const publicDecision = (value: unknown) => {
  const decision = normalizeDecision(value);
  if (!decision) return undefined;
  return {
    decision: decision.decision,
    action: decision.action,
    dialogue: decision.dialogue,
    publicReason: decision.publicReason,
  };
};

const normalizeEvent = (
  value: unknown,
  fallbackDay: number,
  fallbackPhase: Phase,
  index = 0,
): GameEvent | undefined => {
  const source = record(value);
  const director = record(first(source.director, source.directorResult, source.result));
  const merged = Object.keys(director).length ? { ...source, ...director } : source;
  const eventTitle = text(first(merged.eventTitle, merged.title, merged.event_title));
  const narration = text(first(merged.narration, merged.summary, merged.description));
  if (!eventTitle && !narration) return undefined;
  const phase = normalizePhase(merged.phase, fallbackPhase);
  const day = numeric(merged.day, fallbackDay);
  const haruReaction = text(first(merged.haruReaction, merged.haru_reaction));
  const aoiReaction = text(first(merged.aoiReaction, merged.aoi_reaction));
  const structuredDecisions = record(merged.decisions);
  const haruStructuredDecision = publicDecision(structuredDecisions.haru);
  const aoiStructuredDecision = publicDecision(structuredDecisions.aoi);
  const scene = record(first(merged.scene, merged.sceneSnapshot, merged.scene_snapshot));
  const haruLocation = text(first(scene.haru, scene.Haru, merged.haruLocation));
  const aoiLocation = text(first(scene.aoi, scene.Aoi, merged.aoiLocation));
  const cue = record(merged.cue);
  const navigatorResponse = record(
    first(merged.navigatorResponse, merged.navigator_response, merged.navigator),
  );
  const rawCueResolution = record(merged.cueResolution);
  const resolvedCue = record(first(rawCueResolution.cue, cue));
  const selectedEvent = record(rawCueResolution.selectedEvent);
  const lock = record(first(rawCueResolution.lock, merged.lock));
  const appliedEffects = record(merged.appliedEffects);
  const conflictUpdate = record(merged.conflictUpdate);
  const addedConflicts = Array.isArray(conflictUpdate.added)
    ? conflictUpdate.added.flatMap((item) => {
        const entry = record(item);
        const id = text(entry.id);
        return id ? [{ id, summary: text(entry.summary) || undefined }] : [];
      })
    : undefined;
  const normalizedMemory = normalizeMemory(merged.memory, index);
  const relationshipBefore = text(merged.relationshipBefore);
  const relationshipAfter = text(merged.relationshipAfter);
  const cueSafetyFlags = stringArray(
    first(resolvedCue.safetyFlags, merged.cueSafetyFlags),
  );
  const cueText = text(first(resolvedCue.text, cue.text, merged.suggestion, merged.proposal));
  const cueOutcome = text(first(rawCueResolution.outcome, merged.cueOutcome));
  const selectedEventId = text(
    first(selectedEvent.id, merged.eventDefinitionId, merged.event_definition_id),
  );
  const selectedEventTitle = text(first(selectedEvent.title, eventTitle));
  const selectedEventCategory = text(first(selectedEvent.category, merged.eventCategory));
  const selectedEventTier = finiteNumber(
    first(selectedEvent.intimacyTier, merged.intimacyTier),
    Number.NaN,
  );
  return {
    id: text(merged.id, `event-${day}-${phase}-${index}-${eventTitle}`),
    eventDefinitionId:
      text(
        first(
          merged.eventDefinitionId,
          merged.event_definition_id,
          merged.definitionId,
          merged.definition_id,
        ),
      ) || undefined,
    memoryId: text(first(merged.memoryId, merged.memory_id)) || undefined,
    day,
    phase,
    eventTitle: eventTitle || "ふたりの時間",
    narration,
    haruDialogue:
      text(first(merged.haruDialogue, merged.haru_dialogue)) || undefined,
    aoiDialogue: text(first(merged.aoiDialogue, merged.aoi_dialogue)) || undefined,
    haruDecision:
      normalizeDecisionType(
        first(
          merged.haruDecision,
          merged.haru_decision,
          haruStructuredDecision?.decision,
          haruReaction.split(":")[0],
        ),
      ),
    aoiDecision:
      normalizeDecisionType(
        first(
          merged.aoiDecision,
          merged.aoi_decision,
          aoiStructuredDecision?.decision,
          aoiReaction.split(":")[0],
        ),
      ),
    haruAction:
      text(first(merged.haruAction, merged.haru_action, haruStructuredDecision?.action)) ||
      actionFromReaction(haruReaction),
    aoiAction:
      text(first(merged.aoiAction, merged.aoi_action, aoiStructuredDecision?.action)) ||
      actionFromReaction(aoiReaction),
    haruPublicReason:
      text(first(merged.haruPublicReason, merged.haru_public_reason, haruStructuredDecision?.publicReason)) || undefined,
    aoiPublicReason:
      text(first(merged.aoiPublicReason, merged.aoi_public_reason, aoiStructuredDecision?.publicReason)) || undefined,
    scene:
      haruLocation || aoiLocation
        ? {
            ...(haruLocation ? { haru: haruLocation } : {}),
            ...(aoiLocation ? { aoi: aoiLocation } : {}),
          }
        : undefined,
    suggestion: cueText || undefined,
    navigatorMessage:
      text(
        first(
          merged.navigatorMessage,
          merged.navigator_message,
          merged.dekopinMessage,
          merged.dekopin_message,
          navigatorResponse.message,
        ),
      ) || undefined,
    cueSafetyFlags,
    decisions:
      haruStructuredDecision || aoiStructuredDecision
        ? {
            ...(haruStructuredDecision ? { haru: haruStructuredDecision } : {}),
            ...(aoiStructuredDecision ? { aoi: aoiStructuredDecision } : {}),
          }
        : undefined,
    resolutionBranch: text(merged.resolutionBranch) || undefined,
    before: normalizeSnapshot(merged.before),
    after: normalizeSnapshot(merged.after),
    appliedEffects:
      Object.keys(appliedEffects).length
        ? {
            ...(normalizeStatDelta(appliedEffects.haru)
              ? { haru: normalizeStatDelta(appliedEffects.haru)! }
              : {}),
            ...(normalizeStatDelta(appliedEffects.aoi)
              ? { aoi: normalizeStatDelta(appliedEffects.aoi)! }
              : {}),
          }
        : undefined,
    memory: normalizedMemory,
    conflictUpdate:
      Object.keys(conflictUpdate).length
        ? {
            add: stringArray(conflictUpdate.add),
            resolve: stringArray(conflictUpdate.resolve),
            added: addedConflicts,
            resolvedIds: stringArray(conflictUpdate.resolvedIds),
          }
        : undefined,
    cueResolution:
      cueText || selectedEventId || selectedEventTitle || cueOutcome || Object.keys(lock).length
        ? {
            cue: cueText || cueSafetyFlags.length || resolvedCue.transformed === true
              ? {
                  text: cueText || undefined,
                  safetyFlags: cueSafetyFlags,
                  transformed: resolvedCue.transformed === true,
                }
              : undefined,
            selectedEvent: selectedEventId || selectedEventTitle
              ? {
                  id: selectedEventId || undefined,
                  title: selectedEventTitle || undefined,
                  category: selectedEventCategory || undefined,
                  intimacyTier: Number.isFinite(selectedEventTier) ? selectedEventTier : undefined,
                }
              : undefined,
            outcome: cueOutcome || undefined,
            lock: Object.keys(lock).length
              ? { reason: text(lock.reason) || undefined }
              : undefined,
          }
        : undefined,
    relationshipBefore: relationshipBefore
      ? normalizeRelationship(relationshipBefore, "roommates")
      : undefined,
    relationshipAfter: relationshipAfter
      ? normalizeRelationship(relationshipAfter, "roommates")
      : undefined,
    timestamp: text(first(merged.timestamp, merged.createdAt, merged.created_at)) || undefined,
  };
};

const normalizeRuntime = (
  root: JsonRecord,
  fallback: RuntimeInfo,
): RuntimeInfo => {
  const runtime = record(first(root.runtime, root.agentRuntime, root.appServer));
  const haruRuntime = record(first(runtime.haru, runtime.Haru));
  const aoiRuntime = record(first(runtime.aoi, runtime.Aoi));
  const directorRuntime = record(first(runtime.director, runtime.Director));
  const runtimeSources = [haruRuntime.source, aoiRuntime.source, directorRuntime.source]
    .map((source) => text(source).toLowerCase())
    .filter(Boolean);
  const rawMode = text(
    first(
      runtime.mode,
      root.runtimeMode,
      root.runtime_mode,
      runtime.connected === true ? "app-server" : undefined,
      runtimeSources.some((source) => source === "app_server")
        ? "app-server"
        : runtimeSources.length
          ? "mock"
          : undefined,
    ),
    fallback.mode,
  ).toLowerCase();
  const mode: RuntimeInfo["mode"] = rawMode.includes("mock")
    ? "mock"
    : rawMode.includes("offline")
      ? "offline"
      : rawMode.includes("app") || rawMode.includes("codex") || rawMode === "live"
        ? "app-server"
        : fallback.mode;
  const threads = record(first(runtime.threads, root.threads, root.threadIds));
  return {
    mode,
    label: text(runtime.label) || fallback.label,
    model: text(first(runtime.model, root.model)) || fallback.model,
    haruThreadId:
      text(first(runtime.haruThreadId, haruRuntime.threadId, threads.haru, threads.Haru)) ||
      fallback.haruThreadId,
    aoiThreadId:
      text(first(runtime.aoiThreadId, aoiRuntime.threadId, threads.aoi, threads.Aoi)) ||
      fallback.aoiThreadId,
    directorThreadId:
      text(
        first(
          runtime.directorThreadId,
          directorRuntime.threadId,
          threads.director,
          threads.Director,
        ),
      ) ||
      fallback.directorThreadId,
  };
};

const normalizeEndingObject = (
  value: unknown,
  relationship: RelationshipLabel,
): ResultEnding => {
  const source = record(value);
  const legacyText = text(value);
  const kind = text(source.kind, relationship);
  return {
    kind,
    title: text(
      source.title,
      relationship === "couple"
        ? "ふたりは、恋人になった。"
        : "ふたりが選んだ、これから。",
    ),
    narration: text(source.narration, legacyText || "二人の7日間が終わりました。"),
  };
};

const normalizeEnding = (
  value: unknown,
  relationship: RelationshipLabel,
): ResultEnding | string | undefined => {
  if (typeof value === "string") return text(value) || undefined;
  return Object.keys(record(value)).length
    ? normalizeEndingObject(value, relationship)
    : undefined;
};

const normalizeEvidence = (value: unknown, index: number): ResultEvidence | undefined => {
  const source = record(value);
  const message = text(source.message);
  if (!message) return undefined;
  return {
    id: text(source.id, `evidence-${index}`),
    ruleId: text(source.ruleId) || undefined,
    points: finiteNumber(source.points),
    message,
    eventLogIds: stringArray(source.eventLogIds),
  };
};

const normalizeEvidenceList = (value: unknown): ResultEvidence[] =>
  Array.isArray(value)
    ? value
        .map(normalizeEvidence)
        .filter((item): item is ResultEvidence => item !== undefined)
    : [];

const normalizeProducer = (value: unknown): ResultProducer | undefined => {
  const source = record(value);
  if (!Object.keys(source).length) return undefined;
  const allowedAxes = ["agency", "wellbeing", "care", "pacing", "story"] as const;
  const axes = Array.isArray(source.axes)
    ? source.axes.flatMap((item) => {
        const axis = record(item);
        const id = text(axis.id);
        if (!allowedAxes.includes(id as (typeof allowedAxes)[number])) return [];
        return [{
          id: id as (typeof allowedAxes)[number],
          score: numeric(axis.score, 0),
          maxScore: Math.max(1, finiteNumber(axis.maxScore, 20)),
          summary: text(axis.summary, "評価データを確認しています。"),
          evidence: normalizeEvidenceList(axis.evidence),
        }];
      })
    : [];
  const rankValue = text(source.rank).toUpperCase();
  const rank: ResultProducer["rank"] = ["S", "A", "B", "C"].includes(rankValue)
    ? (rankValue as ResultProducer["rank"])
    : "C";
  const coverage = record(source.coverage);
  const rawHighlights = Array.isArray(source.highlights) ? source.highlights : [];
  return {
    overallScore: numeric(source.overallScore, 0),
    rank,
    producerStyle: text(source.producerStyle, "space_maker"),
    scoringVersion: text(source.scoringVersion, "unknown"),
    axes,
    topStrengths: normalizeEvidenceList(source.topStrengths),
    improvements: normalizeEvidenceList(source.improvements),
    highlights: rawHighlights.flatMap((item, index) => {
      const highlight = record(item);
      const headline = text(highlight.headline);
      if (!headline) return [];
      return [{
        id: text(highlight.id, `highlight-${index}`),
        kind: text(highlight.kind, "important_memory"),
        headline,
        reason: text(highlight.reason),
        eventLogIds: stringArray(highlight.eventLogIds),
        memoryId: text(highlight.memoryId) || undefined,
      }];
    }),
    highlightEventLogIds: stringArray(source.highlightEventLogIds),
    keyMemoryIds: stringArray(source.keyMemoryIds),
    turningPointEventLogIds: stringArray(source.turningPointEventLogIds),
    statJourney: Object.keys(record(source.statJourney)).length
      ? {
          start: normalizeSnapshot(record(source.statJourney).start) ?? { characters: {} },
          end: normalizeSnapshot(record(source.statJourney).end) ?? { characters: {} },
        }
      : undefined,
    coverage: typeof source.coverage === "number"
      ? numeric(source.coverage, 0)
      : Object.keys(coverage).length
        ? {
            ratio: numeric(coverage.ratio, 0),
            completeTurns: Math.max(0, Math.round(finiteNumber(coverage.completeTurns))),
            expectedTurns: Math.max(0, Math.round(finiteNumber(coverage.expectedTurns, 28))),
            missing: stringArray(coverage.missing),
          }
        : undefined,
    warnings: stringArray(source.warnings),
  };
};

const normalizeNarrativeParagraphs = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const paragraph = record(item);
        const paragraphText = text(paragraph.text);
        return paragraphText
          ? [{ text: paragraphText, sourceEventLogIds: stringArray(paragraph.sourceEventLogIds) }]
          : [];
      })
    : text(value) || undefined;

const normalizeNarrative = (value: unknown): ResultNarrative | undefined => {
  const source = record(value);
  if (!Object.keys(source).length) return undefined;
  const headline = text(source.headline);
  if (!headline) return undefined;
  const daySections = Array.isArray(source.daySections)
    ? source.daySections.flatMap((item) => {
        const section = record(item);
        const sectionDay = Math.round(finiteNumber(section.day));
        if (sectionDay < 1 || sectionDay > 7) return [];
        const paragraphs = normalizeNarrativeParagraphs(section.paragraphs);
        return [{
          day: sectionDay,
          title: text(section.title, `Day ${sectionDay}の記録`),
          paragraphs: Array.isArray(paragraphs) ? paragraphs : undefined,
          featuredEventLogId: text(section.featuredEventLogId) || undefined,
          body: text(section.body) || undefined,
          sourceEventLogIds: stringArray(section.sourceEventLogIds),
        }];
      })
    : [];
  const lead = normalizeNarrativeParagraphs(source.lead);
  const closing = normalizeNarrativeParagraphs(source.closing);
  return {
    headline,
    lead: lead ?? [],
    daySections,
    closing: closing ?? [],
    sourceEventLogIds: stringArray(source.sourceEventLogIds),
    narrativeVersion: text(source.narrativeVersion, "unknown"),
  };
};

const normalizeReflection = (
  value: unknown,
  characterId: "haru" | "aoi",
): ResultAgentReflection | undefined => {
  const source = record(value);
  if (!Object.keys(source).length) return undefined;
  return {
    characterId,
    seasonImpression: text(source.seasonImpression),
    notableEventComments: Array.isArray(source.notableEventComments)
      ? source.notableEventComments.flatMap((item) => {
          const comment = record(item);
          const eventLogId = text(comment.eventLogId);
          const commentText = text(comment.comment);
          return eventLogId && commentText ? [{ eventLogId, comment: commentText }] : [];
        })
      : [],
    bestMomentEventLogId: text(source.bestMomentEventLogId) || null,
    turningPointEventLogId: text(source.turningPointEventLogId) || null,
    messageToProducer: text(source.messageToProducer),
    reflectionVersion: text(source.reflectionVersion, "unknown"),
  };
};

const normalizeFailure = (value: unknown): ResultFailure | undefined => {
  const source = record(value);
  const component = text(source.component);
  const reason = text(source.reason);
  if (!component || !reason) return undefined;
  return { component, reason, retryable: source.retryable === true };
};

const normalizeResult = (
  value: unknown,
  fallbackEnding: unknown,
  relationship: RelationshipLabel,
): ResultScreenData | undefined => {
  const source = record(value);
  const producer = normalizeProducer(source.producer);
  const status = text(source.status).toLowerCase();
  if (!producer || !["generating", "ready", "partial"].includes(status)) return undefined;
  const ending = normalizeEndingObject(first(source.ending, fallbackEnding), relationship);
  const narrative = normalizeNarrative(source.narrative);
  const reflections = record(source.reflections);
  const haru = normalizeReflection(reflections.haru, "haru");
  const aoi = normalizeReflection(reflections.aoi, "aoi");
  const base = {
    ending,
    producer,
    generationKey: text(source.generationKey) || undefined,
    endingRevision: Number.isFinite(Number(source.endingRevision))
      ? Math.max(0, Math.round(Number(source.endingRevision)))
      : undefined,
    narrativeVersion: text(source.narrativeVersion) || undefined,
    reflectionVersion: text(source.reflectionVersion) || undefined,
  };
  if (status === "generating") {
    return {
      ...base,
      status: "generating",
      startedAt: text(source.startedAt) || undefined,
      narrative,
      reflections: { ...(haru ? { haru } : {}), ...(aoi ? { aoi } : {}) },
      dataQuality: source.dataQuality === "complete" ? "complete" : "partial",
    };
  }
  if (status === "ready" && narrative && haru && aoi) {
    return {
      ...base,
      status: "ready",
      narrative,
      reflections: { haru, aoi },
      generatedAt: text(source.generatedAt) || undefined,
      dataQuality: "complete",
    };
  }
  const rawFailures = Array.isArray(source.failures)
    ? source.failures
        .map(normalizeFailure)
        .filter((item): item is ResultFailure => item !== undefined)
    : [];
  if (status === "ready") {
    if (!narrative) rawFailures.push({ component: "narrative", reason: "総集編データがありません", retryable: false });
    if (!haru) rawFailures.push({ component: "haru_reflection", reason: "Haruの感想データがありません", retryable: false });
    if (!aoi) rawFailures.push({ component: "aoi_reflection", reason: "Aoiの感想データがありません", retryable: false });
  }
  return {
    ...base,
    status: "partial",
    narrative,
    reflections: { ...(haru ? { haru } : {}), ...(aoi ? { aoi } : {}) },
    failures: rawFailures,
    generatedAt: text(source.generatedAt) || undefined,
    dataQuality: "partial",
  };
};

const unwrapState = (payload: unknown): JsonRecord => {
  const outer = record(payload);
  const data = record(outer.data);
  return record(
    first(
      outer.gameState,
      outer.game,
      outer.state,
      data.gameState,
      data.game,
      data.state,
      Object.keys(data).length ? data : undefined,
      outer,
    ),
  );
};

export const normalizeGameState = (
  payload: unknown,
  previous: GameState = INITIAL_GAME_STATE,
): GameState => {
  const root = unwrapState(payload);
  const characters = record(first(root.characters, root.characterStates, root.agents));
  const haruRecord = record(first(characters.haru, characters.Haru));
  const aoiRecord = record(first(characters.aoi, characters.Aoi));
  const shared = record(first(root.shared, root.sharedState, root.world));
  const rawMemories = first(shared.sharedMemories, shared.memories, root.memories);
  const memories = Array.isArray(rawMemories)
    ? rawMemories
        .map(normalizeMemory)
        .filter((item): item is Memory => item !== undefined)
    : previous.shared.sharedMemories;
  const phase = normalizePhase(
    first(shared.phase, root.phase),
    previous.shared.phase,
  );
  const day = numeric(first(shared.day, root.day), previous.shared.day);
  const decisions = record(first(root.decisions, root.agentDecisions, root.lastDecisions));
  const haruDecision = normalizeDecision(
    first(
      decisions.haru,
      decisions.Haru,
      root.haruDecision,
      haruRecord.lastDecision,
    ),
  );
  const aoiDecision = normalizeDecision(
    first(
      decisions.aoi,
      decisions.Aoi,
      root.aoiDecision,
      aoiRecord.lastDecision,
    ),
  );
  const rawEvents = first(root.eventLog, root.events, root.history);
  const eventLog = Array.isArray(rawEvents)
    ? rawEvents
        .map((event, index) => normalizeEvent(event, day, phase, index))
        .filter((event): event is GameEvent => event !== undefined)
    : previous.eventLog;
  const resultCandidate = record(root.result);
  const hasGameResult =
    ["generating", "ready", "partial"].includes(text(resultCandidate.status).toLowerCase()) &&
    Object.keys(record(resultCandidate.producer)).length > 0;
  const rootNavigator = record(
    first(root.navigator, root.navigatorResponse, root.navigator_response),
  );
  const rootNavigatorMessage = text(
    first(
      rootNavigator.message,
      root.navigatorMessage,
      root.navigator_message,
      root.dekopinMessage,
    ),
  );
  const rootNavigatorEventTitle = text(
    first(rootNavigator.eventTitle, rootNavigator.event_title),
  );
  const rawCurrentEvent = first(
    root.currentEvent,
    root.lastEvent,
    root.directorResult,
    hasGameResult ? undefined : root.result,
  );
  const rawCurrentSource = record(rawCurrentEvent);
  const rawCurrentDirector = record(
    first(
      rawCurrentSource.director,
      rawCurrentSource.directorResult,
      rawCurrentSource.result,
    ),
  );
  const rawCurrentMerged = Object.keys(rawCurrentDirector).length
    ? { ...rawCurrentSource, ...rawCurrentDirector }
    : rawCurrentSource;
  const rawCurrentTitle = text(
    first(
      rawCurrentMerged.eventTitle,
      rawCurrentMerged.title,
      rawCurrentMerged.event_title,
    ),
  );
  const rawCurrentNarration = text(
    first(
      rawCurrentMerged.narration,
      rawCurrentMerged.summary,
      rawCurrentMerged.description,
    ),
  );
  const historicalMoment = eventLog
    .slice()
    .reverse()
    .find(
      (event) =>
        (rawCurrentTitle && event.eventTitle === rawCurrentTitle) ||
        (rawCurrentNarration && event.narration === rawCurrentNarration),
    );
  const normalizedCurrentEvent = normalizeEvent(
    rawCurrentEvent,
    historicalMoment?.day ?? day,
    historicalMoment?.phase ?? phase,
  );
  const currentEvent = normalizedCurrentEvent
    && rootNavigatorMessage
    && (!rootNavigatorEventTitle || rootNavigatorEventTitle === normalizedCurrentEvent.eventTitle)
    ? {
        ...normalizedCurrentEvent,
        navigatorMessage:
          normalizedCurrentEvent.navigatorMessage ?? rootNavigatorMessage,
      }
    : normalizedCurrentEvent;
  const eventLogWithCurrent =
    currentEvent && eventLog.length
      ? eventLog.map((event, index) =>
          (event.id === currentEvent.id ||
            (event.day === currentEvent.day &&
              event.phase === currentEvent.phase &&
              (event.eventTitle === currentEvent.eventTitle ||
                event.narration === currentEvent.narration ||
                index === eventLog.length - 1)))
            ? {
                ...event,
                haruDialogue: currentEvent.haruDialogue ?? event.haruDialogue,
                aoiDialogue: currentEvent.aoiDialogue ?? event.aoiDialogue,
                haruDecision:
                  currentEvent.haruDecision ?? event.haruDecision ?? haruDecision?.decision,
                aoiDecision:
                  currentEvent.aoiDecision ?? event.aoiDecision ?? aoiDecision?.decision,
                haruAction:
                  currentEvent.haruAction ?? event.haruAction ?? haruDecision?.action,
                aoiAction:
                  currentEvent.aoiAction ?? event.aoiAction ?? aoiDecision?.action,
                haruPublicReason:
                  currentEvent.haruPublicReason ??
                  event.haruPublicReason ??
                  haruDecision?.publicReason,
                aoiPublicReason:
                  currentEvent.aoiPublicReason ??
                  event.aoiPublicReason ??
                  aoiDecision?.publicReason,
                navigatorMessage:
                  currentEvent.navigatorMessage ?? event.navigatorMessage,
                scene: currentEvent.scene ?? event.scene,
              }
            : event,
        )
      : eventLog;
  const conflicts = first(shared.unresolvedConflicts, shared.conflicts);
  const relationshipLabel = normalizeRelationship(
    first(shared.relationshipLabel, shared.relationship, root.relationshipLabel),
    previous.shared.relationshipLabel,
  );
  const endingValue = first(
    root.ending,
    root.endingMessage,
    shared.ending,
    resultCandidate.ending,
  );
  const ending = normalizeEnding(endingValue, relationshipLabel) ?? previous.ending;
  const result = root.result === undefined
    ? previous.result
    : normalizeResult(root.result, endingValue, relationshipLabel) ?? previous.result;
  const rawStatus = text(root.status, previous.status);
  const status = ["awaiting_suggestion", "resolving", "resolved", "ended"].includes(
    rawStatus,
  )
    ? (rawStatus as GameState["status"])
    : previous.status;

  return {
    version: 2,
    seed: text(root.seed, previous.seed),
    revision: Number.isFinite(Number(root.revision))
      ? Math.max(0, Math.round(Number(root.revision)))
      : previous.revision,
    status,
    haru: normalizeCharacter(
      first(characters.haru, characters.Haru, root.haru, root.haruState),
      previous.haru,
    ),
    aoi: normalizeCharacter(
      first(characters.aoi, characters.Aoi, root.aoi, root.aoiState),
      previous.aoi,
    ),
    shared: {
      day,
      phase,
      relationshipLabel,
      unresolvedConflicts: Array.isArray(conflicts)
        ? conflicts.filter((item): item is string => typeof item === "string")
        : previous.shared.unresolvedConflicts,
      sharedMemories: memories,
    },
    decisions: {
      haru: haruDecision ?? previous.decisions.haru,
      aoi: aoiDecision ?? previous.decisions.aoi,
    },
    currentEvent: currentEvent ?? eventLogWithCurrent.at(-1) ?? previous.currentEvent,
    eventLog: eventLogWithCurrent,
    runtime: normalizeRuntime(root, previous.runtime),
    ending,
    result,
    completed:
      root.completed === true ||
      root.gameOver === true ||
      status === "ended" ||
      Boolean(ending) ||
      previous.completed,
  };
};

const getErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
};

export const getGame = async (signal?: AbortSignal): Promise<unknown> => {
  const response = await fetch("/api/game", { signal });
  if (!response.ok) throw new Error(await getErrorMessage(response));
  return response.json();
};

const postAction = async (
  path: string,
  body: Record<string, unknown> = {},
): Promise<unknown> => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await getErrorMessage(response));
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("json") ? response.json() : undefined;
};

export const advanceGame = (): Promise<unknown> => postAction("/api/game/advance");
export const resetGame = (seed?: string): Promise<unknown> =>
  postAction("/api/game/reset", seed ? { seed } : {});
export const fastForwardGame = (): Promise<unknown> =>
  postAction("/api/game/fast-forward");

const emitBlock = (
  block: string,
  onMessage: (message: StreamMessage) => void,
): void => {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  let hasSseField = false;
  for (const line of lines) {
    if (line.startsWith(":")) {
      hasSseField = true;
      continue;
    }
    if (line.startsWith("event:")) {
      hasSseField = true;
      event = line.slice(6).trim() || "message";
    }
    if (line.startsWith("data:")) {
      hasSseField = true;
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (hasSseField && dataLines.length === 0) return;
  const raw = dataLines.length ? dataLines.join("\n") : block.trim();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (event === "message" && isRecord(parsed) && typeof parsed.type === "string") {
      onMessage({
        event: parsed.type,
        data: first(parsed.data, parsed.payload, parsed),
      });
    } else {
      onMessage({ event, data: parsed });
    }
  } catch {
    onMessage({ event, data: raw });
  }
};

export const runTurn = async (
  suggestion: string,
  revision: number,
  onMessage: (message: StreamMessage) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const response = await fetch("/api/game/turn", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify({
      suggestion,
      revision,
      idempotencyKey:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
    signal,
  });
  if (!response.ok) throw new Error(await getErrorMessage(response));

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const data = response.status === 204 ? undefined : await response.json();
    onMessage({ event: "done", data });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      emitBlock(buffer.slice(0, boundary), onMessage);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) emitBlock(buffer, onMessage);
};
