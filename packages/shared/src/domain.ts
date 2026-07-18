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
export type AgentId = CharacterId | "director";
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

export type SafeSuggestion = {
  kind: "proposal" | "observe";
  text: string;
  tags: ProposalTag[];
  cue: ProducerCue;
  eventDefinitionId: string;
  eventTitle: string;
  intimacyTier: 0 | 1 | 2 | 3;
  lock?: EventLock;
  alternatives: EventCandidate[];
};

export type CharacterDecision = {
  decision: DecisionKind;
  action: string;
  dialogue: string;
  publicReason: string;
  internalSummary: string;
  expectedEffects: StatDelta;
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
  snapshot: GameSnapshot;
  self: CharacterState;
  otherKnownInfo: Pick<CharacterState, "mood" | "location" | "currentGoal">;
  recentMemories: Memory[];
  importantMemories: Memory[];
  suggestion: SafeSuggestion;
};

export type DirectorInput = {
  turnId: string;
  snapshot: GameSnapshot;
  suggestion: SafeSuggestion;
  haruDecision: CharacterDecision;
  aoiDecision: CharacterDecision;
};

export type ResolvedEvent = {
  eventTitle: string;
  narration: string;
  haruDialogue: string;
  aoiDialogue: string;
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

export type EventLogEntry = {
  id: string;
  day: number;
  phase: Phase;
  eventDefinitionId: string;
  cueSafetyFlags: CueSafetyFlag[];
  suggestion: string;
  haruReaction: string;
  aoiReaction: string;
  eventTitle: string;
  narration: string;
  relationshipBefore: RelationshipLabel;
  relationshipAfter: RelationshipLabel;
  createdAt: string;
};

export type EndingKind = "couple" | "unspoken" | "close_friends" | "roommates" | "broken";
export type Ending = { kind: EndingKind; title: string; narration: string };

export type CharacterRecord = {
  state: CharacterState;
  lastDecision?: CharacterDecision;
  internalSummary?: string;
};

export type GameState = {
  version: 1;
  seed: string;
  revision: number;
  status: GameStatus;
  turnId?: string;
  characters: Record<CharacterId, CharacterRecord>;
  shared: SharedState;
  lastEvent?: ResolvedEvent;
  eventLog: EventLogEntry[];
  ending?: Ending;
  runtime: Record<AgentId, RuntimeAgentState>;
};

export type StreamEventName =
  | "turn.started"
  | "agent.thinking"
  | "agent.completed"
  | "director.resolving"
  | "director.completed"
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
