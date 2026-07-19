import type {
  AgentDecision,
  CharacterState,
  EventStoryBeat,
  GameEvent,
  GameState,
  Memory,
  Phase,
  RelationshipLabel,
  RuntimeInfo,
  RuntimeHealth,
  StreamMessage,
} from "./types.js";
import type {
  ResultAgentReflection,
  ResultCharacterSnapshot,
  ResultDailyNarrative,
  ResultEnding,
  ResultEvidence,
  ResultFailure,
  ResultHighlight,
  ResultNarrative,
  ResultNarrativeParagraph,
  ResultProducer,
  ResultPublicDecision,
  ResultScoreAxis,
  ResultScreenData,
  ResultStatDelta,
  ResultTurnSnapshot,
} from "./result/types.js";
import type { CharacterSettings } from "@roommates/shared";

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

const optionalText = (value: unknown): string | undefined => {
  const valueText = text(value);
  return valueText || undefined;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const normalizeConversation = (value: unknown): GameEvent["conversation"] => {
  if (!Array.isArray(value)) return undefined;
  const turns = value.flatMap((item) => {
    const source = record(item);
    const speaker = text(first(source.speaker, source.character, source.person)).toLowerCase();
    const line = optionalText(first(source.text, source.dialogue, source.line, source.message));
    if ((speaker !== "haru" && speaker !== "aoi") || !line) return [];
    return [{ speaker: speaker as "haru" | "aoi", text: line.trim().slice(0, 160) }];
  });
  return turns.length ? turns : undefined;
};

const normalizeStoryBeats = (value: unknown): GameEvent["storyBeats"] => {
  if (!Array.isArray(value)) return undefined;
  const beats = value.flatMap<EventStoryBeat>((item) => {
    const source = record(item);
    const kind = text(first(source.kind, source.type)).toLowerCase();
    const actor = text(first(source.actor, source.character, source.person)).toLowerCase();
    if (actor !== "haru" && actor !== "aoi" && actor !== "both") return [];

    if (kind === "move") {
      const location = optionalText(first(source.location, source.destination, source.place));
      return location
        ? [{ kind, actor, location: location.trim().slice(0, 48) } as const]
        : [];
    }
    if (kind === "dialogue" && actor !== "both") {
      const line = optionalText(first(source.text, source.dialogue, source.line, source.message));
      return line
        ? [{ kind, actor, text: line.trim().slice(0, 160) } as const]
        : [];
    }
    if (kind === "action") {
      const action = optionalText(first(source.action, source.text, source.description));
      return action
        ? [{ kind, actor, action: action.trim().slice(0, 160) } as const]
        : [];
    }
    return [];
  }).slice(0, 8);
  return beats.length ? beats : undefined;
};

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
    sourceEventId: optionalText(first(source.sourceEventId, source.source_event_id)),
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

const normalizeDecisionKind = (value: unknown): AgentDecision["decision"] | undefined => {
  const normalized = text(value).toUpperCase();
  return ["ACCEPT", "DECLINE", "MODIFY", "IGNORE", "INITIATE"].includes(normalized)
    ? (normalized as AgentDecision["decision"])
    : undefined;
};

const normalizePublicDecision = (value: unknown): ResultPublicDecision | undefined =>
  normalizeDecision(value);

const normalizeCharacterSnapshot = (
  value: unknown,
): ResultCharacterSnapshot | undefined => {
  const source = record(value);
  const keys = ["energy", "stress", "affection", "trust", "romanticAwareness"] as const;
  if (!keys.every((key) => Number.isFinite(Number(source[key])))) return undefined;
  return {
    energy: numeric(source.energy, 0),
    stress: numeric(source.stress, 0),
    affection: numeric(source.affection, 0),
    trust: numeric(source.trust, 0),
    romanticAwareness: numeric(source.romanticAwareness, 0),
    mood: optionalText(source.mood),
    location: optionalText(source.location),
    currentGoal: optionalText(first(source.currentGoal, source.current_goal)),
  };
};

const normalizeTurnSnapshot = (value: unknown): ResultTurnSnapshot | undefined => {
  const source = record(value);
  const characters = record(source.characters);
  const haru = normalizeCharacterSnapshot(characters.haru);
  const aoi = normalizeCharacterSnapshot(characters.aoi);
  if (!haru && !aoi) return undefined;
  const shared = record(source.shared);
  const relationshipLabel = normalizeRelationship(shared.relationshipLabel, "roommates");
  return {
    characters: {
      ...(haru ? { haru } : {}),
      ...(aoi ? { aoi } : {}),
    },
    shared: {
      relationshipLabel,
      unresolvedConflictIds: stringArray(
        first(shared.unresolvedConflictIds, shared.unresolvedConflicts),
      ),
      memoryIds: stringArray(shared.memoryIds),
    },
  };
};

const normalizeStatDelta = (value: unknown): ResultStatDelta | undefined => {
  const source = record(value);
  const delta: ResultStatDelta = {};
  (["energy", "stress", "affection", "trust", "romanticAwareness"] as const)
    .forEach((key) => {
      if (Number.isFinite(Number(source[key]))) delta[key] = finiteNumber(source[key]);
    });
  return Object.keys(delta).length ? delta : undefined;
};

const normalizeRelationshipOptional = (value: unknown): RelationshipLabel | undefined => {
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
    : undefined;
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
  const decisions = record(merged.decisions);
  const haruDecision = normalizePublicDecision(first(decisions.haru, merged.haruDecision));
  const aoiDecision = normalizePublicDecision(first(decisions.aoi, merged.aoiDecision));
  const scene = record(merged.scene);
  const before = normalizeTurnSnapshot(first(merged.before, merged.stateBefore));
  const after = normalizeTurnSnapshot(first(merged.after, merged.stateAfter));
  const statesBefore = record(merged.statesBefore);
  const statesAfter = record(merged.statesAfter);
  const effects = record(first(merged.appliedEffects, merged.effects));
  const memory = normalizeMemory(merged.memory, index);
  const conflictUpdate = record(merged.conflictUpdate);
  const cue = record(first(merged.cue, record(merged.cueResolution).cue));
  const navigatorResponse = record(
    first(merged.navigatorResponse, merged.navigator_response, merged.navigator),
  );
  const selectedEvent = record(record(merged.cueResolution).selectedEvent);
  const lock = record(first(merged.lock, record(merged.cueResolution).lock));
  const cueSafetyFlags = stringArray(first(merged.cueSafetyFlags, cue.safetyFlags));
  const relationshipBefore = normalizeRelationshipOptional(merged.relationshipBefore);
  const relationshipAfter = normalizeRelationshipOptional(merged.relationshipAfter);
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
    day,
    phase,
    eventTitle: eventTitle || "ふたりの時間",
    narration,
    suggestion: optionalText(first(merged.suggestion, cue.text, merged.proposal)),
    navigatorMessage: optionalText(
      first(
        merged.navigatorMessage,
        merged.navigator_message,
        merged.dekopinMessage,
        merged.dekopin_message,
        navigatorResponse.message,
      ),
    ),
    cueSafetyFlags,
    ...(haruDecision || aoiDecision
      ? {
          decisions: {
            ...(haruDecision ? { haru: haruDecision } : {}),
            ...(aoiDecision ? { aoi: aoiDecision } : {}),
          },
        }
      : {}),
    haruDecision: haruDecision?.decision ?? normalizeDecisionKind(merged.haruDecision),
    aoiDecision: aoiDecision?.decision ?? normalizeDecisionKind(merged.aoiDecision),
    haruAction: optionalText(first(haruDecision?.action, merged.haruAction)),
    aoiAction: optionalText(first(aoiDecision?.action, merged.aoiAction)),
    haruDialogue:
      optionalText(first(haruDecision?.dialogue, merged.haruDialogue, merged.haru_dialogue)),
    aoiDialogue: optionalText(first(aoiDecision?.dialogue, merged.aoiDialogue, merged.aoi_dialogue)),
    conversation: normalizeConversation(
      first(merged.conversation, merged.eventConversation, merged.event_conversation),
    ),
    storyBeats: normalizeStoryBeats(
      first(merged.storyBeats, merged.story_beats, merged.choreography),
    ),
    haruPublicReason: optionalText(first(haruDecision?.publicReason, merged.haruPublicReason)),
    aoiPublicReason: optionalText(first(aoiDecision?.publicReason, merged.aoiPublicReason)),
    scene: Object.keys(scene).length
      ? {
          haru: optionalText(scene.haru),
          aoi: optionalText(scene.aoi),
        }
      : undefined,
    memoryId: optionalText(first(merged.memoryId, memory?.id)),
    memory,
    relationshipBefore,
    relationshipAfter,
    resolutionBranch: optionalText(first(merged.resolutionBranch, merged.branch)),
    before,
    after,
    statesBefore: Object.keys(statesBefore).length
      ? {
          haru: normalizeCharacterSnapshot(statesBefore.haru),
          aoi: normalizeCharacterSnapshot(statesBefore.aoi),
        }
      : undefined,
    statesAfter: Object.keys(statesAfter).length
      ? {
          haru: normalizeCharacterSnapshot(statesAfter.haru),
          aoi: normalizeCharacterSnapshot(statesAfter.aoi),
        }
      : undefined,
    appliedEffects: Object.keys(effects).length
      ? {
          haru: normalizeStatDelta(effects.haru),
          aoi: normalizeStatDelta(effects.aoi),
        }
      : undefined,
    conflictUpdate: Object.keys(conflictUpdate).length
      ? {
          add: stringArray(conflictUpdate.add),
          resolve: stringArray(conflictUpdate.resolve),
        }
      : undefined,
    cueResolution: Object.keys(cue).length || Object.keys(lock).length
      ? {
          cue: {
            text: optionalText(first(cue.text, merged.suggestion)),
            safetyFlags: cueSafetyFlags,
            transformed: cue.transformed === true,
          },
          selectedEvent: {
            id: optionalText(first(selectedEvent.id, merged.eventDefinitionId)),
            title: optionalText(first(selectedEvent.title, merged.eventTitle)),
            category: optionalText(first(selectedEvent.category, merged.eventCategory)),
            intimacyTier: Number.isFinite(Number(first(selectedEvent.intimacyTier, merged.intimacyTier)))
              ? finiteNumber(first(selectedEvent.intimacyTier, merged.intimacyTier))
              : undefined,
          },
          outcome: optionalText(first(record(merged.cueResolution).outcome, merged.cueOutcome)),
          lock: Object.keys(lock).length ? { reason: optionalText(lock.reason) } : undefined,
        }
      : undefined,
    timestamp: text(merged.timestamp) || undefined,
  };
};

