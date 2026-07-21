import type {
  CharacterId,
  CharacterRoster,
  Ending,
  MutableStatKey,
  Phase,
  RelationshipLabel,
  ResultHighlight,
  ResultNarrative,
} from "@roommates/shared";
import { characterDisplayName } from "@roommates/shared";
import { selectHighlights } from "./highlights.js";
import {
  CHARACTER_IDS,
  appliedEffectMagnitude,
  decisionFor,
  relationshipAfter,
  relationshipBefore,
  relationshipChanged,
  sortEventLog,
  turnOrdinal,
} from "./log-utils.js";
import type { StructuredEventLogEntry } from "./types.js";

export const RESULT_NARRATIVE_VERSION = "result-narrative-v1" as const;

const PHASE_LABELS: Record<Phase, string> = {
  morning: "朝",
  afternoon: "昼",
  evening: "夕方",
  night: "夜",
};

const RELATIONSHIP_LABELS: Record<RelationshipLabel, string> = {
  strangers: "まだ知らない二人",
  roommates: "ルームメイト",
  friends: "友人",
  close_friends: "親しい友人",
  romantic_tension: "恋の予感がある関係",
  couple: "恋人",
  broken: "距離を置いた関係",
};

const STAT_LABELS: Record<MutableStatKey, string> = {
  energy: "energy",
  stress: "stress",
  affection: "affection",
  trust: "trust",
  romanticAwareness: "romantic awareness",
};

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[。！？!?]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function decisionSentence(
  entry: StructuredEventLogEntry,
  characterId: CharacterId,
  characterRoster?: CharacterRoster,
): string | undefined {
  const decision = decisionFor(entry, characterId);
  if (!decision) return undefined;
  const action = decision.action.trim();
  const reason = decision.publicReason.trim();
  return `${characterDisplayName(characterRoster, characterId)}は${decision.decision}を選び${
    action ? `、${action}` : ""
  }${reason ? `。理由は${reason}` : ""}`;
}

function effectSentence(
  entry: StructuredEventLogEntry,
  characterRoster?: CharacterRoster,
): string | undefined {
  if (!entry.appliedEffects) return undefined;
  const characterParts = CHARACTER_IDS.flatMap((characterId) => {
    const effects = entry.appliedEffects?.[characterId];
    if (!effects) return [];
    const changes = (Object.entries(effects) as Array<[MutableStatKey, number | undefined]>)
      .filter(([, value]) => value !== undefined && value !== 0)
      .map(([key, value]) => `${STAT_LABELS[key]} ${value! > 0 ? "+" : ""}${value}`);
    return changes.length > 0
      ? [`${characterDisplayName(characterRoster, characterId)}は${changes.join("、")}`]
      : [];
  });
  return characterParts.length > 0 ? `実際の変化は、${characterParts.join("。")}` : undefined;
}

function stateAndMemorySentences(
  entry: StructuredEventLogEntry,
  characterRoster?: CharacterRoster,
): string[] {
  const parts: string[] = [];
  if (relationshipChanged(entry)) {
    parts.push(
      `関係は「${RELATIONSHIP_LABELS[relationshipBefore(entry)]}」から「${
        RELATIONSHIP_LABELS[relationshipAfter(entry)]
      }」へ変わった`,
    );
  }
  const effect = effectSentence(entry, characterRoster);
  if (effect) parts.push(effect);
  if (entry.memory) {
    parts.push(`「${entry.memory.title}」が共有記憶として残った。${entry.memory.summary}`);
  }
  if ((entry.conflictUpdate?.add.length ?? 0) > 0) {
    parts.push(`${entry.conflictUpdate?.add.length ?? 0}件のすれ違いが残った`);
  }
  if ((entry.conflictUpdate?.resolve.length ?? 0) > 0) {
    parts.push(`${entry.conflictUpdate?.resolve.length ?? 0}件のすれ違いが解消された`);
  }
  return parts;
}

function describeEntry(
  entry: StructuredEventLogEntry,
  characterRoster?: CharacterRoster,
): string {
  const decisions = CHARACTER_IDS.map((id) =>
    decisionSentence(entry, id, characterRoster)
  ).filter(
    (value): value is string => Boolean(value),
  );
  const facts = stateAndMemorySentences(entry, characterRoster);
  return [
    `${PHASE_LABELS[entry.phase]}の「${entry.eventTitle}」。`,
    sentence(entry.narration),
    ...decisions.map(sentence),
    ...facts.map(sentence),
  ].join("");
}

