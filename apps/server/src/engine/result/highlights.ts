import type { ResultHighlight, ResultHighlightKind } from "@roommates/shared";
import {
  decisionFor,
  eventTier,
  hasInitiative,
  hasRefusal,
  isObserve,
  isProducerIntervention,
  isRecoveryAction,
  relationshipAfter,
  relationshipBefore,
  relationshipChanged,
  sameIntervention,
  sortEventLog,
  turnOrdinal,
  uniqueIds,
} from "./log-utils.js";
import type { StructuredEventLogEntry } from "./types.js";

type HighlightCandidate = ResultHighlight & {
  primaryEventLogId: string;
  day: number;
  memoryImportance: number;
  emotionalImpact: number;
  hasRelationshipChange: boolean;
  salience: number;
};

const KIND_PRIORITY: Record<ResultHighlightKind, number> = {
  relationship_turn: 0,
  conflict_repaired: 1,
  respected_no: 2,
  important_memory: 3,
  self_initiated: 4,
  quiet_moment: 5,
};

function candidate(
  entry: StructuredEventLogEntry,
  kind: ResultHighlightKind,
  headline: string,
  reason: string,
  options: {
    eventLogIds?: string[];
    memoryId?: string;
    primaryEventLogId?: string;
    salience?: number;
  } = {},
): HighlightCandidate {
  const eventLogIds = uniqueIds(options.eventLogIds ?? [entry.id]);
  return {
    id: `highlight:${kind}:${eventLogIds.join("+")}`,
    kind,
    headline,
    reason,
    eventLogIds,
    ...(options.memoryId ? { memoryId: options.memoryId } : {}),
    primaryEventLogId: options.primaryEventLogId ?? entry.id,
    day: entry.day,
    memoryImportance: entry.memory?.importance ?? 0,
    emotionalImpact: Math.abs(entry.memory?.emotionalImpact ?? 0),
    hasRelationshipChange: relationshipChanged(entry),
    salience: options.salience ?? 0,
  };
}

function compareCandidates(left: HighlightCandidate, right: HighlightCandidate): number {
  return (
    right.salience - left.salience ||
    right.memoryImportance - left.memoryImportance ||
    right.emotionalImpact - left.emotionalImpact ||
    Number(right.hasRelationshipChange) - Number(left.hasRelationshipChange) ||
    left.day - right.day ||
    KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind] ||
    left.primaryEventLogId.localeCompare(right.primaryEventLogId) ||
    left.id.localeCompare(right.id)
  );
}

function isRespectedFollowUp(
  refused: StructuredEventLogEntry,
  next: StructuredEventLogEntry,
): boolean {
  const previousTier = eventTier(refused);
  const nextTier = eventTier(next);
  return (
    isRecoveryAction(next, refused) ||
    !sameIntervention(next, refused) ||
    (previousTier !== undefined && nextTier !== undefined && nextTier < previousTier)
  );
}

