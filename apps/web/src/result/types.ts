export const RESULT_PHASES = ["morning", "afternoon", "evening", "night"] as const;

export type ResultPhase = (typeof RESULT_PHASES)[number];
export type ResultCharacterId = "haru" | "aoi";
export type ResultDecisionKind = "ACCEPT" | "DECLINE" | "MODIFY" | "IGNORE" | "INITIATE";
export type ResultRank = "S" | "A" | "B" | "C";
export type ResultStatus = "generating" | "ready" | "partial";
export type ResultDataQuality = "complete" | "partial";

export type ResultRelationshipLabel =
  | "strangers"
  | "roommates"
  | "friends"
  | "close_friends"
  | "romantic_tension"
  | "couple"
  | "broken";

export type ResultMetricKey =
  | "energy"
  | "stress"
  | "affection"
  | "trust"
  | "romanticAwareness";

export type ResultCharacterSnapshot = Record<ResultMetricKey, number> & {
  mood?: string;
  location?: string;
  currentGoal?: string;
};

export type ResultTurnSnapshot = {
  characters: Partial<Record<ResultCharacterId, ResultCharacterSnapshot>>;
  shared?: {
    relationshipLabel?: ResultRelationshipLabel;
    unresolvedConflictIds?: string[];
    memoryIds?: string[];
  };
};

export type ResultPublicDecision = {
  decision: ResultDecisionKind;
  action: string;
  dialogue?: string;
  publicReason?: string;
};

export type ResultConversationTurn = {
  speaker: ResultCharacterId;
  text: string;
};

export type ResultStatDelta = Partial<Record<ResultMetricKey, number>>;

export type ResultMemory = {
  id: string;
  title: string;
  summary?: string;
  emotionalImpact?: number;
  importance?: number;
};

export type ResultConflictRecord = {
  id: string;
  summary?: string;
};

/**
 * Result UIが必要とする公開ログの最小契約。
 * v1のGameEventもそのまま渡せるよう、v2で追加される構造化情報はoptionalにしている。
 */
export type ResultEventLogEntry = {
  id: string;
  day: number;
  phase: ResultPhase;
  eventTitle: string;
  narration: string;
  eventDefinitionId?: string;
  suggestion?: string;
  navigatorMessage?: string;
  cueSafetyFlags?: string[];
  /** Resolved room labels used to reconstruct the event capture. */
  scene?: Partial<Record<ResultCharacterId, string>>;
  haruDecision?: ResultDecisionKind;
  aoiDecision?: ResultDecisionKind;
  haruAction?: string;
  aoiAction?: string;
  haruDialogue?: string;
  aoiDialogue?: string;
  /** Ordered post-event exchange shown in the room after residents arrive. */
  conversation?: ResultConversationTurn[];
  haruPublicReason?: string;
  aoiPublicReason?: string;
  memoryId?: string;
  relationshipBefore?: ResultRelationshipLabel;
  relationshipAfter?: ResultRelationshipLabel;
  decisions?: Partial<Record<ResultCharacterId, ResultPublicDecision>>;
  resolutionBranch?: string;
  before?: ResultTurnSnapshot;
  after?: ResultTurnSnapshot;
  statesBefore?: Partial<Record<ResultCharacterId, ResultCharacterSnapshot>>;
  statesAfter?: Partial<Record<ResultCharacterId, ResultCharacterSnapshot>>;
  appliedEffects?: Partial<Record<ResultCharacterId, ResultStatDelta>>;
  memory?: ResultMemory;
  conflictUpdate?: {
    added?: ResultConflictRecord[];
    add?: string[];
    resolvedIds?: string[];
    resolve?: string[];
  };
  cueResolution?: {
    cue?: {
      text?: string;
      safetyFlags?: string[];
      transformed?: boolean;
    };
    selectedEvent?: {
      id?: string;
      title?: string;
      category?: string;
      intimacyTier?: number;
    };
    outcome?: string;
    lock?: { reason?: string };
  };
};

export type ResultEvidence = {
  id: string;
  ruleId?: string;
  points: number;
  message: string;
  eventLogIds: string[];
};