const normalizeEnding = (value: unknown): ResultEnding | string | undefined => {
  if (typeof value === "string") return optionalText(value);
  const source = record(value);
  const title = optionalText(source.title);
  const narration = optionalText(first(source.narration, source.summary));
  if (!title && !narration) return undefined;
  return {
    kind: text(source.kind, "roommates"),
    title: title ?? "7日間、おつかれさまでした",
    narration: narration ?? "二人の結末は保存されました。",
  };
};

const normalizeEvidence = (value: unknown, index: number): ResultEvidence | undefined => {
  const source = record(value);
  const message = optionalText(source.message);
  if (!message) return undefined;
  return {
    id: text(source.id, `evidence-${index + 1}`),
    ruleId: optionalText(source.ruleId),
    points: finiteNumber(source.points),
    message,
    eventLogIds: stringArray(source.eventLogIds),
  };
};

const normalizeEvidenceList = (value: unknown): ResultEvidence[] =>
  Array.isArray(value)
    ? value
        .map(normalizeEvidence)
        .filter((item): item is ResultEvidence => Boolean(item))
    : [];

const normalizeScoreAxis = (value: unknown): ResultScoreAxis | undefined => {
  const source = record(value);
  const id = text(source.id);
  if (!["agency", "wellbeing", "care", "pacing", "story"].includes(id)) return undefined;
  return {
    id: id as ResultScoreAxis["id"],
    score: Math.max(0, finiteNumber(source.score)),
    maxScore: Math.max(1, finiteNumber(source.maxScore, 1)),
    summary: text(source.summary, "評価根拠を集計しました。"),
    evidence: normalizeEvidenceList(source.evidence),
  };
};