function buildCandidates(eventLog: StructuredEventLogEntry[]): HighlightCandidate[] {
  const candidates: HighlightCandidate[] = [];
  const conflictCreators = new Map<string, StructuredEventLogEntry>();

  for (const entry of eventLog) {
    for (const conflictId of entry.conflictUpdate?.add ?? []) {
      if (!conflictCreators.has(conflictId)) conflictCreators.set(conflictId, entry);
    }

    if (relationshipChanged(entry)) {
      candidates.push(
        candidate(
          entry,
          "relationship_turn",
          `${relationshipBefore(entry)}から${relationshipAfter(entry)}へ`,
          `二人の関係が「${relationshipBefore(entry)}」から「${relationshipAfter(entry)}」へ変化した。`,
          { salience: 40 },
        ),
      );
    }

    if ((entry.conflictUpdate?.resolve.length ?? 0) > 0) {
      const creators = (entry.conflictUpdate?.resolve ?? [])
        .map((id) => conflictCreators.get(id)?.id)
        .filter((id): id is string => Boolean(id));
      candidates.push(
        candidate(
          entry,
          "conflict_repaired",
          `すれ違いをほどいた「${entry.eventTitle}」`,
          `${entry.conflictUpdate?.resolve.length ?? 0}件の対立が、後の出来事で解消された。`,
          { eventLogIds: [...creators, entry.id], salience: 36 },
        ),
      );
    }

    if (entry.memory && (entry.memory.importance >= 6 || Math.abs(entry.memory.emotionalImpact) >= 4)) {
      candidates.push(
        candidate(
          entry,
          "important_memory",
          entry.memory.title,
          `重要度${entry.memory.importance}の共有記憶として、7日間に残った。`,
          {
            memoryId: entry.memory.id,
            salience: entry.memory.importance + Math.abs(entry.memory.emotionalImpact),
          },
        ),
      );
    }

    if (entry.resolutionBranch === "self_initiated" && hasInitiative(entry)) {
      const initiators = (["haru", "aoi"] as const).filter(
        (characterId) => decisionFor(entry, characterId)?.decision === "INITIATE",
      );
      const initiativeSubject =
        initiators.length === 2
          ? "二人"
          : initiators[0] === "haru"
            ? "Haru"
            : "Aoi";
      candidates.push(
        candidate(
          entry,
          "self_initiated",
          `${initiativeSubject}から始まった「${entry.eventTitle}」`,
          "Producerの指示で上書きされず、Agent自身のINITIATEが出来事になった。",
          { salience: 28 },
        ),
      );
    }
  }

  for (let index = 0; index < eventLog.length; index += 1) {
    const entry = eventLog[index]!;
    const nextEntries = eventLog.slice(index + 1).filter(
      (next) =>
        turnOrdinal(next) - turnOrdinal(entry) <= 2 && isProducerIntervention(next),
    );

    if (hasRefusal(entry)) {
      const next = nextEntries[0];
      if (next && isRespectedFollowUp(entry, next)) {
        candidates.push(
          candidate(
            next,
            "respected_no",
            "「しない」を尊重した次の一手",
            `Day ${entry.day}の拒否を押し切らず、別案・低い強度・見守りへ切り替えた。`,
            { eventLogIds: [entry.id, next.id], primaryEventLogId: next.id, salience: 32 },
          ),
        );
      }
    }

    if (isObserve(entry) || isRecoveryAction(entry, eventLog[index - 1])) {
      const initiative = nextEntries.find(
        (next) => next.resolutionBranch === "self_initiated" && hasInitiative(next),
      );
      if (initiative) {
        candidates.push(
          candidate(
            initiative,
            "quiet_moment",
            `余白から生まれた「${initiative.eventTitle}」`,
            "見守りや休息のあとに、Agent自身の行動が生まれた。",
            {
              eventLogIds: [entry.id, initiative.id],
              primaryEventLogId: initiative.id,
              salience: 24,
            },
          ),
        );
      }
    }
  }

  return candidates;
}

function stripCandidate(candidateValue: HighlightCandidate): ResultHighlight {
  return {
    id: candidateValue.id,
    kind: candidateValue.kind,
    headline: candidateValue.headline,
    reason: candidateValue.reason,
    eventLogIds: candidateValue.eventLogIds,
    ...(candidateValue.memoryId ? { memoryId: candidateValue.memoryId } : {}),
  };
}

/** Selects up to four deterministic, non-duplicated moments from public turn data. */
export function selectHighlights(
  input: readonly StructuredEventLogEntry[],
  limit = 4,
): ResultHighlight[] {
  if (limit <= 0) return [];
  const eventLog = sortEventLog(input);
  const remaining = buildCandidates(eventLog).sort(compareCandidates);
  const selected: HighlightCandidate[] = [];
  const selectedKinds = new Set<ResultHighlightKind>();
  const selectedPrimaryEvents = new Set<string>();

  // First keep the result representative: one event per kind and no primary event twice.
  for (const current of remaining) {
    if (selected.length >= limit) break;
    if (selectedKinds.has(current.kind) || selectedPrimaryEvents.has(current.primaryEventLogId)) {
      continue;
    }
    selected.push(current);
    selectedKinds.add(current.kind);
    selectedPrimaryEvents.add(current.primaryEventLogId);
  }

  // If fewer kinds exist, fill with another day before repeating an already represented day.
  while (selected.length < limit) {
    const candidatePool = remaining.filter(
      (current) => !selectedPrimaryEvents.has(current.primaryEventLogId),
    );
    if (candidatePool.length === 0) break;
    const representedDays = new Set(selected.map((current) => current.day));
    candidatePool.sort(
      (left, right) =>
        Number(representedDays.has(left.day)) - Number(representedDays.has(right.day)) ||
        compareCandidates(left, right),
    );
    const next = candidatePool[0]!;
    selected.push(next);
    selectedPrimaryEvents.add(next.primaryEventLogId);
  }

  return selected.map(stripCandidate);
}
