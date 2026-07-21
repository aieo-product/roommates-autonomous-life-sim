import type {
  CharacterId,
  CharacterRoster,
  Ending,
  Phase,
  ProducerResult,
  ProducerScoreAxis,
  ProducerScoreAxisId,
  ProducerScoreEvidence,
  ProducerStyle,
  TurnStateSnapshot,
} from "@roommates/shared";
import { characterDisplayName } from "@roommates/shared";
import { selectHighlights } from "./highlights.js";
import {
  CHARACTER_IDS,
  decisionFor,
  eligibilitySignature,
  eventCategory,
  eventTier,
  hasInitiative,
  hasModify,
  hasRefusal,
  isConditionStrained,
  isHighIntensity,
  isLowIntensity,
  isObserve,
  isProducerIntervention,
  isRecoveryAction,
  relationshipChanged,
  requestedCategory,
  sameIntervention,
  sortEventLog,
  strainedCharacters,
  turnOrdinal,
  uniqueIds,
} from "./log-utils.js";
import type { StructuredEventLogEntry } from "./types.js";

export const PRODUCER_SCORING_VERSION = "producer-v1" as const;
export const EXPECTED_RUN_TURNS = 28;

export const PRODUCER_SCORE_RULES = {
  "AG-01": { axis: "agency", points: 2, cap: 6 },
  "AG-02": { axis: "agency", points: 2, cap: 4 },
  "AG-03": { axis: "agency", points: 1, cap: 3 },
  "AG-10": { axis: "agency", points: -4, cap: 12 },
  "AG-11": { axis: "agency", points: -3, cap: 6 },
  "WB-01": { axis: "wellbeing", points: 2, cap: 8 },
  "WB-02": { axis: "wellbeing", points: 1, cap: 3 },
  "WB-10": { axis: "wellbeing", points: -3, cap: 9 },
  "WB-11": { axis: "wellbeing", points: -3, cap: 6 },
  "WB-12": { axis: "wellbeing", points: -1, cap: 3 },
  "CA-01": { axis: "care", points: 2, cap: 4 },
  "CA-02": { axis: "care", points: 1, cap: 2 },
  "CA-03": { axis: "care", points: 1, cap: 4 },
  "CA-10": { axis: "care", points: -3, cap: 9 },
  "CA-11": { axis: "care", points: -2, cap: 4 },
  "CA-12": { axis: "care", points: -3, cap: 6 },
  "PC-01": { axis: "pacing", points: 1, cap: 3 },
  "PC-02": { axis: "pacing", points: 2, cap: 4 },
  "PC-10": { axis: "pacing", points: -2, cap: 6 },
  "PC-11": { axis: "pacing", points: -3, cap: 6 },
  "PC-12": { axis: "pacing", points: -2, cap: 4 },
  "ST-01": { axis: "story", points: 1, cap: 4 },
  "ST-02": { axis: "story", points: 1, cap: 3 },
  "ST-03": { axis: "story", points: 2, cap: 4 },
  "ST-04": { axis: "story", points: 1, cap: 2 },
  "ST-10": { axis: "story", points: -1, cap: 5 },
  "ST-11": { axis: "story", points: -2, cap: 4 },
} as const satisfies Record<
  string,
  { axis: ProducerScoreAxisId; points: number; cap: number }
>;

export type ProducerRuleId = keyof typeof PRODUCER_SCORE_RULES;

const AXES: ReadonlyArray<{
  id: ProducerScoreAxisId;
  label: string;
  base: number;
  max: number;
  summary: string;
  style: ProducerStyle;
}> = [
  {
    id: "agency",
    label: "主体性の尊重",
    base: 15,
    max: 25,
    summary: "拒否・変更・自発的な行動を、押し切らずに扱えたか。",
    style: "space_maker",
  },
  {
    id: "wellbeing",
    label: "心理安全・コンディション",
    base: 15,
    max: 25,
    summary: "疲労やストレス、安全変換を読み、回復の余白を置けたか。",
    style: "condition_reader",
  },
  {
    id: "care",
    label: "関係へのケア",
    base: 10,
    max: 20,
    summary: "実在する対立や共有記憶を、二人の意思を保って扱えたか。",
    style: "relationship_mender",
  },
  {
    id: "pacing",
    label: "ペーシング",
    base: 8,
    max: 15,
    summary: "イベントの強度、間、lockとcooldownを尊重できたか。",
    style: "pace_designer",
  },
  {
    id: "story",
    label: "物語の豊かさ",
    base: 6,
    max: 15,
    summary: "多様な出来事と自然な転機を、反復に頼らずつなげたか。",
    style: "turning_point_editor",
  },
];