const normalizeHighlight = (value: unknown, index: number): ResultHighlight | undefined => {
  const source = record(value);
  const eventLogIds = stringArray(source.eventLogIds);
  const headline = optionalText(source.headline);
  if (!headline || eventLogIds.length === 0) return undefined;
  return {
    id: text(source.id, `highlight-${index + 1}`),
    kind: text(source.kind, "important_memory"),
    headline,
    reason: text(source.reason, "7日間を代表する出来事として選ばれました。"),
    eventLogIds,
    memoryId: optionalText(source.memoryId),
  };
};

const normalizeProducer = (value: unknown): ResultProducer | undefined => {
  const source = record(value);
  if (!Object.keys(source).length) return undefined;
  const axes = Array.isArray(source.axes)
    ? source.axes
        .map(normalizeScoreAxis)
        .filter((item): item is ResultScoreAxis => Boolean(item))
    : [];
  const highlights = Array.isArray(source.highlights)
    ? source.highlights
        .map(normalizeHighlight)
        .filter((item): item is ResultHighlight => Boolean(item))
    : [];
  const rankValue = text(source.rank, "C").toUpperCase();
  const coverage = record(source.coverage);
  const statJourney = record(source.statJourney);
  const start = normalizeTurnSnapshot(statJourney.start);
  const end = normalizeTurnSnapshot(statJourney.end);
  return {
    overallScore: Math.min(100, Math.max(0, Math.round(finiteNumber(source.overallScore)))),
    rank: ["S", "A", "B", "C"].includes(rankValue)
      ? (rankValue as ResultProducer["rank"])
      : "C",
    producerStyle: text(source.producerStyle, "space_maker"),
    scoringVersion: text(source.scoringVersion, "producer-v1"),
    axes,
    topStrengths: normalizeEvidenceList(source.topStrengths),
    improvements: normalizeEvidenceList(source.improvements),
    highlights,
    highlightEventLogIds: stringArray(source.highlightEventLogIds),
    keyMemoryIds: stringArray(source.keyMemoryIds),
    turningPointEventLogIds: stringArray(source.turningPointEventLogIds),
    statJourney: start && end ? { start, end } : undefined,
    coverage: typeof source.coverage === "number"
      ? Math.min(1, Math.max(0, source.coverage))
      : {
          ratio: Math.min(1, Math.max(0, finiteNumber(coverage.ratio))),
          completeTurns: Math.max(0, Math.round(finiteNumber(coverage.completeTurns))),
          expectedTurns: Math.max(1, Math.round(finiteNumber(coverage.expectedTurns, 28))),
          missing: stringArray(coverage.missing),
        },
    warnings: stringArray(source.warnings),
  };
};

