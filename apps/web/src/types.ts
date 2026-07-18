export type Phase = "morning" | "afternoon" | "evening" | "night";

export type RelationshipLabel =
  | "strangers"
  | "roommates"
  | "friends"
  | "close_friends"
  | "romantic_tension"
  | "couple"
  | "broken";

export type DecisionType =
  | "ACCEPT"
  | "DECLINE"
  | "MODIFY"
  | "IGNORE"
  | "INITIATE";

export type MetricKey =
  | "energy"
  | "stress"
  | "affection"
  | "trust"
  | "romanticAwareness";

export interface CharacterState {
  energy: number;
  stress: number;
  affection: number;
  trust: number;
  romanticAwareness: number;
  mood: string;
  location: string;
  currentGoal: string;
}

export interface AgentDecision {
  decision: DecisionType;
  action: string;
  dialogue?: string;
  publicReason?: string;
  internalSummary?: string;
}

export interface Memory {
  id: string;
  day: number;
  phase: string;
  title: string;
  summary: string;
  emotionalImpact: number;
  participants: string[];
  importance: number;
}

export interface SharedState {
  day: number;
  phase: Phase;
  relationshipLabel: RelationshipLabel;
  unresolvedConflicts: string[];
  sharedMemories: Memory[];
}

export interface GameEvent {
  id: string;
  eventDefinitionId?: string;
  day: number;
  phase: Phase;
  eventTitle: string;
  narration: string;
  haruDialogue?: string;
  aoiDialogue?: string;
  suggestion?: string;
  timestamp?: string;
}

export interface RuntimeInfo {
  mode: "app-server" | "mock" | "offline" | "unknown";
  label?: string;
  model?: string;
  haruThreadId?: string;
  aoiThreadId?: string;
  directorThreadId?: string;
}

export interface GameState {
  revision: number;
  status: "awaiting_suggestion" | "resolving" | "resolved" | "ended";
  haru: CharacterState;
  aoi: CharacterState;
  shared: SharedState;
  decisions: {
    haru?: AgentDecision;
    aoi?: AgentDecision;
  };
  currentEvent?: GameEvent;
  eventLog: GameEvent[];
  runtime: RuntimeInfo;
  ending?: string;
  completed: boolean;
}

export interface StreamMessage {
  event: string;
  data: unknown;
}