type EvidenceInput = {
  ruleId: ProducerRuleId;
  entry: StructuredEventLogEntry;
  eventLogIds?: string[];
  message: string;
};

class EvidenceCollector {
  private readonly evidence: ProducerScoreEvidence[] = [];
  private readonly totals = new Map<ProducerRuleId, number>();
  private readonly seen = new Set<string>();

  add({ ruleId, entry, eventLogIds = [entry.id], message }: EvidenceInput): void {
    const definition = PRODUCER_SCORE_RULES[ruleId];
    const occurrenceKey = `${ruleId}:${entry.id}`;
    if (this.seen.has(occurrenceKey)) return;

    const current = this.totals.get(ruleId) ?? 0;
    const sign = Math.sign(definition.points);
    const available = Math.max(0, definition.cap - Math.abs(current));
    if (available === 0) return;
    const points = sign * Math.min(Math.abs(definition.points), available);

    this.seen.add(occurrenceKey);
    this.totals.set(ruleId, current + points);
    const ids = uniqueIds(eventLogIds);
    this.evidence.push({
      id: `${ruleId}:${ids.join("+")}`,
      ruleId,
      points,
      message,
      eventLogIds: ids,
      day: entry.day,
      phase: entry.phase,
    });
  }

  all(): ProducerScoreEvidence[] {
    return [...this.evidence];
  }
}

type RefusalFollowUp = {
  refused: StructuredEventLogEntry;
  next?: StructuredEventLogEntry;
  repeated?: StructuredEventLogEntry;
  respected: boolean;
};

function refusalFollowUps(eventLog: StructuredEventLogEntry[]): RefusalFollowUp[] {
  return eventLog.filter(hasRefusal).map((refused) => {
    const candidates = eventLog.filter(
      (entry) =>
        turnOrdinal(entry) > turnOrdinal(refused) &&
        turnOrdinal(entry) - turnOrdinal(refused) <= 2 &&
        isProducerIntervention(entry),
    );
    const next = candidates[0];
    let repeated: StructuredEventLogEntry | undefined;
    for (const candidate of candidates) {
      if (isRecoveryAction(candidate, refused)) break;
      if (sameIntervention(candidate, refused)) {
        repeated = candidate;
        break;
      }
    }
    const respected = Boolean(
      next && (isRecoveryAction(next, refused) || !sameIntervention(next, refused)),
    );
    return { refused, next, repeated, respected };
  });
}

function isRelevantSafetyTransform(entry: StructuredEventLogEntry): boolean {
  const relevantFlags = entry.cueSafetyFlags.filter((flag) => flag !== "prompt_injection");
  return (
    relevantFlags.length > 0 &&
    (entry.cueOutcome === "transformed" || entry.cue?.transformed === true)
  );
}

function unsafeAttempt(entry: StructuredEventLogEntry): boolean {
  return (
    isRelevantSafetyTransform(entry) ||
    Boolean(entry.lock) ||
    entry.cue?.tags.includes("pressure") === true
  );
}

function repairEvent(entry: StructuredEventLogEntry): boolean {
  const category = eventCategory(entry);
  return category === "apology" || category === "talk";
}

function producerConflictCause(
  entry: StructuredEventLogEntry,
  repeatedAfterNoIds: ReadonlySet<string>,
  repeatedLockIds: ReadonlySet<string>,
): boolean {
  const forcedHighIntensity =
    isHighIntensity(entry) &&
    (hasRefusal(entry) || isConditionStrained(entry.before)) &&
    entry.resolutionBranch !== "both_declined" &&
    entry.resolutionBranch !== "fallback";
  return (
    entry.cueSafetyFlags.length > 0 ||
    entry.cue?.tags.includes("pressure") === true ||
    repeatedAfterNoIds.has(entry.id) ||
    repeatedLockIds.has(entry.id) ||
    forcedHighIntensity
  );
}