const normalizeNarrativeParagraph = (
  value: unknown,
): ResultNarrativeParagraph | undefined => {
  if (typeof value === "string") {
    const paragraphText = optionalText(value);
    return paragraphText ? { text: paragraphText, sourceEventLogIds: [] } : undefined;
  }
  const source = record(value);
  const paragraphText = optionalText(source.text);
  return paragraphText
    ? { text: paragraphText, sourceEventLogIds: stringArray(source.sourceEventLogIds) }
    : undefined;
};

const normalizeNarrativeParagraphs = (
  value: unknown,
): ResultNarrativeParagraph[] | string => {
  if (typeof value === "string") return value;
  return Array.isArray(value)
    ? value
        .map(normalizeNarrativeParagraph)
        .filter((item): item is ResultNarrativeParagraph => Boolean(item))
    : [];
};

const normalizeDailyNarrative = (
  value: unknown,
  index: number,
): ResultDailyNarrative | undefined => {
  const source = record(value);
  const day = Math.round(finiteNumber(source.day, index + 1));
  if (day < 1 || day > 7) return undefined;
  const paragraphs = normalizeNarrativeParagraphs(source.paragraphs);
  return {
    day,
    title: text(source.title, `Day ${day}`),
    paragraphs: typeof paragraphs === "string"
      ? [{ text: paragraphs, sourceEventLogIds: stringArray(source.sourceEventLogIds) }]
      : paragraphs,
    body: optionalText(source.body),
    sourceEventLogIds: stringArray(source.sourceEventLogIds),
    featuredEventLogId: optionalText(source.featuredEventLogId),
  };
};

