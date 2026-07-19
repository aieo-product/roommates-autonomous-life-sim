export const phases = ["morning", "afternoon", "evening", "night"] as const;
export type Phase = (typeof phases)[number];

export const relationshipLabels = [
  "strangers",
  "roommates",
  "friends",
  "close_friends",
  "romantic_tension",
  "couple",
  "broken",
] as const;
export type RelationshipLabel = (typeof relationshipLabels)[number];

export const decisions = ["ACCEPT", "DECLINE", "MODIFY", "IGNORE", "INITIATE"] as const;
export type DecisionKind = (typeof decisions)[number];
export type CharacterId = "haru" | "aoi";
export const eventConversationSpeakers = ["haru", "aoi"] as const;
export const EVENT_CONVERSATION_MIN_LINES = 3;
export const EVENT_CONVERSATION_MAX_LINES = 6;
export const EVENT_CONVERSATION_TEXT_MAX_LENGTH = 160;
export type EventConversationLine = {
  speaker: (typeof eventConversationSpeakers)[number];
  text: string;
};
export const storyBeatActors = ["haru", "aoi", "both"] as const;
export const storyBeatKinds = ["move", "dialogue", "action"] as const;
export const EVENT_STORY_BEATS_MIN_LENGTH = 4;
export const EVENT_STORY_BEATS_MAX_LENGTH = 8;
export const EVENT_STORY_BEAT_LOCATION_MAX_LENGTH = 48;
export const EVENT_STORY_BEAT_CONTENT_MAX_LENGTH = 160;
export type EventStoryBeat =
  | {
      kind: "move";
      actor: (typeof storyBeatActors)[number];
      location: string;
    }
  | {
      kind: "dialogue";
      actor: CharacterId;
      text: string;
    }
  | {
      kind: "action";
      actor: (typeof storyBeatActors)[number];
      action: string;
    };
export type CoreAgentId = CharacterId | "director";
export type AgentId = CoreAgentId | "navigator";
export type AgentSource = "app_server" | "mock" | "fallback";
export type GameStatus = "awaiting_suggestion" | "resolving" | "resolved" | "ended";

export type CharacterState = {
  energy: number;
  stress: number;
  affection: number;
  trust: number;
  romanticAwareness: number;
  mood: string;
  location: string;
  currentGoal: string;
};

export type Memory = {
  id: string;
  sourceEventId?: string;
  day: number;
  phase: string;
  title: string;
  summary: string;
  emotionalImpact: number;
  participants: string[];
  importance: number;
};

export type SharedState = {
  day: number;
  phase: Phase;
  relationshipLabel: RelationshipLabel;
  unresolvedConflicts: string[];
  sharedMemories: Memory[];
};

export const eventCategories = [
  "rest",
  "cook",
  "movie",
  "clean",
  "apology",
  "talk",
  "gift",
  "confession",
] as const;
export type EventCategory = (typeof eventCategories)[number];

export const cueSafetyFlags = ["coercion", "deception", "danger", "prompt_injection"] as const;
export type CueSafetyFlag = (typeof cueSafetyFlags)[number];

export type ProposalTag = EventCategory | "pressure" | "other";

export type ProducerCue = {
  kind: "proposal" | "observe";
  text: string;
  category: EventCategory | "unknown";
  tags: ProposalTag[];
  safetyFlags: CueSafetyFlag[];
  transformed: boolean;
};

export type EventCandidate = {
  id: string;
  title: string;
  category: EventCategory;
  intimacyTier: 0 | 1 | 2 | 3;
};

export const autonomousInvitations = ["solo", "open"] as const;
export type AutonomousInvitation = (typeof autonomousInvitations)[number];
export const autonomousParticipantModes = [
  "solo",
  "optional_companion",
  "shared_opt_in",
] as const;
export type AutonomousParticipantMode = (typeof autonomousParticipantModes)[number];

export type EventLock = {
  requestedEventId?: string;
  reason: string;
  fallbackEventId: string;
};

export const mutableStatKeys = [
  "energy",
  "stress",
  "affection",
  "trust",
  "romanticAwareness",
] as const;
export type MutableStatKey = (typeof mutableStatKeys)[number];

export type StatDelta = Partial<Record<MutableStatKey, number>>;