export type ResultScoreAxis = {
  id: "agency" | "wellbeing" | "care" | "pacing" | "story";
  score: number;
  maxScore: number;
  summary: string;
  evidence?: ResultEvidence[];
};

export type ResultHighlight = {
  id: string;
  kind:
    | "relationship_turn"
    | "self_initiated"
    | "respected_no"
    | "conflict_repaired"
    | "quiet_moment"
    | "important_memory"
    | string;
  headline: string;
  reason: string;
  eventLogIds: string[];
  memoryId?: string;
};

export type ResultProducer = {
  overallScore: number;
  rank: ResultRank;
  producerStyle: string;
  scoringVersion: string;
  axes: ResultScoreAxis[];
  topStrengths?: ResultEvidence[];
  improvements?: ResultEvidence[];
  highlights?: ResultHighlight[];
  highlightEventLogIds?: string[];
  keyMemoryIds?: string[];
  turningPointEventLogIds?: string[];
  statJourney?: {
    start: ResultTurnSnapshot;
    end: ResultTurnSnapshot;
  };
  coverage?:
    | number
    | {
        ratio: number;
        completeTurns: number;
        expectedTurns: number;
        missing: string[];
      };
  warnings?: string[];
};

export type ResultNarrativeParagraph = {
  text: string;
  sourceEventLogIds: string[];
};

export type ResultDailyNarrative = {
  day: number;
  title: string;
  paragraphs?: ResultNarrativeParagraph[];
  featuredEventLogId?: string;
  /** Transitional shape from the original design document. */
  body?: string;
  sourceEventLogIds?: string[];
};

export type ResultNarrative = {
  headline: string;
  lead: ResultNarrativeParagraph[] | string;
  daySections: ResultDailyNarrative[];
  closing: ResultNarrativeParagraph[] | string;
  sourceEventLogIds?: string[];
  narrativeVersion: string;
};

export type ResultAgentReflection = {
  characterId: ResultCharacterId;
  seasonImpression: string;
  notableEventComments: Array<{
    eventLogId: string;
    comment: string;
  }>;
  bestMomentEventLogId: string | null;
  turningPointEventLogId: string | null;
  messageToProducer: string;
  reflectionVersion: string;
};

export type ResultEnding = {
  kind: "couple" | "unspoken" | "close_friends" | "roommates" | "broken" | string;
  title: string;
  narration: string;
};

export type ResultFailure = {
  component: "narrative" | "haru_reflection" | "aoi_reflection" | string;
  reason: string;
  retryable: boolean;
};

type ResultBase = {
  ending: ResultEnding;
  producer: ResultProducer;
  generationKey?: string;
  endingRevision?: number;
  narrativeVersion?: string;
  reflectionVersion?: string;
};

export type ResultGeneratingData = ResultBase & {
  status: "generating";
  startedAt?: string;
  narrative?: ResultNarrative;
  reflections?: Partial<Record<ResultCharacterId, ResultAgentReflection>>;
  dataQuality?: ResultDataQuality;
};

export type ResultReadyData = ResultBase & {
  status: "ready";
  narrative: ResultNarrative;
  reflections: Record<ResultCharacterId, ResultAgentReflection>;
  generatedAt?: string;
  dataQuality: "complete";
};

export type ResultPartialData = ResultBase & {
  status: "partial";
  narrative?: ResultNarrative;
  reflections: Partial<Record<ResultCharacterId, ResultAgentReflection>>;
  failures?: ResultFailure[];
  generatedAt?: string;
  dataQuality: "partial";
};

export type ResultScreenData = ResultGeneratingData | ResultReadyData | ResultPartialData;

export type ResultScreenGame = {
  status?: string;
  shared: {
    relationshipLabel: ResultRelationshipLabel;
  };
  eventLog: ResultEventLogEntry[];
  result?: ResultScreenData;
  ending?: ResultEnding | string;
};

export type ResultScreenProps = {
  game: ResultScreenGame;
  onRestartSameSeed?: () => void | Promise<void>;
  onRestartNewSeed?: () => void | Promise<void>;
};
