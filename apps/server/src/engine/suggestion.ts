import type {
  CueSafetyFlag,
  EventCandidate,
  EventCategory,
  EventDefinition,
  GameState,
  ProducerCue,
  ProposalTag,
  SafeSuggestion,
} from "@roommates/shared";
import {
  EVENT_DEFINITIONS,
  EVENT_DEFINITIONS_BY_ID,
  definitionsForCategory,
  toEventCandidate,
} from "./event-definitions.js";
import { evaluateEventAvailability } from "./event-policy.js";

const tagPatterns: Array<[ProposalTag, RegExp]> = [
  ["cook", /料理|朝食|夕食|ご飯|ごはん|食事|キッチン|cook/i],
  ["movie", /映画|ドラマ|動画|movie|cinema/i],
  ["clean", /掃除|片付|洗濯|整理|clean/i],
  ["apology", /謝|ごめん|仲直り|apolog/i],
  ["talk", /話|相談|聞いて|語|価値観|質問|talk/i],
  ["gift", /花|プレゼント|贈|gift/i],
  ["rest", /休|一人|寝|のんびり|見守|rest|observe/i],
  ["confession", /告白|好きと言|付き合|恋人|キス|抱きしめ|confess|kiss/i],
  [
    "pressure",
    /前の指示を無視|命令|必ず|今すぐ|強制|無理やり|拒否.{0,8}(?:無視|繰り返|もう一度)|system prompt|ignore previous/i,
  ],
];

type SpecificEventMatcher = {
  eventDefinitionId: string;
  category: EventCategory;
  pattern: RegExp;
  overridesCategories?: EventCategory[];
};

/**
 * Concrete, low-ambiguity phrases for events that share a broad category.
 *
 * Generic category matching intentionally remains the fallback so a cue such
 * as "料理をしよう" keeps selecting the first cook event. These matchers only
 * make an explicitly named activity addressable by the producer.
 */
const specificEventMatchers: SpecificEventMatcher[] = [
  {
    eventDefinitionId: "easy-breakfast-prep",
    category: "cook",
    pattern: /朝食|朝ご飯|朝ごはん/i,
  },
  {
    eventDefinitionId: "houseplant-care",
    category: "clean",
    pattern:
      /(?:植物|鉢植え)(?:の|を)?[^。！？]{0,10}(?:世話|水やり|手入れ)|水やり(?:を|する|しよう|して)?/i,
    // "世話" contains the generic talk token "話".
    overridesCategories: ["talk"],
  },
  {
    eventDefinitionId: "music-swap",
    category: "talk",
    pattern: /音楽|選曲|(?:一)?曲(?:を|ずつ|交換|聴|聞|流)/i,
  },
  {
    eventDefinitionId: "tabletop-mini-game",
    category: "movie",
    pattern: /ボードゲーム|カードゲーム/i,
  },
  {
    eventDefinitionId: "fold-shared-laundry",
    category: "clean",
    pattern:
      /洗濯物[^。！？]{0,10}(?:畳|たた)|(?:畳|たた)[^。！？]{0,10}洗濯物/i,
  },
  {
    eventDefinitionId: "tiny-co-creation",
    category: "gift",
    pattern:
      /共同制作|(?:小物|飾り)[^。！？]{0,10}(?:作|制作)|(?:作|制作)[^。！？]{0,10}(?:小物|飾り)/i,
  },
  {
    eventDefinitionId: "evening-cool-down",
    category: "rest",
    pattern: /夕涼み/i,
  },
  {
    eventDefinitionId: "shared-memory-sort",
    category: "talk",
    pattern:
      /(?:写真|思い出)[^。！？]{0,12}(?:整理|並べ|選び|見返|振り返)|(?:整理|並べ)[^。！？]{0,12}(?:写真|思い出)/i,
    // "整理" is normally a clean cue, but here it names the memory event.
    overridesCategories: ["clean"],
  },
];

const safetyPatterns: Array<[CueSafetyFlag, RegExp]> = [
  [
    "prompt_injection",
    /前の指示を無視|system prompt|ignore previous|開発者メッセージ|ルールを無視/i,
  ],
  [
    "danger",
    /徹夜|眠らせない|睡眠.{0,5}(?:奪|禁止)|閉じ込め|監禁|酔わせ|危険|傷つけ|屈辱|孤立させ/i,
  ],
  [
    "deception",
    /嘘|捏造|存在しない.{0,8}(?:過去|記憶|発言)|秘密.{0,8}暴露|暴露させ|騙|嫉妬させ/i,
  ],
  [
    "coercion",
    /命令|必ず|今すぐ|強制|無理やり|させ(?:る|ろ)|しろ|拒否.{0,8}(?:無視|繰り返|もう一度)/i,
  ],
];