const normalizeNarrative = (value: unknown): ResultNarrative | undefined => {
  const source = record(value);
  const headline = optionalText(source.headline);
  if (!headline) return undefined;
  const daySections = Array.isArray(source.daySections)
    ? source.daySections
        .map(normalizeDailyNarrative)
        .filter((item): item is ResultDailyNarrative => Boolean(item))
    : [];
  return {
    headline,
    lead: normalizeNarrativeParagraphs(source.lead),
    daySections,
    closing: normalizeNarrativeParagraphs(source.closing),
    sourceEventLogIds: stringArray(source.sourceEventLogIds),
    narrativeVersion: text(source.narrativeVersion, "result-narrative-v1"),
  };
};

const normalizeReflection = (
  value: unknown,
  expectedCharacter: "haru" | "aoi",
): ResultAgentReflection | undefined => {
  const source = record(value);
  if (!Object.keys(source).length) return undefined;
  const comments = Array.isArray(source.notableEventComments)
    ? source.notableEventComments
        .map((comment) => {
          const item = record(comment);
          const eventLogId = optionalText(item.eventLogId);
          const commentText = optionalText(item.comment);
          return eventLogId && commentText ? { eventLogId, comment: commentText } : undefined;
        })
        .filter((item): item is { eventLogId: string; comment: string } => Boolean(item))
    : [];
  return {
    characterId: expectedCharacter,
    seasonImpression: text(source.seasonImpression, "7日間を振り返っています。"),
    notableEventComments: comments,
    bestMomentEventLogId: optionalText(source.bestMomentEventLogId) ?? null,
    turningPointEventLogId: optionalText(source.turningPointEventLogId) ?? null,
    messageToProducer: text(source.messageToProducer, "見守ってくれてありがとう。"),
    reflectionVersion: text(source.reflectionVersion, "reflection-v1"),
  };
};

const normalizeFailure = (value: unknown): ResultFailure | undefined => {
  const source = record(value);
  const component = optionalText(source.component);
  const reason = optionalText(source.reason);
  if (!component || !reason) return undefined;
  return { component, reason, retryable: source.retryable === true };
};