function scoreAgency(
  eventLog: StructuredEventLogEntry[],
  collector: EvidenceCollector,
  followUps: RefusalFollowUp[],
): void {
  for (const followUp of followUps) {
    if (followUp.next && followUp.respected) {
      collector.add({
        ruleId: "AG-01",
        entry: followUp.next,
        eventLogIds: [followUp.refused.id, followUp.next.id],
        message: "拒否後2フェーズ以内に、別案・低い強度・見守りへ切り替えた。",
      });
    }
    if (followUp.repeated) {
      collector.add({
        ruleId: "AG-10",
        entry: followUp.repeated,
        eventLogIds: [followUp.refused.id, followUp.repeated.id],
        message: "拒否後、回復行動を挟まず同じ介入を繰り返した。",
      });
    }
  }

  const unsafeHistory: StructuredEventLogEntry[] = [];
  for (const entry of eventLog) {
    if (entry.resolutionBranch === "modified" && hasModify(entry)) {
      collector.add({
        ruleId: "AG-02",
        entry,
        message: "AgentのMODIFYを、軽い内容へ調整する分岐として成立させた。",
      });
    }
    if (entry.resolutionBranch === "self_initiated" && hasInitiative(entry)) {
      collector.add({
        ruleId: "AG-03",
        entry,
        message: "AgentのINITIATEをProducer提案で上書きせず成立させた。",
      });
    }

    if (!unsafeAttempt(entry)) continue;
    const repeated = unsafeHistory.find((previous) => sameIntervention(entry, previous));
    if (repeated) {
      collector.add({
        ruleId: "AG-11",
        entry,
        eventLogIds: [repeated.id, entry.id],
        message: "安全変換またはlock理由の表示後、同種の危険・強制要求を繰り返した。",
      });
    }
    unsafeHistory.push(entry);
  }
}

function scoreWellbeing(
  eventLog: StructuredEventLogEntry[],
  collector: EvidenceCollector,
): void {
  let noRecoveryStreak = 0;
  let previousOrdinal: number | undefined;

  for (let index = 0; index < eventLog.length; index += 1) {
    const entry = eventLog[index]!;
    const previous = eventLog[index - 1];
    const strained = isConditionStrained(entry.before);
    const recovery = isRecoveryAction(entry, previous);

    if (strained && recovery) {
      collector.add({
        ruleId: "WB-01",
        entry,
        message: "energy低下またはstress上昇中に、休息・見守り・低強度へ切り替えた。",
      });
      const recovered = strainedCharacters(entry.before).some((characterId) => {
        const before = entry.before?.characters[characterId];
        const after = entry.after?.characters[characterId];
        return Boolean(before && after && (after.energy > before.energy || after.stress < before.stress));
      });
      if (recovered) {
        collector.add({
          ruleId: "WB-02",
          entry,
          message: "回復行動の後、対象Agentのenergyまたはstressが実際に改善した。",
        });
      }
    }

    if (
      strained &&
      isHighIntensity(entry) &&
      entry.cueOutcome === "selected" &&
      entry.resolutionBranch !== "fallback"
    ) {
      collector.add({
        ruleId: "WB-10",
        entry,
        message: "コンディション低下中に高強度イベントを成立させた。",
      });
    }

    const consecutive = previousOrdinal === undefined || turnOrdinal(entry) === previousOrdinal + 1;
    if (
      strained &&
      eventTier(entry) !== undefined &&
      !recovery &&
      !isLowIntensity(entry) &&
      consecutive
    ) {
      noRecoveryStreak += 1;
      if (noRecoveryStreak >= 2) {
        collector.add({
          ruleId: "WB-11",
          entry,
          message: "コンディション低下中に、低強度または見守りを挟まない介入が続いた。",
        });
      }
    } else {
      noRecoveryStreak =
        strained && eventTier(entry) !== undefined && !recovery && !isLowIntensity(entry) ? 1 : 0;
    }
    previousOrdinal = turnOrdinal(entry);

    if (isRelevantSafetyTransform(entry)) {
      collector.add({
        ruleId: "WB-12",
        entry,
        message: "危険・強制・欺瞞を含むcueが安全な内容へ変換された。",
      });
    }
  }
}