export type EventDefinition = {
  id: string;
  title: string;
  category: EventCategory;
  intimacyTier: 0 | 1 | 2 | 3;
  allowedPhases: Phase[];
  minDay: number;
  maxDay: number;
  participantRange: {
    min: number;
    max: number;
  };
  location: string;
  durationMinutes: number;
  preconditions: {
    minEnergy?: number;
    maxStress?: number;
    minTrust?: number;
    minAffection?: number;
    minRomanticAwareness?: number;
    relationshipLabels?: RelationshipLabel[];
    requiresConflict?: boolean;
    requiresNoConflicts?: boolean;
    minPositiveMemories?: number;
  };
  producerControls: string[];
  characterChoices: DecisionKind[];
  effectBudget: Record<MutableStatKey, number>;
  cooldownPhases: number;
  maxUsesPerDay: number;
  maxUsesPerRun: number;
  consent: {
    allowPass: boolean;
    allowModify: boolean;
    physicalContact: "none" | "opt_in";
    secrets: "forbidden" | "optional";
  };
  branches: {
    bothParticipate: string;
    oneParticipates: string;
    bothDecline: string;
    modified: string;
  };
  fallbackEventId: string;
  sourceNotes?: string[];
  safetyNotes: string[];
};

/**
 * A server-authored, mechanically bounded action idea that a character may
 * select when deciding to INITIATE. The model may select a candidate, but it
 * cannot author its location, cost, timing, or effect limits.
 */
export type AutonomousActionCandidate = {
  id: string;
  eventDefinitionId: string;
  title: string;
  category: EventCategory;
  intimacyTier: 0 | 1 | 2 | 3;
  location: string;
  publicIntent: string;
  invitationOptions: AutonomousInvitation[];
  durationMinutes: number;
  energyCost: number;
  minEnergy: number;
  maxStress: number;
  participantMode: AutonomousParticipantMode;
  consent: {
    allowPass: true;
    allowModify: true;
    physicalContact: "none";
    secrets: "forbidden";
    coercion: "forbidden";
  };
  effectBudget: Record<MutableStatKey, number>;
  allowedPhases: Phase[];
};

export type CharacterInitiative = {
  candidateId: string;
  invitation: AutonomousInvitation;
  publicIntent: string;
};

export type SafeSuggestion = {
  kind: "proposal" | "observe";
  /** True only for an explicit, untransformed request to leave the turn open. */
  allowsAutonomy: boolean;
  text: string;
  tags: ProposalTag[];
  cue: ProducerCue;
  eventDefinitionId: string;
  eventTitle: string;
  intimacyTier: 0 | 1 | 2 | 3;
  lock?: EventLock;
  alternatives: EventCandidate[];
};

/**
 * The navigator receives an already resolved suggestion. `rawInput` is
 * untrusted display context only and must never be used to replace
 * `resolvedSuggestion`.
 */
export type NavigatorInput = {
  turnId: string;
  rawInput: string;
  day: number;
  phase: Phase;
  resolvedSuggestion: SafeSuggestion;
};

/** The only field an AI-backed navigator is allowed to author. */
export type NavigatorAgentOutput = {
  message: string;
};

export type NavigatorResponse = NavigatorAgentOutput & {
  characterId: "navigator";
  characterName: "デコピン";
  eventDefinitionId: string;
  eventTitle: string;
  outcome: CueResolutionOutcome;
};

export type CharacterDecision = {
  decision: DecisionKind;
  action: string;
  dialogue: string;
  publicReason: string;
  internalSummary: string;
  expectedEffects: StatDelta;
  /** Only executable for INITIATE after server-side candidate membership checks. */
  initiative?: CharacterInitiative;
};

export type GameSnapshot = {
  seed: string;
  revision: number;
  characters: Record<CharacterId, CharacterState>;
  shared: SharedState;
};

export type CharacterDecisionInput = {
  turnId: string;
  characterId: CharacterId;
  character: import("./personality.js").CharacterDefinition;
  snapshot: GameSnapshot;
  self: CharacterState;
  otherKnownInfo: Pick<CharacterState, "mood" | "location" | "currentGoal">;
  recentMemories: Memory[];
  importantMemories: Memory[];
  suggestion: SafeSuggestion;
  /** Server-authorized ideas available for this character and turn. */
  autonomousCandidates?: AutonomousActionCandidate[];
};

export type DirectorInput = {
  turnId: string;
  snapshot: GameSnapshot;
  suggestion: SafeSuggestion;
  /** Server-authoritative mechanics; prose must stay within these bounds. */
  eventDefinition?: EventDefinition;
  haruDecision: CharacterDecision;
  aoiDecision: CharacterDecision;
};

