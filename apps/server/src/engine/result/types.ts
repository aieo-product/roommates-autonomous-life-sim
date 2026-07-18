import type {
  Ending,
  EventLogEntry,
  ProducerResult,
  ProducerScoreAxis,
  ProducerScoreEvidence,
  ResultHighlight,
  ResultNarrative,
} from "@roommates/shared";

/**
 * The shared EventLogEntry keeps structured fields optional while v1 saves are
 * supported. Result calculation treats it as the v2 turn record and reports
 * every missing group through coverage instead of guessing from reaction text.
 *
 * cooldownPhases is a turn-time catalog snapshot required to evaluate PC-10
 * without consulting a newer EventDefinition catalog.
 */
export type StructuredEventLogEntry = EventLogEntry & {
  cooldownPhases?: number;
};

export type {
  Ending,
  ProducerResult,
  ProducerScoreAxis,
  ProducerScoreEvidence,
  ResultHighlight,
  ResultNarrative,
};