function scoreCare(
  eventLog: StructuredEventLogEntry[],
  collector: EvidenceCollector,
  repeatedAfterNoIds: ReadonlySet<string>,
  repeatedLockIds: ReadonlySet<string>,
): Set<string> {
  const repairOpportunities = new Map<string, StructuredEventLogEntry>();
  const conflictCreators = new Map<string, StructuredEventLogEntry>();
  const producerCausedConflicts = new Set<string>();

  for (const entry of eventLog) {
    const unresolved = entry.before?.shared.unresolvedConflicts ?? [];
    if (unresolved.length > 0 && repairEvent(entry) && entry.cueSafetyFlags.length === 0) {
      collector.add({
        ruleId: "CA-01",
        entry,
        message: "未解決の対立に対し、対象を限定した話し合い・修復の場を置いた。",
      });
      for (const conflictId of unresolved) repairOpportunities.set(conflictId, entry);
    }

    for (const conflictId of entry.conflictUpdate?.add ?? []) {
      if (!conflictCreators.has(conflictId)) conflictCreators.set(conflictId, entry);
      if (producerConflictCause(entry, repeatedAfterNoIds, repeatedLockIds)) {
        producerCausedConflicts.add(conflictId);
        collector.add({
          ruleId: "CA-12",
          entry,
          message: "危険・強制・高強度の押し切りと同じturnで対立が追加された。",
        });
      }
    }

    for (const conflictId of entry.conflictUpdate?.resolve ?? []) {
      const opportunity = repairOpportunities.get(conflictId);
      if (opportunity && turnOrdinal(opportunity) < turnOrdinal(entry)) {
        collector.add({
          ruleId: "CA-02",
          entry,
          eventLogIds: [opportunity.id, entry.id],
          message: "用意した修復機会の後、同じ対立IDが解消された。",
        });
      }
    }

    if (
      entry.memory &&
      entry.memory.importance >= 6 &&
      entry.memory.emotionalImpact > 0 &&
      entry.cueSafetyFlags.length === 0
    ) {
      collector.add({
        ruleId: "CA-03",
        entry,
        message: "安全な出来事から、重要度6以上の肯定的な共有記憶が生まれた。",
      });
    }

    if (repeatedAfterNoIds.has(entry.id) && isHighIntensity(entry)) {
      collector.add({
        ruleId: "CA-10",
        entry,
        message: "拒否後に、告白・接触・高親密度の介入を繰り返した。",
      });
    } else if (repeatedLockIds.has(entry.id) && isHighIntensity(entry)) {
      collector.add({
        ruleId: "CA-10",
        entry,
        message: "条件未達の高親密度イベントを、lock後も繰り返した。",
      });
    }
  }

  for (const [conflictId, created] of conflictCreators) {
    const activeTurns = eventLog.filter(
      (entry) =>
        turnOrdinal(entry) > turnOrdinal(created) &&
        entry.before?.shared.unresolvedConflicts.includes(conflictId),
    );
    const neglected = activeTurns.find((entry) => {
      if (entry.day - created.day < 2) return false;
      const window = eventLog.filter(
        (candidate) =>
          turnOrdinal(candidate) > turnOrdinal(created) &&
          turnOrdinal(candidate) <= turnOrdinal(entry),
      );
      return (
        window.length > 0 &&
        window.every(
          (candidate) =>
            isHighIntensity(candidate) &&
            !isRecoveryAction(candidate) &&
            !repairEvent(candidate),
        )
      );
    });
    if (neglected) {
      collector.add({
        ruleId: "CA-11",
        entry: neglected,
        eventLogIds: [created.id, neglected.id],
        message: "対立が2日以上続く間、高強度介入だけを続けて修復の余白を置かなかった。",
      });
    }
  }

  return producerCausedConflicts;
}