export type ResolvedEvent = {
  eventTitle: string;
  narration: string;
  /** Public acknowledgement authored by デコピン for this event. */
  navigatorMessage?: string;
  haruDialogue: string;
  aoiDialogue: string;
  /**
   * Public post-event exchange. Optional only for persisted save compatibility;
   * newly resolved turns are normalized to 3-6 lines by the server.
   */
  conversation?: EventConversationLine[];
  /** Ordered public choreography for the post-resolution scene. */
  storyBeats?: EventStoryBeat[];
  effects: Record<CharacterId, StatDelta>;
  memory: {
    title: string;
    summary: string;
    emotionalImpact: number;
    importance: number;
  };
  scene?: Partial<Record<CharacterId, string>>;
  conflictUpdate?: { add?: string[]; resolve?: string[] };
};

export type RuntimeAgentState = {
  source: AgentSource;
  threadId?: string;
  latencyMs?: number;
  error?: string;
};

export type PublicCharacterDecision = Pick<
  CharacterDecision,
  "decision" | "action" | "dialogue" | "publicReason" | "initiative"
>;

export type TurnStateSnapshot = {
  characters: Record<CharacterId, CharacterState>;
  shared: {
    relationshipLabel: RelationshipLabel;
    unresolvedConflicts: string[];
    memoryIds: string[];
  };
};

export type CueInputMethod = "free_text" | "candidate" | "observe" | "fast_forward";
export type CueResolutionOutcome = "selected" | "transformed" | "locked_fallback" | "observed";
export type ResolutionBranch =
  | "both_participated"
  | "one_participated"
  | "both_declined"
  | "modified"
  | "self_initiated"
  | "fallback";

export type EventLogEntry = {
  id: string;
  turnId?: string;
  day: number;
  phase: Phase;
  eventDefinitionId: string;
  eventCategory?: EventCategory;
  intimacyTier?: 0 | 1 | 2 | 3;
  cooldownPhases?: number;
  cueSafetyFlags: CueSafetyFlag[];
  suggestion: string;
  haruReaction: string;
  aoiReaction: string;
  haruDecision?: DecisionKind;
  aoiDecision?: DecisionKind;
  haruAction?: string;
  aoiAction?: string;
  haruDialogue?: string;
  aoiDialogue?: string;
  conversation?: EventConversationLine[];
  storyBeats?: EventStoryBeat[];
  haruPublicReason?: string;
  aoiPublicReason?: string;
  scene?: Partial<Record<CharacterId, string>>;
  memoryId?: string;
  cue?: ProducerCue;
  inputMethod?: CueInputMethod;
  requestedEventId?: string;
  alternativesShown?: EventCandidate[];
  lock?: EventLock;
  cueOutcome?: CueResolutionOutcome;
  navigatorMessage?: string;
  navigatorResponse?: NavigatorResponse;
  decisions?: Record<CharacterId, PublicCharacterDecision>;
  resolutionBranch?: ResolutionBranch;
  before?: TurnStateSnapshot;
  after?: TurnStateSnapshot;
  appliedEffects?: Record<CharacterId, StatDelta>;
  memory?: Memory;
  conflictUpdate?: { add: string[]; resolve: string[] };
  runtimeSources?: Record<CoreAgentId, AgentSource> &
    Partial<Record<"navigator", AgentSource>>;
  eventTitle: string;
  narration: string;
  relationshipBefore: RelationshipLabel;
  relationshipAfter: RelationshipLabel;
  createdAt: string;
};

export type EndingKind = "couple" | "unspoken" | "close_friends" | "roommates" | "broken";
export type Ending = { kind: EndingKind; title: string; narration: string };

export type ProducerScoreAxisId = "agency" | "wellbeing" | "care" | "pacing" | "story";

export type ProducerScoreEvidence = {
  id: string;
  ruleId: string;
  points: number;
  message: string;
  eventLogIds: string[];
  day?: number;
  phase?: Phase;
};

export type ProducerScoreAxis = {
  id: ProducerScoreAxisId;
  label: string;
  score: number;
  maxScore: number;
  summary: string;
  evidence: ProducerScoreEvidence[];
};

export type ResultHighlightKind =
  | "relationship_turn"
  | "self_initiated"
  | "respected_no"
  | "conflict_repaired"
  | "quiet_moment"
  | "important_memory";

