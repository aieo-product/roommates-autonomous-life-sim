import type {
  ResultEnding,
  ResultEventLogEntry,
  ResultScreenData,
} from "./result/types.js";

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
}

export interface Memory {
  id: string;
  sourceEventId?: string;
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

export interface GameEvent extends ResultEventLogEntry {
  id: string;
  eventDefinitionId?: string;
  memoryId?: string;
  day: number;
  phase: Phase;
  eventTitle: string;
  narration: string;
  haruDialogue?: string;
  aoiDialogue?: string;
  haruDecision?: DecisionType;
  aoiDecision?: DecisionType;
  haruAction?: string;
  aoiAction?: string;
  haruPublicReason?: string;
  aoiPublicReason?: string;
  scene?: {
    haru?: string;
    aoi?: string;
  };
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
  version: 2;
  seed: string;
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
  ending?: ResultEnding | string;
  result?: ResultScreenData;
  completed: boolean;
}

export interface StreamMessage {
  event: string;
  data: unknown;
}