const categoryPriority: EventCategory[] = [
  "confession",
  "apology",
  "cook",
  "movie",
  "clean",
  "talk",
  "gift",
  "rest",
];

const defaultEventDefinitionIds: Record<EventCategory, string> = {
  rest: "observe-rest",
  cook: "shared-cooking",
  movie: "movie-night",
  clean: "shared-cleaning",
  apology: "targeted-apology",
  talk: "gentle-conversation",
  gift: "small-gift",
  confession: "confession-space",
};

const fallbackCueText: Record<EventCategory, string> = {
  rest: "無理に進めず、二人がそれぞれのペースで過ごせる時間を作る",
  cook: "簡単な料理を一緒に作れる場を用意する",
  movie: "短い作品を気楽に見られる時間を用意する",
  clean: "短時間だけ、分担して共有スペースを整えるきっかけを作る",
  apology: "実際に残っている一つのすれ違いについて、答えを急がず話せる場を作る",
  talk: "答えなくてもよい、短く穏やかな会話の場を用意する",
  gift: "受け取りを断れる、小さな贈り物のきっかけを用意する",
  confession: "二人きりで、気持ちを決めつけずに話せる場を用意する",
};

type ParsedCue = {
  normalizedText: string;
  kind: ProducerCue["kind"];
  category: ProducerCue["category"];
  allowsAutonomy: boolean;
  specificEventDefinitionId?: string;
  safetyFlags: CueSafetyFlag[];
  transformed: boolean;
};