function scorePacing(
  eventLog: StructuredEventLogEntry[],
  collector: EvidenceCollector,
  repeatedLockIds: Set<string>,
): void {
  let previousHighIndex: number | undefined;
  const highCountsByDay = new Map<number, number>();
  const lastCueByCategory = new Map<string, StructuredEventLogEntry>();

  for (let index = 0; index < eventLog.length; index += 1) {
    const entry = eventLog[index]!;
    if (isHighIntensity(entry)) {
      if (previousHighIndex !== undefined) {
        const gap = eventLog.slice(previousHighIndex + 1, index);
        if (gap.some((candidate, gapIndex) => isRecoveryAction(candidate, gap[gapIndex - 1]))) {
          collector.add({
            ruleId: "PC-01",
            entry,
            eventLogIds: [eventLog[previousHighIndex]!.id, entry.id],
            message: "高強度イベントの間に、低強度・見守り・休息を置いた。",
          });
        }
      }
      previousHighIndex = index;

      const count = (highCountsByDay.get(entry.day) ?? 0) + 1;
      highCountsByDay.set(entry.day, count);
      if (count >= 2) {
        collector.add({
          ruleId: "PC-11",
          entry,
          message: "同じ日に高強度イベントを2件以上成立させた。",
        });
      }
    }

    const category = requestedCategory(entry);
    if (category) {
      const previous = lastCueByCategory.get(category);
      const cooldown = Math.max(entry.cooldownPhases ?? 0, previous?.cooldownPhases ?? 0);
      if (previous && cooldown > 0 && turnOrdinal(entry) - turnOrdinal(previous) < cooldown) {
        collector.add({
          ruleId: "PC-10",
          entry,
          eventLogIds: [previous.id, entry.id],
          message: `同categoryを保存済みcooldown（${cooldown}フェーズ）以内に再要求した。`,
        });
      }
      lastCueByCategory.set(category, entry);
    }
  }

  for (let index = 0; index < eventLog.length; index += 1) {
    const locked = eventLog[index]!;
    const requestedId = locked.lock?.requestedEventId ?? locked.requestedEventId;
    if (!locked.lock || !requestedId) continue;

    const repeated = eventLog.slice(index + 1).find(
      (entry) =>
        turnOrdinal(entry) - turnOrdinal(locked) <= 2 &&
        (entry.lock?.requestedEventId ?? entry.requestedEventId) === requestedId,
    );
    if (
      repeated &&
      eligibilitySignature(locked) !== undefined &&
      eligibilitySignature(locked) === eligibilitySignature(repeated)
    ) {
      repeatedLockIds.add(repeated.id);
      collector.add({
        ruleId: "PC-12",
        entry: repeated,
        eventLogIds: [locked.id, repeated.id],
        message: "条件が変わっていないlockイベントを2フェーズ以内に再要求した。",
      });
    }

    const success = eventLog.slice(index + 1).find(
      (entry) => entry.eventDefinitionId === requestedId && !entry.lock && entry.cueOutcome === "selected",
    );
    if (!success) continue;
    const repeatedBeforeUnlock = eventLog.some(
      (entry) =>
        turnOrdinal(entry) > turnOrdinal(locked) &&
        turnOrdinal(entry) < turnOrdinal(success) &&
        (entry.requestedEventId === requestedId || entry.lock?.requestedEventId === requestedId),
    );
    if (!repeatedBeforeUnlock) {
      collector.add({
        ruleId: "PC-02",
        entry: success,
        eventLogIds: [locked.id, success.id],
        message: "lock理由の表示後、条件が満たされるまで同じ要求を繰り返さなかった。",
      });
    }
  }
}

