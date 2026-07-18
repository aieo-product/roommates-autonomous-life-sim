import type {
  CharacterId,
  EventCategory,
  Phase,
  PublicCharacterDecision,
  TurnStateSnapshot,
} from "@roommates/shared";
import type { StructuredEventLogEntry } from "./types.js";

const PHASE_INDEX: Record<Phase, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
  night: 3,
};

export const CHARACTER_IDS = ["haru", "aoi"] as const satisfies readonly CharacterId[];

export function turnOrdinal(entry: Pick<StructuredEventLogEntry, "day" | "phase">): number {
  return (entry.day - 1) * 4 + PHASE_INDEX[entry.phase];
}

export function sortEventLog(
  eventLog: readonly StructuredEventLogEntry[],
): StructuredEventLogEntry[] {
  return [...eventLog].sort(
    (left, right) =>
      turnOrdinal(left) - turnOrdinal(right) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export function decisionFor(
  entry: StructuredEventLogEntry,
  characterId: CharacterId,
): PublicCharacterDecision | undefined {
  const structured = entry.decisions?.[characterId];
  if (structured) return structured;

  const prefix = characterId === "haru" ? "haru" : "aoi";
  const decision = entry[`${prefix}Decision`];
  const action = entry[`${prefix}Action`];
  const dialogue = entry[`${prefix}Dialogue`];
  const publicReason = entry[`${prefix}PublicReason`];
  if (!decision || action === undefined || dialogue === undefined || publicReason === undefined) {
    return undefined;
  }
  return { decision, action, dialogue, publicReason };
}

export function eventCategory(entry: StructuredEventLogEntry): EventCategory | undefined {
  // This is the category of the event that actually resolved. Do not substitute
  // the requested cue category when a migrated log lacks this field.
  return entry.eventCategory;
}

export function requestedCategory(entry: StructuredEventLogEntry): EventCategory | undefined {
  if (entry.cue?.category && entry.cue.category !== "unknown") return entry.cue.category;
  return entry.eventCategory;
}

export function eventTier(entry: StructuredEventLogEntry): 0 | 1 | 2 | 3 | undefined {
  return entry.intimacyTier;
}

export function isHighIntensity(entry: StructuredEventLogEntry): boolean {
  const tier = eventTier(entry);
  return tier !== undefined && tier >= 2;
}

export function isLowIntensity(entry: StructuredEventLogEntry): boolean {
  const tier = eventTier(entry);
  return tier !== undefined && tier <= 1;
}

export function isObserve(entry: StructuredEventLogEntry): boolean {
  return (
    entry.inputMethod === "observe" ||
    entry.cue?.kind === "observe" ||
    entry.cueOutcome === "observed"
  );
}

export function isProducerIntervention(entry: StructuredEventLogEntry): boolean {
  return entry.inputMethod !== "fast_forward";
}

export function isRecoveryAction(
  entry: StructuredEventLogEntry,
  previous?: StructuredEventLogEntry,
): boolean {
  if (isObserve(entry) || eventCategory(entry) === "rest") return true;
  const currentTier = eventTier(entry);
  const previousTier = previous && eventTier(previous);
  return currentTier !== undefined && previousTier !== undefined && currentTier < previousTier;
}

export function hasRefusal(entry: StructuredEventLogEntry): boolean {
  return CHARACTER_IDS.some((id) => {
    const decision = decisionFor(entry, id)?.decision;
    return decision === "DECLINE" || decision === "IGNORE";
  });
}

export function hasInitiative(entry: StructuredEventLogEntry): boolean {
  return CHARACTER_IDS.some((id) => decisionFor(entry, id)?.decision === "INITIATE");
}

export function hasModify(entry: StructuredEventLogEntry): boolean {
  return CHARACTER_IDS.some((id) => decisionFor(entry, id)?.decision === "MODIFY");
}

export function isConditionStrained(snapshot: TurnStateSnapshot | undefined): boolean {
  if (!snapshot) return false;
  return CHARACTER_IDS.some((id) => {
    const state = snapshot.characters[id];
    return state.energy < 30 || state.stress > 70;
  });
}

export function strainedCharacters(snapshot: TurnStateSnapshot | undefined): CharacterId[] {
  if (!snapshot) return [];
  return CHARACTER_IDS.filter((id) => {
    const state = snapshot.characters[id];
    return state.energy < 30 || state.stress > 70;
  });
}

export function relationshipChanged(entry: StructuredEventLogEntry): boolean {
  const before = entry.before?.shared.relationshipLabel ?? entry.relationshipBefore;
  const after = entry.after?.shared.relationshipLabel ?? entry.relationshipAfter;
  return before !== after;
}

export function relationshipBefore(entry: StructuredEventLogEntry) {
  return entry.before?.shared.relationshipLabel ?? entry.relationshipBefore;
}

export function relationshipAfter(entry: StructuredEventLogEntry) {
  return entry.after?.shared.relationshipLabel ?? entry.relationshipAfter;
}

export function appliedEffectMagnitude(entry: StructuredEventLogEntry): number {
  if (!entry.appliedEffects) return 0;
  return CHARACTER_IDS.reduce((total, id) => {
    const effects = entry.appliedEffects?.[id] ?? {};
    return total + Object.values(effects).reduce((sum, value) => sum + Math.abs(value ?? 0), 0);
  }, 0);
}

export function sameIntervention(
  current: StructuredEventLogEntry,
  previous: StructuredEventLogEntry,
): boolean {
  const currentId = current.requestedEventId ?? current.eventDefinitionId;
  const previousId = previous.requestedEventId ?? previous.eventDefinitionId;
  if (currentId && previousId && currentId === previousId) return true;

  const currentCategory = requestedCategory(current);
  const previousCategory = requestedCategory(previous);
  const currentTier = eventTier(current);
  const previousTier = eventTier(previous);
  return (
    currentCategory !== undefined &&
    currentCategory === previousCategory &&
    currentTier !== undefined &&
    previousTier !== undefined &&
    currentTier >= previousTier
  );
}

export function eligibilitySignature(entry: StructuredEventLogEntry): string | undefined {
  if (!entry.before) return undefined;
  const { characters, shared } = entry.before;
  return JSON.stringify({
    relationship: shared.relationshipLabel,
    conflicts: [...shared.unresolvedConflicts].sort(),
    haru: {
      energy: characters.haru.energy,
      stress: characters.haru.stress,
      affection: characters.haru.affection,
      trust: characters.haru.trust,
      romanticAwareness: characters.haru.romanticAwareness,
    },
    aoi: {
      energy: characters.aoi.energy,
      stress: characters.aoi.stress,
      affection: characters.aoi.affection,
      trust: characters.aoi.trust,
      romanticAwareness: characters.aoi.romanticAwareness,
    },
  });
}

export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