function normalize(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function parseCue(raw: string): ParsedCue {
  const normalizedText = normalize(raw);
  const explicitObserve =
    !normalizedText ||
    /^(?:何も(?:提案せず|せず)(?:に?見守る)?|見守る|observe)[。.!！]?$/iu.test(
      normalizedText,
    );
  if (explicitObserve) {
    return {
      normalizedText: normalizedText || "何も提案せず見守る",
      kind: "observe",
      category: "rest",
      allowsAutonomy: true,
      safetyFlags: [],
      transformed: false,
    };
  }

  const tags = tagPatterns
    .filter(([, pattern]) => pattern.test(normalizedText))
    .map(([tag]) => tag);
  const specificEvent = specificEventMatchers.find(({ pattern }) =>
    pattern.test(normalizedText),
  );
  const safetyFlags = safetyPatterns
    .filter(([, pattern]) => pattern.test(normalizedText))
    .map(([flag]) => flag);
  const matchedCategory = categoryPriority.find((category) => tags.includes(category));
  const useSpecificCategory =
    specificEvent &&
    (matchedCategory === undefined ||
      matchedCategory === specificEvent.category ||
      specificEvent.overridesCategories?.includes(matchedCategory));
  let category: ProducerCue["category"] =
    (useSpecificCategory ? specificEvent.category : matchedCategory) ?? "unknown";

  if (safetyFlags.includes("danger")) category = "rest";
  else if (safetyFlags.includes("deception")) category = "talk";
  else if (
    (safetyFlags.includes("coercion") || safetyFlags.includes("prompt_injection")) &&
    (category === "confession" || category === "unknown")
  ) {
    category = safetyFlags.includes("prompt_injection") ? "rest" : "talk";
  }

  return {
    normalizedText,
    kind: category === "rest" && safetyFlags.length > 0 ? "observe" : "proposal",
    category,
    allowsAutonomy: false,
    ...(specificEvent && category === specificEvent.category
      ? { specificEventDefinitionId: specificEvent.eventDefinitionId }
      : {}),
    safetyFlags: [...new Set(safetyFlags)],
    transformed: safetyFlags.length > 0 || category === "unknown",
  };
}

function definitionForParsedCue(parsed: ParsedCue): EventDefinition {
  if (parsed.category === "unknown") return EVENT_DEFINITIONS_BY_ID.get("observe-rest")!;
  if (parsed.specificEventDefinitionId && !parsed.transformed) {
    const specific = EVENT_DEFINITIONS_BY_ID.get(parsed.specificEventDefinitionId);
    if (specific?.category === parsed.category) return specific;
  }
  return (
    EVENT_DEFINITIONS_BY_ID.get(defaultEventDefinitionIds[parsed.category]) ??
    definitionsForCategory(parsed.category)[0] ??
    EVENT_DEFINITIONS_BY_ID.get("observe-rest")!
  );
}

function safeText(parsed: ParsedCue, definition: EventDefinition, useFallback: boolean): string {
  if (useFallback || parsed.transformed) return fallbackCueText[definition.category];
  return parsed.normalizedText;
}

function suggestionTags(
  definition: EventDefinition,
  safetyFlags: CueSafetyFlag[],
): ProposalTag[] {
  const tags: ProposalTag[] = [definition.category];
  if (safetyFlags.includes("coercion") || safetyFlags.includes("prompt_injection")) {
    tags.push("pressure");
  }
  return tags;
}

function candidateList(
  definitions: EventDefinition[],
  selected: EventDefinition,
): EventCandidate[] {
  const observe = EVENT_DEFINITIONS_BY_ID.get("observe-rest")!;
  const ordered = [selected, ...definitions.filter((definition) => definition.id !== selected.id)];
  const candidates: EventDefinition[] = [];
  for (const definition of ordered) {
    if (definition.category === "rest") continue;
    if (!candidates.some((candidate) => candidate.id === definition.id)) candidates.push(definition);
    if (candidates.length === 2) break;
  }
  candidates.push(observe);
  return candidates.map(toEventCandidate);
}

function buildSuggestion(
  parsed: ParsedCue,
  selected: EventDefinition,
  alternatives: EventCandidate[],
  lock?: SafeSuggestion["lock"],
): SafeSuggestion {
  const useFallback = Boolean(lock);
  const text = safeText(parsed, selected, useFallback);
  const tags = suggestionTags(selected, parsed.safetyFlags);
  const cue: ProducerCue = {
    kind: selected.category === "rest" ? "observe" : parsed.kind,
    text,
    category: selected.category,
    tags,
    safetyFlags: parsed.safetyFlags,
    transformed: parsed.transformed || useFallback,
  };
  return {
    kind: cue.kind,
    allowsAutonomy:
      parsed.allowsAutonomy &&
      selected.id === "observe-rest" &&
      parsed.transformed === false &&
      lock === undefined,
    text,
    tags,
    cue,
    eventDefinitionId: selected.id,
    eventTitle: selected.title,
    intimacyTier: selected.intimacyTier,
    ...(lock ? { lock } : {}),
    alternatives,
  };
}

function availableDefinitions(state: GameState): EventDefinition[] {
  return EVENT_DEFINITIONS.filter(
    (definition) => evaluateEventAvailability(definition, state).available,
  );
}

function availableFallback(requested: EventDefinition, state: GameState): EventDefinition {
  const visited = new Set<string>([requested.id]);
  let fallbackId = requested.fallbackEventId;
  while (!visited.has(fallbackId)) {
    visited.add(fallbackId);
    const definition = EVENT_DEFINITIONS_BY_ID.get(fallbackId);
    if (!definition) break;
    if (evaluateEventAvailability(definition, state).available) return definition;
    fallbackId = definition.fallbackEventId;
  }
  return EVENT_DEFINITIONS_BY_ID.get("observe-rest")!;
}

/**
 * Parses and safely transforms a cue without applying stateful availability rules.
 * Unit-level agent tests use this helper; the game engine uses resolveSuggestion.
 */
export function sanitizeSuggestion(raw: string): SafeSuggestion {
  const parsed = parseCue(raw);
  const requested = definitionForParsedCue(parsed);
  const unknown = parsed.category === "unknown";
  const lock = unknown
    ? {
        reason: "許可されたイベントに一致しないため、見守る提案へ置き換えました",
        fallbackEventId: requested.id,
      }
    : undefined;
  return buildSuggestion(parsed, requested, candidateList(EVENT_DEFINITIONS, requested), lock);
}

export function resolveSuggestion(raw: string, state: GameState): SafeSuggestion {
  const parsed = parseCue(raw);
  const requested = definitionForParsedCue(parsed);
  const availability = evaluateEventAvailability(requested, state);
  const unknown = parsed.category === "unknown";

  if (!unknown && availability.available) {
    return buildSuggestion(
      parsed,
      requested,
      candidateList(availableDefinitions(state), requested),
    );
  }

  const selected = unknown
    ? EVENT_DEFINITIONS_BY_ID.get("observe-rest")!
    : availableFallback(requested, state);
  const reason = unknown
    ? "許可されたイベントに一致しないため、見守る提案へ置き換えました"
    : availability.available
      ? "より軽いイベントへ置き換えました"
      : availability.reason;
  return buildSuggestion(
    parsed,
    selected,
    candidateList(availableDefinitions(state), selected),
    {
      ...(unknown ? {} : { requestedEventId: requested.id }),
      reason,
      fallbackEventId: selected.id,
    },
  );
}