function scoreStory(
  eventLog: StructuredEventLogEntry[],
  collector: EvidenceCollector,
  followUps: RefusalFollowUp[],
  producerCausedConflicts: ReadonlySet<string>,
  characterRoster?: CharacterRoster,
): void {
  const categories = new Set<string>();
  const importantMemoryDays = new Set<number>();
  const firstBalancedAction = new Map<CharacterId, StructuredEventLogEntry>();
  let previousCategory: string | undefined;
  let categoryStreak = 0;
  const conflictCreators = new Map<string, StructuredEventLogEntry>();

  for (const entry of eventLog) {
    const category = eventCategory(entry);
    if (category && !categories.has(category)) {
      categories.add(category);
      if (categories.size >= 3 && categories.size <= 6) {
        collector.add({
          ruleId: "ST-01",
          entry,
          message: `成立イベントのcategoryが${categories.size}種類へ広がった。`,
        });
      }
    }

    if (entry.memory?.importance !== undefined && entry.memory.importance >= 6) {
      if (!importantMemoryDays.has(entry.day) && importantMemoryDays.size >= 1) {
        collector.add({
          ruleId: "ST-02",
          entry,
          message: "重要な共有記憶が、別の日にも生まれた。",
        });
      }
      importantMemoryDays.add(entry.day);
    }

    for (const characterId of CHARACTER_IDS) {
      const decision = decisionFor(entry, characterId)?.decision;
      if ((decision === "MODIFY" || decision === "INITIATE") && !firstBalancedAction.has(characterId)) {
        firstBalancedAction.set(characterId, entry);
      }
    }

    for (const conflictId of entry.conflictUpdate?.add ?? []) {
      if (!conflictCreators.has(conflictId)) conflictCreators.set(conflictId, entry);
    }
    for (const conflictId of entry.conflictUpdate?.resolve ?? []) {
      const created = conflictCreators.get(conflictId);
      if (created && turnOrdinal(created) < turnOrdinal(entry)) {
        collector.add({
          ruleId: "ST-03",
          entry,
          eventLogIds: [created.id, entry.id],
          message: "対立の発生から後の修復へつながる、複数turnの自然な流れが成立した。",
        });
      }
    }

    if (category && category === previousCategory) {
      categoryStreak += 1;
      if (categoryStreak > 2) {
        collector.add({
          ruleId: "ST-10",
          entry,
          message: `同じcategory（${category}）の成立イベントが3回以上続いた。`,
        });
      }
    } else {
      previousCategory = category;
      categoryStreak = category ? 1 : 0;
    }
  }

  if (firstBalancedAction.size === 2) {
    for (const characterId of CHARACTER_IDS) {
      const entry = firstBalancedAction.get(characterId)!;
      collector.add({
        ruleId: "ST-04",
        entry,
        message: `${characterDisplayName(characterRoster, characterId)}のMODIFYまたはINITIATEが成立した。`,
      });
    }
  }

  for (const followUp of followUps.filter((value) => value.respected && value.next)) {
    collector.add({
      ruleId: "ST-03",
      entry: followUp.next!,
      eventLogIds: [followUp.refused.id, followUp.next!.id],
      message: "拒否から尊重へつながる、複数turnの自然な流れが成立した。",
    });
  }

  for (let index = 0; index < eventLog.length; index += 1) {
    const entry = eventLog[index]!;
    if (entry.resolutionBranch !== "self_initiated" || !hasInitiative(entry)) continue;
    const previous = eventLog[index - 1];
    if (previous && (isObserve(previous) || isRecoveryAction(previous, eventLog[index - 2]))) {
      collector.add({
        ruleId: "ST-03",
        entry,
        eventLogIds: [previous.id, entry.id],
        message: "見守り・休息からAgentのINITIATEへつながる自然な流れが成立した。",
      });
    }
  }

  const manufacturedSignatures = new Map<string, number>();
  for (const conflictId of producerCausedConflicts) {
    const created = eventLog.find((entry) => entry.conflictUpdate?.add.includes(conflictId));
    const repaired = eventLog.find(
      (entry) =>
        created !== undefined &&
        turnOrdinal(entry) > turnOrdinal(created) &&
        turnOrdinal(entry) - turnOrdinal(created) <= 2 &&
        entry.conflictUpdate?.resolve.includes(conflictId),
    );
    if (!created || !repaired) continue;
    const signature = `${eventCategory(created) ?? "unknown"}>${eventCategory(repaired) ?? "unknown"}`;
    const count = (manufacturedSignatures.get(signature) ?? 0) + 1;
    manufacturedSignatures.set(signature, count);
    if (count >= 2) {
      collector.add({
        ruleId: "ST-11",
        entry: repaired,
        eventLogIds: [created.id, repaired.id],
        message: "Producer起因の対立と即修復を、同じパターンで繰り返した。",
      });
    }
  }
}

function hasCompleteDecision(entry: StructuredEventLogEntry, characterId: CharacterId): boolean {
  const decision = decisionFor(entry, characterId);
  return Boolean(
    decision &&
      decision.decision &&
      decision.action !== undefined &&
      decision.dialogue !== undefined &&
      decision.publicReason !== undefined,
  );
}

function snapshotComplete(snapshot: TurnStateSnapshot | undefined): boolean {
  if (!snapshot) return false;
  return CHARACTER_IDS.every((id) => {
    const state = snapshot.characters[id];
    return (
      Number.isFinite(state.energy) &&
      Number.isFinite(state.stress) &&
      Number.isFinite(state.affection) &&
      Number.isFinite(state.trust) &&
      Number.isFinite(state.romanticAwareness) &&
      typeof state.mood === "string" &&
      typeof state.location === "string" &&
      typeof state.currentGoal === "string"
    );
  });
}

