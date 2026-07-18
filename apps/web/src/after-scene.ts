import {
  characterAnchor,
  roomForLocation,
  type CharacterId,
  type Point,
} from "./room-layout.js";
import type { CharacterState, EventConversationTurn, GameEvent, GameState } from "./types.js";

export type SpriteDirection = "south" | "east" | "north" | "west";

export type ResidentRoute = {
  start: Point;
  end: Point;
  direction: SpriteDirection;
  hasTravel: boolean;
};

export type AfterScenePlan = {
  eventId: string;
  routes: Record<CharacterId, ResidentRoute>;
  conversation: EventConversationTurn[];
};

// When a resolved event stays in the same room, the room-level anchor alone
// would produce no visible travel. These one-tile isometric nudges place the
// residents at distinct interaction spots without leaving the room footprint.
const IN_ROOM_DESTINATION_OFFSETS: Record<CharacterId, Point> = {
  haru: { x: -18, y: 9 },
  aoi: { x: 18, y: 9 },
};

const SCENE_LOCATION_MARKERS = [
  "リビング", "ソファ", "living",
  "キッチン", "台所", "kitchen",
  "ダイニング", "食卓", "dining",
  "ベランダ", "バルコニー", "balcony",
  "洗面", "washroom", "風呂", "浴室", "bathroom",
  "玄関", "entry", "廊下", "hallway",
  "自室", "寝室", "haru", "ハル", "aoi", "アオイ",
];

const trimmedTurn = (turn: EventConversationTurn): EventConversationTurn | undefined => {
  const text = turn.text.trim();
  return text ? { speaker: turn.speaker, text } : undefined;
};

/**
 * Prefer the Director-authored exchange. Old saves only have one decision
 * line per resident, so keep those lines as a short, deterministic fallback.
 */
export const conversationForEvent = (event: GameEvent): EventConversationTurn[] => {
  const authored = event.conversation
    ?.map(trimmedTurn)
    .filter((turn): turn is EventConversationTurn => Boolean(turn));
  if (authored?.length) return authored;

  const fallback: EventConversationTurn[] = [];
  if (event.haruDialogue?.trim()) {
    fallback.push({ speaker: "haru", text: event.haruDialogue.trim() });
  }
  if (event.aoiDialogue?.trim()) {
    fallback.push({ speaker: "aoi", text: event.aoiDialogue.trim() });
  }
  return fallback;
};

/** Resolve a logical sprite row from the isometric screen-space delta. */
export const directionForTravel = (start: Point, end: Point): SpriteDirection => {
  const screenX = end.x - start.x;
  const screenY = end.y - start.y;
  if (Math.hypot(screenX, screenY) < 1) return "south";

  // Inverse of room-layout.ts's 2:1 isometric projection.
  const worldX = screenX / 50 + screenY / 25;
  const worldY = screenY / 25 - screenX / 50;
  if (Math.abs(worldX) >= Math.abs(worldY)) return worldX >= 0 ? "east" : "west";
  return worldY >= 0 ? "south" : "north";
};

const locationFor = (
  event: GameEvent,
  person: CharacterId,
  moment: "before" | "after",
  fallback: CharacterState,
): string => {
  const direct = moment === "before" ? event.statesBefore?.[person] : event.statesAfter?.[person];
  const snapshot = event[moment]?.characters[person];
  // App Server Director scenes may be descriptive (for example
  // "ダイニングテーブルで、向かい合う"). roomForLocation intentionally
  // uses partial matching, so retain that text as the resolved destination.
  const rawSceneLocation = moment === "after" ? event.scene?.[person]?.trim() : undefined;
  const sceneLocation = rawSceneLocation && SCENE_LOCATION_MARKERS.some((marker) =>
    rawSceneLocation.toLowerCase().includes(marker));
  return (sceneLocation ? rawSceneLocation : undefined)
    || direct?.location
    || snapshot?.location
    || fallback.location;
};

export const createAfterScenePlan = (
  event: GameEvent,
  game: GameState,
  turnStart?: Partial<Record<CharacterId, CharacterState>>,
): AfterScenePlan => {
  const routeFor = (person: CharacterId): ResidentRoute => {
    const current = game[person];
    const beforeFallback = turnStart?.[person] ?? current;
    const startLocation = locationFor(event, person, "before", beforeFallback);
    const endLocation = locationFor(event, person, "after", current);
    const start = characterAnchor(person, {
      ...current,
      location: startLocation,
    });
    const resolvedEnd = characterAnchor(person, {
      ...current,
      location: endLocation,
    });
    const isSameRoom = roomForLocation(startLocation, person) === roomForLocation(endLocation, person);
    const offset = IN_ROOM_DESTINATION_OFFSETS[person];
    const end = isSameRoom && Math.hypot(resolvedEnd.x - start.x, resolvedEnd.y - start.y) < 1
      ? { x: resolvedEnd.x + offset.x, y: resolvedEnd.y + offset.y }
      : resolvedEnd;
    return {
      start,
      end,
      direction: directionForTravel(start, end),
      hasTravel: Math.hypot(end.x - start.x, end.y - start.y) >= 1,
    };
  };

  return {
    eventId: event.id,
    routes: {
      haru: routeFor("haru"),
      aoi: routeFor("aoi"),
    },
    conversation: conversationForEvent(event),
  };
};
