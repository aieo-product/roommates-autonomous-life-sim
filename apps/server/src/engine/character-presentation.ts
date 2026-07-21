import {
  EVENT_CONVERSATION_TEXT_MAX_LENGTH,
  EVENT_STORY_BEAT_CONTENT_MAX_LENGTH,
  EVENT_STORY_BEAT_LOCATION_MAX_LENGTH,
  characterDecisionSchema,
  navigatorResponseSchema,
  resolvedEventSchema,
  type CharacterDecision,
  type CharacterId,
  type CharacterRoster,
  type EventStoryBeat,
  type NavigatorResponse,
  type ResolvedEvent,
} from "@roommates/shared";

export const PUBLIC_PROSE_MAX_LENGTH = 2_000;
export const NAVIGATOR_MESSAGE_MAX_LENGTH = 240;
export const INITIATIVE_PUBLIC_INTENT_MAX_LENGTH = 240;

const LEGACY_PUBLIC_NAMES: Record<CharacterId, readonly RegExp[]> = {
  // Word boundaries intentionally preserve stable identifiers such as
  // `haru_room` / `aoi_room` while catching names next to Japanese text.
  haru: [/\bHaru\b/giu, /ハル/gu],
  aoi: [/\bAoi\b/giu, /アオイ/gu],
};

const placeholder = (index: number): string => `\uE000ROOMMATES_NAME_${index}\uE001`;

/** Clip by the same UTF-16 length semantics used by Zod string.max(). */
export function clipPublicText(value: string, maxLength: number): string {
  let clipped = value.slice(0, maxLength);
  const finalCodeUnit = clipped.charCodeAt(clipped.length - 1);
  if (finalCodeUnit >= 0xD800 && finalCodeUnit <= 0xDBFF) {
    clipped = clipped.slice(0, -1);
  }
  return clipped;
}

/**
 * Rewrites only legacy presentation names in public prose. Stable actor IDs
 * are handled structurally by callers and never passed through this helper.
 * Existing configured names are protected first, making repeated projection
 * idempotent even for names such as `Haru-kun` or `ハルカ`.
 */
export function normalizeCharacterNamesInText(
  value: string,
  roster: CharacterRoster,
  maxLength?: number,
): string {
  const protectedNames = [...new Set([
    roster.haru.displayName,
    roster.aoi.displayName,
  ])]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  let normalized = value;
  protectedNames.forEach((name, index) => {
    normalized = normalized.split(name).join(placeholder(index));
  });

  for (const characterId of ["haru", "aoi"] as const) {
    for (const legacyName of LEGACY_PUBLIC_NAMES[characterId]) {
      normalized = normalized.replace(
        legacyName,
        roster[characterId].displayName,
      );
    }
  }

  protectedNames.forEach((name, index) => {
    normalized = normalized.split(placeholder(index)).join(name);
  });
  return maxLength === undefined
    ? normalized
    : clipPublicText(normalized, maxLength);
}

export function normalizeDecisionCharacterNames(
  decision: CharacterDecision,
  roster: CharacterRoster,
): CharacterDecision {
  const normalize = (value: string, maxLength = PUBLIC_PROSE_MAX_LENGTH): string =>
    normalizeCharacterNamesInText(value, roster, maxLength);
  return characterDecisionSchema.parse({
    ...decision,
    action: normalize(decision.action),
    dialogue: normalize(decision.dialogue),
    publicReason: normalize(decision.publicReason),
    ...(decision.initiative
      ? {
          initiative: {
            ...decision.initiative,
            publicIntent: normalize(
              decision.initiative.publicIntent,
              INITIATIVE_PUBLIC_INTENT_MAX_LENGTH,
            ),
          },
        }
      : {}),
  });
}

export function normalizeNavigatorResponseCharacterNames(
  response: NavigatorResponse,
  roster: CharacterRoster,
): NavigatorResponse {
  return navigatorResponseSchema.parse({
    ...response,
    message: normalizeCharacterNamesInText(
      response.message,
      roster,
      NAVIGATOR_MESSAGE_MAX_LENGTH,
    ),
    eventTitle: normalizeCharacterNamesInText(
      response.eventTitle,
      roster,
      PUBLIC_PROSE_MAX_LENGTH,
    ),
  });
}

function normalizeStoryBeat(
  beat: EventStoryBeat,
  roster: CharacterRoster,
): EventStoryBeat {
  if (beat.kind === "move") {
    return {
      ...beat,
      location: normalizeCharacterNamesInText(
        beat.location,
        roster,
        EVENT_STORY_BEAT_LOCATION_MAX_LENGTH,
      ),
    };
  }
  if (beat.kind === "dialogue") {
    return {
      ...beat,
      text: normalizeCharacterNamesInText(
        beat.text,
        roster,
        EVENT_STORY_BEAT_CONTENT_MAX_LENGTH,
      ),
    };
  }
  return {
    ...beat,
    action: normalizeCharacterNamesInText(
      beat.action,
      roster,
      EVENT_STORY_BEAT_CONTENT_MAX_LENGTH,
    ),
  };
}

/** Attach server-authoritative event-time names and normalize public prose. */
export function normalizeResolvedEventCharacterNames(
  event: ResolvedEvent,
  roster: CharacterRoster,
): ResolvedEvent {
  const normalize = (value: string, maxLength = PUBLIC_PROSE_MAX_LENGTH): string =>
    normalizeCharacterNamesInText(value, roster, maxLength);
  return resolvedEventSchema.parse({
    ...event,
    characterRoster: structuredClone(roster),
    eventTitle: normalize(event.eventTitle),
    narration: normalize(event.narration),
    ...(event.navigatorMessage
      ? {
          navigatorMessage: normalize(
            event.navigatorMessage,
            NAVIGATOR_MESSAGE_MAX_LENGTH,
          ),
        }
      : {}),
    haruDialogue: normalize(event.haruDialogue),
    aoiDialogue: normalize(event.aoiDialogue),
    ...(event.conversation
      ? {
          conversation: event.conversation.map((line) => ({
            ...line,
            text: normalize(line.text, EVENT_CONVERSATION_TEXT_MAX_LENGTH),
          })),
        }
      : {}),
    ...(event.storyBeats
      ? {
          storyBeats: event.storyBeats.map((beat) =>
            normalizeStoryBeat(beat, roster)),
        }
      : {}),
    memory: {
      ...event.memory,
      title: normalize(event.memory.title),
      summary: normalize(event.memory.summary),
    },
    ...(event.scene
      ? {
          scene: Object.fromEntries(
            Object.entries(event.scene).map(([actor, location]) => [
              actor,
              location === undefined
                ? undefined
                : normalize(location, EVENT_STORY_BEAT_LOCATION_MAX_LENGTH),
            ]),
          ) as Partial<Record<CharacterId, string>>,
        }
      : {}),
    ...(event.conflictUpdate
      ? {
          conflictUpdate: {
            ...(event.conflictUpdate.add
              ? { add: event.conflictUpdate.add.map((value) => normalize(value)) }
              : {}),
            ...(event.conflictUpdate.resolve
              // `resolve` values are exact persisted conflict identifiers. A
              // presentation rewrite here would make them fail equality
              // checks against the stored unresolved conflict.
              ? { resolve: [...event.conflictUpdate.resolve] }
              : {}),
          },
        }
      : {}),
  });
}