function requiredGroups(entry: StructuredEventLogEntry): Array<[string, boolean]> {
  const cueAndSelection = Boolean(
    entry.cue &&
      entry.inputMethod &&
      entry.cueOutcome &&
      entry.eventDefinitionId &&
      entry.eventCategory !== undefined &&
      entry.intimacyTier !== undefined,
  );
  const decisions = CHARACTER_IDS.every((id) => hasCompleteDecision(entry, id));
  const snapshots = snapshotComplete(entry.before) && snapshotComplete(entry.after);
  const effects = CHARACTER_IDS.every((id) => entry.appliedEffects?.[id] !== undefined);
  const resolvedRuntime = Boolean(
    entry.eventDefinitionId &&
      entry.eventTitle &&
      entry.eventCategory !== undefined &&
      entry.intimacyTier !== undefined &&
      entry.runtimeSources?.haru &&
      entry.runtimeSources?.aoi &&
      entry.runtimeSources?.director &&
      entry.createdAt,
  );
  return [
    ["cue_selection", cueAndSelection],
    ["decisions", decisions],
    ["snapshots", snapshots],
    ["effects_updates", effects],
    ["event_runtime", resolvedRuntime],
  ];
}

function calculateCoverage(eventLog: StructuredEventLogEntry[]) {
  const missing: string[] = [];
  let presentGroups = 0;
  let completeTurns = 0;

  for (const entry of eventLog.slice(0, EXPECTED_RUN_TURNS)) {
    const groups = requiredGroups(entry);
    const complete = groups.every(([, present]) => present);
    if (complete) completeTurns += 1;
    for (const [name, present] of groups) {
      if (present) presentGroups += 1;
      else missing.push(`${entry.id}:${name}`);
    }
  }

  for (let index = eventLog.length; index < EXPECTED_RUN_TURNS; index += 1) {
    missing.push(`turn-${index + 1}:all-groups`);
  }

  return {
    ratio: Number((presentGroups / (EXPECTED_RUN_TURNS * 5)).toFixed(4)),
    completeTurns,
    expectedTurns: EXPECTED_RUN_TURNS,
    missing,
  };
}

function evidenceChronology(left: ProducerScoreEvidence, right: ProducerScoreEvidence): number {
  const phaseOrder: Record<Phase, number> = {
    morning: 0,
    afternoon: 1,
    evening: 2,
    night: 3,
  };
  return (
    (left.day ?? Number.MAX_SAFE_INTEGER) - (right.day ?? Number.MAX_SAFE_INTEGER) ||
    (left.phase ? phaseOrder[left.phase] : 9) - (right.phase ? phaseOrder[right.phase] : 9) ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.id.localeCompare(right.id)
  );
}

function buildAxes(evidence: ProducerScoreEvidence[]): ProducerScoreAxis[] {
  return AXES.map((axis) => {
    const axisEvidence = evidence
      .filter(
        (item) =>
          PRODUCER_SCORE_RULES[item.ruleId as ProducerRuleId]?.axis === axis.id,
      )
      .sort(evidenceChronology);
    const rawScore = axis.base + axisEvidence.reduce((sum, item) => sum + item.points, 0);
    return {
      id: axis.id,
      label: axis.label,
      score: Math.max(0, Math.min(axis.max, Math.round(rawScore))),
      maxScore: axis.max,
      summary: axis.summary,
      evidence: axisEvidence,
    };
  });
}

function rankFor(score: number): ProducerResult["rank"] {
  if (score >= 90) return "S";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  return "C";
}

function styleFor(axes: ProducerScoreAxis[]): ProducerStyle {
  let best = AXES[0]!;
  let bestRatio = -1;
  for (const definition of AXES) {
    const axis = axes.find((candidate) => candidate.id === definition.id)!;
    const ratio = axis.score / axis.maxScore;
    if (ratio > bestRatio) {
      best = definition;
      bestRatio = ratio;
    }
  }
  return best.style;
}

function topEvidence(
  evidence: ProducerScoreEvidence[],
  positive: boolean,
): ProducerScoreEvidence[] {
  return evidence
    .filter((item) => (positive ? item.points > 0 : item.points < 0))
    .sort(
      (left, right) =>
        Math.abs(right.points) - Math.abs(left.points) ||
        evidenceChronology(left, right),
    )
    .slice(0, 3);
}