function featuredScore(entry: StructuredEventLogEntry): number {
  return (
    Number(relationshipChanged(entry)) * 30 +
    (entry.conflictUpdate?.resolve.length ?? 0) * 15 +
    (entry.memory?.importance ?? 0) * 2 +
    Math.abs(entry.memory?.emotionalImpact ?? 0) +
    Number(entry.resolutionBranch === "self_initiated") * 8 +
    appliedEffectMagnitude(entry) / 10
  );
}

function chooseFeatured(
  entries: StructuredEventLogEntry[],
  highlights: readonly ResultHighlight[],
): StructuredEventLogEntry | undefined {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  for (const highlight of highlights) {
    for (const eventLogId of [...highlight.eventLogIds].reverse()) {
      const highlighted = entryById.get(eventLogId);
      if (highlighted) return highlighted;
    }
  }
  return [...entries].sort(
    (left, right) =>
      featuredScore(right) - featuredScore(left) ||
      turnOrdinal(left) - turnOrdinal(right) ||
      left.id.localeCompare(right.id),
  )[0];
}

function dayTitle(day: number, featured: StructuredEventLogEntry | undefined): string {
  if (!featured) return `Day ${day} — 記録のない一日`;
  const subject = featured.memory?.title ?? featured.eventTitle;
  return `Day ${day} — ${subject}`;
}

function buildDaySection(
  day: number,
  entries: StructuredEventLogEntry[],
  highlights: readonly ResultHighlight[],
  characterRoster?: CharacterRoster,
): ResultNarrative["daySections"][number] {
  const featured = chooseFeatured(entries, highlights);
  if (!featured) {
    return {
      day,
      title: dayTitle(day, undefined),
      paragraphs: [
        {
          text: "この日は構造化イベントログが残っていないため、出来事を推測せず空白として記録する。",
          sourceEventLogIds: [],
        },
      ],
    };
  }

  const remaining = entries.filter((entry) => entry.id !== featured.id);
  const paragraphs: ResultNarrative["daySections"][number]["paragraphs"] = [
    {
      text: describeEntry(featured, characterRoster),
      sourceEventLogIds: [featured.id],
    },
  ];
  if (remaining.length > 0) {
    paragraphs.push({
      text: `この日のほかの場面。${remaining
        .map((entry) => describeEntry(entry, characterRoster))
        .join("")}`,
      sourceEventLogIds: remaining.map((entry) => entry.id),
    });
  }

  return {
    day,
    title: dayTitle(day, featured),
    paragraphs,
    featuredEventLogId: featured.id,
  };
}

/**
 * Composes a stable seven-chapter article from confirmed public facts only.
 * It never reads internal summaries, expected effects, or raw Producer input.
 */
export function buildResultNarrative(
  input: readonly StructuredEventLogEntry[],
  ending: Ending,
  providedHighlights?: readonly ResultHighlight[],
  characterRoster?: CharacterRoster,
): ResultNarrative {
  const eventLog = sortEventLog(input);
  const highlights = providedHighlights ?? selectHighlights(eventLog, 4, characterRoster);
  const first = eventLog[0];
  const last = eventLog[eventLog.length - 1];
  const leadSources = [first?.id, ...highlights.flatMap((item) => item.eventLogIds)]
    .filter((id): id is string => Boolean(id))
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .slice(0, 4);

  const daySections = Array.from({ length: 7 }, (_, index) => {
    const day = index + 1;
    const entries = eventLog.filter((entry) => entry.day === day);
    const dayIds = new Set(entries.map((entry) => entry.id));
    const dayHighlights = highlights.filter((highlight) =>
      highlight.eventLogIds.some((id) => dayIds.has(id)),
    );
    return buildDaySection(day, entries, dayHighlights, characterRoster);
  });

  const firstRelationship = first ? RELATIONSHIP_LABELS[relationshipBefore(first)] : undefined;
  const lastRelationship = last ? RELATIONSHIP_LABELS[relationshipAfter(last)] : undefined;
  const leadText =
    firstRelationship && lastRelationship
      ? `${firstRelationship}として始まった二人は、${eventLog.length}件の記録を自分たちの選択で進み、${lastRelationship}としてDay ${last?.day ?? 7}を迎えた。ここでは、記録された出来事をDay 1から順にたどる。`
      : "記録された出来事だけを根拠に、二人の7日間をDay 1から順にたどる。";

  return {
    headline: `「${ending.title}」までの7日間`,
    lead: [{ text: leadText, sourceEventLogIds: leadSources }],
    daySections,
    closing: [
      {
        text: sentence(ending.narration),
        sourceEventLogIds: last ? [last.id] : [],
      },
    ],
    narrativeVersion: RESULT_NARRATIVE_VERSION,
  };
}