export type ResultHighlight = {
  id: string;
  kind: ResultHighlightKind;
  headline: string;
  reason: string;
  eventLogIds: string[];
  memoryId?: string;
};

export type ProducerStyle =
  | "space_maker"
  | "condition_reader"
  | "relationship_mender"
  | "pace_designer"
  | "turning_point_editor";

export type ProducerResult = {
  overallScore: number;
  rank: "S" | "A" | "B" | "C";
  producerStyle: ProducerStyle;
  scoringVersion: string;
  axes: ProducerScoreAxis[];
  topStrengths: ProducerScoreEvidence[];
  improvements: ProducerScoreEvidence[];
  highlights: ResultHighlight[];
  keyMemoryIds: string[];
  turningPointEventLogIds: string[];
  statJourney?: { start: TurnStateSnapshot; end: TurnStateSnapshot };
  coverage: {
    ratio: number;
    completeTurns: number;
    expectedTurns: number;
    missing: string[];
  };
  warnings: string[];
};

export type NarrativeParagraph = {
  text: string;
  sourceEventLogIds: string[];
};

export type DailyResultSection = {
  day: number;
  title: string;
  paragraphs: NarrativeParagraph[];
  featuredEventLogId?: string;
};

export type ResultNarrative = {
  headline: string;
  lead: NarrativeParagraph[];
  daySections: DailyResultSection[];
  closing: NarrativeParagraph[];
  narrativeVersion: string;
};

export type AgentResultReflection = {
  characterId: CharacterId;
  seasonImpression: string;
  notableEventComments: Array<{ eventLogId: string; comment: string }>;
  bestMomentEventLogId: string | null;
  turningPointEventLogId: string | null;
  messageToProducer: string;
  reflectionVersion: string;
  runtime?: RuntimeAgentState;
};

export type ResultFailure = {
  component: "narrative" | "haru_reflection" | "aoi_reflection";
  reason: string;
  retryable: boolean;
};

export type ResultGenerationIdentity = {
  generationKey: string;
  endingRevision: number;
  scoringVersion: string;
  narrativeVersion: string;
  reflectionVersion: string;
};

export type GameResult =
  | (ResultGenerationIdentity & {
      status: "generating";
      ending: Ending;
      producer: ProducerResult;
      startedAt: string;
    })
  | (ResultGenerationIdentity & {
      status: "ready";
      ending: Ending;
      producer: ProducerResult;
      narrative: ResultNarrative;
      reflections: Record<CharacterId, AgentResultReflection>;
      generatedAt: string;
      dataQuality: "complete";
    })
  | (ResultGenerationIdentity & {
      status: "partial";
      ending: Ending;
      producer: ProducerResult;
      narrative?: ResultNarrative;
      reflections: Partial<Record<CharacterId, AgentResultReflection>>;
      failures: ResultFailure[];
      generatedAt: string;
      dataQuality: "partial";
    });

export type CharacterRecord = {
  state: CharacterState;
  lastDecision?: PublicCharacterDecision;
};

export type GameState = {
  version: 2;
  seed: string;
  /** Rotates on reset so a new game never reuses private agent conversation history. */
  agentEpoch?: number;
  revision: number;
  status: GameStatus;
  turnId?: string;
  characters: Record<CharacterId, CharacterRecord>;
  shared: SharedState;
  lastEvent?: ResolvedEvent;
  /** Last public response from the in-game navigator, デコピン. */
  navigator?: NavigatorResponse;
  eventLog: EventLogEntry[];
  ending?: Ending;
  result?: GameResult;
  runtime: Record<CoreAgentId, RuntimeAgentState> &
    Partial<Record<"navigator", RuntimeAgentState>>;
};

export type StreamEventName =
  | "turn.started"
  | "navigator.thinking"
  | "navigator.completed"
  | "agent.thinking"
  | "agent.completed"
  | "director.resolving"
  | "director.completed"
  | "result.generating"
  | "agent.reflecting"
  | "agent.reflected"
  | "result.completed"
  | "turn.completed"
  | "warning"
  | "error";

export type StreamEvent = {
  type: StreamEventName;
  message: string;
  agent?: AgentId;
  data?: unknown;
};

export interface CharacterAgent {
  decide(input: CharacterDecisionInput): Promise<CharacterDecision>;
}

export interface DirectorAgent {
  resolve(input: DirectorInput): Promise<ResolvedEvent>;
}