function improvementHint(axes: ProducerScoreAxis[]): ProducerScoreEvidence {
  const lowest = [...axes].sort(
    (left, right) => left.score / left.maxScore - right.score / right.maxScore,
  )[0]!;
  return {
    id: `HINT:${lowest.id}`,
    ruleId: `HINT-${lowest.id.toUpperCase()}`,
    points: 0,
    message: `${lowest.label}は、次のrunで肯定的な根拠を増やせる余地がある。`,
    eventLogIds: [],
  };
}

function statJourney(eventLog: StructuredEventLogEntry[]):
  | { start: TurnStateSnapshot; end: TurnStateSnapshot }
  | undefined {
  const first = eventLog.find((entry) => entry.before)?.before;
  const last = [...eventLog].reverse().find((entry) => entry.after)?.after;
  return first && last ? { start: first, end: last } : undefined;
}

/**
 * Pure, versioned Producer Score calculation. Ending is accepted for the
 * orchestration API but intentionally never participates in scoring.
 */
export function buildProducerResult(
  input: readonly StructuredEventLogEntry[],
  _ending?: Ending,
  characterRoster?: CharacterRoster,
): ProducerResult {
  const eventLog = sortEventLog(input);
  const collector = new EvidenceCollector();
  const followUps = refusalFollowUps(eventLog);
  const repeatedAfterNoIds = new Set(
    followUps.flatMap((followUp) => (followUp.repeated ? [followUp.repeated.id] : [])),
  );
  const repeatedLockIds = new Set<string>();

  scoreAgency(eventLog, collector, followUps);
  scoreWellbeing(eventLog, collector);
  // Pacing identifies repeated lock turns used by the care attribution rule.
  scorePacing(eventLog, collector, repeatedLockIds);
  const producerCausedConflicts = scoreCare(
    eventLog,
    collector,
    repeatedAfterNoIds,
    repeatedLockIds,
  );
  scoreStory(
    eventLog,
    collector,
    followUps,
    producerCausedConflicts,
    characterRoster,
  );

  const evidence = collector.all();
  const axes = buildAxes(evidence);
  const overallScore = axes.reduce((sum, axis) => sum + axis.score, 0);
  const highlights = selectHighlights(eventLog, 4, characterRoster);
  const coverage = calculateCoverage(eventLog);
  const warnings: string[] = [];
  if (coverage.ratio < 0.95) {
    warnings.push("データcoverageが95%未満のため、点数とランクは参考値です。");
  }
  if (
    coverage.ratio < 0.75 ||
    !eventLog.some((entry) => CHARACTER_IDS.every((id) => hasCompleteDecision(entry, id))) ||
    !eventLog.some((entry) => entry.before) ||
    !eventLog.some((entry) => entry.after)
  ) {
    warnings.push("構造化ログが不足しているため、総合ランクを断定できません。");
  }
  if (eventLog.length > EXPECTED_RUN_TURNS) {
    warnings.push(`期待turn数${EXPECTED_RUN_TURNS}件を超えるログがあります。`);
  }
  if (eventLog.some((entry) => entry.cooldownPhases === undefined)) {
    warnings.push("一部turnにcooldownスナップショットがなく、PC-10は該当turnで算出していません。");
  }

  const strengths = topEvidence(evidence, true);
  const negatives = topEvidence(evidence, false);
  const journey = statJourney(eventLog);
  return {
    overallScore,
    rank: rankFor(overallScore),
    producerStyle: styleFor(axes),
    scoringVersion: PRODUCER_SCORING_VERSION,
    axes,
    topStrengths: strengths,
    improvements: negatives.length > 0 ? negatives : [improvementHint(axes)],
    highlights,
    keyMemoryIds: uniqueIds(
      highlights.flatMap((highlight) => (highlight.memoryId ? [highlight.memoryId] : [])),
    ),
    turningPointEventLogIds: uniqueIds(
      highlights
        .filter((highlight) =>
          ["relationship_turn", "conflict_repaired", "respected_no", "self_initiated"].includes(
            highlight.kind,
          ),
        )
        .flatMap((highlight) => highlight.eventLogIds),
    ),
    ...(journey ? { statJourney: journey } : {}),
    coverage,
    warnings,
  };
}

export const calculateProducerResult = buildProducerResult;