const normalizeResult = (value: unknown): ResultScreenData | undefined => {
  const source = record(value);
  const status = text(source.status).toLowerCase();
  if (!["generating", "ready", "partial"].includes(status)) return undefined;
  const producer = normalizeProducer(source.producer);
  const endingValue = normalizeEnding(source.ending);
  if (!producer || !endingValue || typeof endingValue === "string") return undefined;
  const narrative = normalizeNarrative(source.narrative);
  const reflectionsSource = record(source.reflections);
  const haru = normalizeReflection(reflectionsSource.haru, "haru");
  const aoi = normalizeReflection(reflectionsSource.aoi, "aoi");
  const identity = {
    generationKey: optionalText(source.generationKey),
    endingRevision: Number.isFinite(Number(source.endingRevision))
      ? Math.max(0, Math.round(Number(source.endingRevision)))
      : undefined,
    narrativeVersion: optionalText(source.narrativeVersion),
    reflectionVersion: optionalText(source.reflectionVersion),
  };
  if (status === "generating") {
    return {
      ...identity,
      status,
      ending: endingValue,
      producer,
      startedAt: optionalText(source.startedAt),
      narrative,
      reflections: {
        ...(haru ? { haru } : {}),
        ...(aoi ? { aoi } : {}),
      },
      dataQuality: source.dataQuality === "complete" ? "complete" : "partial",
    };
  }
  if (status === "ready" && narrative && haru && aoi) {
    return {
      ...identity,
      status,
      ending: endingValue,
      producer,
      narrative,
      reflections: { haru, aoi },
      generatedAt: optionalText(source.generatedAt),
      dataQuality: "complete",
    };
  }
  return {
    ...identity,
    status: "partial",
    ending: endingValue,
    producer,
    narrative,
    reflections: {
      ...(haru ? { haru } : {}),
      ...(aoi ? { aoi } : {}),
    },
    failures: Array.isArray(source.failures)
      ? source.failures
          .map(normalizeFailure)
          .filter((item): item is ResultFailure => Boolean(item))
      : [],
    generatedAt: optionalText(source.generatedAt),
    dataQuality: "partial",
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
  const navigatorRuntime = record(first(runtime.navigator, runtime.Navigator));
  const runtimeSources = [
    haruRuntime.source,
    aoiRuntime.source,
    directorRuntime.source,
    navigatorRuntime.source,
  ]
    .map((source) => text(source).toLowerCase())
    .filter(Boolean);
  const rawMode = text(
    first(
      runtime.mode,
      root.runtimeMode,
      root.runtime_mode,
      runtimeSources.some((source) => source === "openai_api")
        ? "openai-api"
        : undefined,
      runtime.connected === true ? "app-server" : undefined,
      runtimeSources.some((source) => source === "app_server")
        ? "app-server"
        : runtimeSources.length
          ? "mock"
          : undefined,
    ),
    fallback.mode,
  ).toLowerCase();
  const mode: RuntimeInfo["mode"] = rawMode.includes("openai")
    ? "openai-api"
    : rawMode.includes("mock")
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
  const eventLogWasProvided = Array.isArray(rawEvents);
  const normalizedEvents = Array.isArray(rawEvents)
    ? rawEvents
        .map((event: unknown, index: number) => normalizeEvent(event, day, phase, index))
        .filter((event): event is GameEvent => event !== undefined)
    : previous.eventLog;
  const rootNavigator = record(
    first(root.navigator, root.navigatorResponse, root.navigator_response),
  );
  const rootNavigatorMessage = optionalText(
    first(
      rootNavigator.message,
      root.navigatorMessage,
      root.navigator_message,
      root.dekopinMessage,
      root.dekopin_message,
    ),
  );
  const lastLogged = normalizedEvents.at(-1);
  const rawCurrentEvent = first(root.currentEvent, root.lastEvent, root.directorResult);
  const currentDetail = normalizeEvent(
    rawCurrentEvent,
    lastLogged?.day ?? day,
    lastLogged?.phase ?? phase,
    normalizedEvents.length,
  );
  const mergedCurrent = currentDetail && lastLogged
    ? {
        ...lastLogged,
        ...currentDetail,
        id: lastLogged.id,
        eventDefinitionId: currentDetail.eventDefinitionId ?? lastLogged.eventDefinitionId,
        suggestion: currentDetail.suggestion ?? lastLogged.suggestion,
        navigatorMessage:
          currentDetail.navigatorMessage ?? rootNavigatorMessage ?? lastLogged.navigatorMessage,
        cueSafetyFlags: currentDetail.cueSafetyFlags?.length
          ? currentDetail.cueSafetyFlags
          : lastLogged.cueSafetyFlags,
        haruDecision: currentDetail.haruDecision ?? lastLogged.haruDecision,
        aoiDecision: currentDetail.aoiDecision ?? lastLogged.aoiDecision,
        haruAction: currentDetail.haruAction ?? lastLogged.haruAction,
        aoiAction: currentDetail.aoiAction ?? lastLogged.aoiAction,
        haruDialogue: currentDetail.haruDialogue ?? lastLogged.haruDialogue,
        aoiDialogue: currentDetail.aoiDialogue ?? lastLogged.aoiDialogue,
        conversation: currentDetail.conversation ?? lastLogged.conversation,
        storyBeats: currentDetail.storyBeats ?? lastLogged.storyBeats,
        haruPublicReason: currentDetail.haruPublicReason ?? lastLogged.haruPublicReason,
        aoiPublicReason: currentDetail.aoiPublicReason ?? lastLogged.aoiPublicReason,
        scene: currentDetail.scene ?? lastLogged.scene,
        memoryId: currentDetail.memoryId ?? lastLogged.memoryId,
        memory: currentDetail.memory ?? lastLogged.memory,
        decisions: {
          ...lastLogged.decisions,
          ...currentDetail.decisions,
        },
        before: currentDetail.before ?? lastLogged.before,
        after: currentDetail.after ?? lastLogged.after,
        appliedEffects: currentDetail.appliedEffects ?? lastLogged.appliedEffects,
        conflictUpdate: currentDetail.conflictUpdate ?? lastLogged.conflictUpdate,
        cueResolution: currentDetail.cueResolution ?? lastLogged.cueResolution,
      }
    : currentDetail
      ? {
          ...currentDetail,
          navigatorMessage: currentDetail.navigatorMessage ?? rootNavigatorMessage,
        }
      : currentDetail;

  const attachDecision = (
    event: GameEvent,
    person: "haru" | "aoi",
    decision: AgentDecision | undefined,
  ): GameEvent => {
    if (!decision) return event;
    const prefix = person === "haru" ? "haru" : "aoi";
    return {
      ...event,
      decisions: {
        ...event.decisions,
        [person]: event.decisions?.[person] ?? decision,
      },
      [`${prefix}Decision`]: event[`${prefix}Decision`] ?? decision.decision,
      [`${prefix}Action`]: event[`${prefix}Action`] ?? decision.action,
      [`${prefix}Dialogue`]: event[`${prefix}Dialogue`] ?? decision.dialogue,
      [`${prefix}PublicReason`]: event[`${prefix}PublicReason`] ?? decision.publicReason,
    };
  };

  let eventLog = normalizedEvents;
  if (rootNavigatorMessage && eventLog.length && !mergedCurrent) {
    eventLog = eventLog.map((event, index) =>
      index === eventLog.length - 1
        ? { ...event, navigatorMessage: event.navigatorMessage ?? rootNavigatorMessage }
        : event,
    );
  }
  if (mergedCurrent && normalizedEvents.length) {
    eventLog = normalizedEvents.map((event, index) =>
      index === normalizedEvents.length - 1 &&
      event.day === mergedCurrent.day &&
      event.phase === mergedCurrent.phase
        ? mergedCurrent
        : event,
    );
  }
  if (eventLogWasProvided && eventLog.length) {
    eventLog = eventLog.map((event, index) => {
      if (index !== eventLog.length - 1) return event;
      return attachDecision(attachDecision(event, "haru", haruDecision), "aoi", aoiDecision);
    });
  }
  const currentEvent = eventLog.at(-1) && (mergedCurrent || eventLogWasProvided)
    ? eventLog.at(-1)
    : mergedCurrent ?? previous.currentEvent;
  const conflicts = first(shared.unresolvedConflicts, shared.conflicts);
  const endingValue = first(root.ending, root.endingMessage, shared.ending);
  const ending = normalizeEnding(endingValue) ?? previous.ending;
  const result = normalizeResult(root.result) ?? previous.result;
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
      relationshipLabel: normalizeRelationship(
        first(shared.relationshipLabel, shared.relationship, root.relationshipLabel),
        previous.shared.relationshipLabel,
      ),
      unresolvedConflicts: Array.isArray(conflicts)
        ? conflicts.filter((item): item is string => typeof item === "string")
        : previous.shared.unresolvedConflicts,
      sharedMemories: memories,
    },
    decisions: {
      haru: haruDecision ?? previous.decisions.haru,
      aoi: aoiDecision ?? previous.decisions.aoi,
    },
    currentEvent,
    eventLog,
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

export const getRuntimeHealth = async (signal?: AbortSignal): Promise<RuntimeHealth> => {
  const response = await fetch("/api/health", { signal });
  if (!response.ok) throw new Error(await getErrorMessage(response));
  const payload = record(await response.json());
  return { openaiApiConfigured: payload.openaiApiConfigured === true };
};

const postAction = async (path: string, payload: unknown = {}): Promise<unknown> => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await getErrorMessage(response));
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("json") ? response.json() : undefined;
};

export const advanceGame = (): Promise<unknown> => postAction("/api/game/advance");
export const resetGame = (seed?: string): Promise<unknown> =>
  postAction("/api/game/reset", seed ? { seed } : {});
export const fastForwardGame = (
  characterSettings: CharacterSettings,
): Promise<unknown> =>
  postAction("/api/game/fast-forward", { characterSettings });

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
  characterSettings: CharacterSettings,
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
      characterSettings,
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
  let streamFailure: Error | undefined;
  const handleMessage = (message: StreamMessage): void => {
    onMessage(message);
    if (message.event.toLowerCase() !== "error") return;
    const payload = record(message.data);
    streamFailure = new Error(
      text(first(payload.message, payload.error), "ターンの処理に失敗しました"),
    );
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = /\r?\n\r?\n/.exec(buffer);
    while (boundary) {
      emitBlock(buffer.slice(0, boundary.index), handleMessage);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      boundary = /\r?\n\r?\n/.exec(buffer);
    }
    if (done) break;
  }
  if (buffer.trim()) emitBlock(buffer, handleMessage);
  if (streamFailure) throw streamFailure;
};
