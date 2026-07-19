import {
  characterAnchor,
  type CharacterId,
  type Point,
} from "./room-layout.js";
import type {
  CharacterState,
  EventConversationTurn,
  EventStoryBeat,
  GameEvent,
  GameState,
} from "./types.js";

export type SpriteDirection = "south" | "east" | "north" | "west";

export type ResidentRoute = {
  start: Point;
  end: Point;
  direction: SpriteDirection;
  hasTravel: boolean;
};

type BeatCommon = {
  points: Record<CharacterId, Point>;
  directions: Record<CharacterId, SpriteDirection>;
  focusLocation?: string;
};

export type AfterSceneBeat = BeatCommon & (
  | {
      kind: "move";
      actor: CharacterId | "both";
      location: string;
      routes: Record<CharacterId, ResidentRoute>;
    }
  | {
      kind: "dialogue";
      actor: CharacterId;
      text: string;
    }
  | {
      kind: "action";
      actor: CharacterId | "both";
      action: string;
    }
);

export type AfterScenePlan = {
  eventId: string;
  initialPoints: Record<CharacterId, Point>;
  finalPoints: Record<CharacterId, Point>;
  finalDirections: Record<CharacterId, SpriteDirection>;
  beats: AfterSceneBeat[];
  /** Overall routes and conversation retained for legacy callers/tests. */
  routes: Record<CharacterId, ResidentRoute>;
  conversation: EventConversationTurn[];
};

const PEOPLE: CharacterId[] = ["haru", "aoi"];

const actorsFor = (actor: CharacterId | "both"): CharacterId[] =>
  actor === "both" ? PEOPLE : [actor];

const copyPoints = (value: Record<CharacterId, Point>): Record<CharacterId, Point> => ({
  haru: { ...value.haru },
  aoi: { ...value.aoi },
});

const copyDirections = (
  value: Record<CharacterId, SpriteDirection>,
): Record<CharacterId, SpriteDirection> => ({ ...value });

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

/** A short isometric step used to turn around furniture between long legs. */
const detourPointFor = (start: Point, previous: SpriteDirection): Point => {
  const turn: Record<SpriteDirection, Point> = {
    east: { x: 26, y: -13 },
    north: { x: -26, y: -13 },
    west: { x: -26, y: 13 },
    south: { x: 26, y: 13 },
  };
  const offset = turn[previous];
  return { x: start.x + offset.x, y: start.y + offset.y };
};

const locationFor = (
  event: GameEvent,
  person: CharacterId,
  moment: "before" | "after",
  fallback: CharacterState,
): string => {
  const direct = moment === "before" ? event.statesBefore?.[person] : event.statesAfter?.[person];
  const snapshot = event[moment]?.characters[person];
  const rawSceneLocation = moment === "after" ? event.scene?.[person]?.trim() : undefined;
  const sceneLocation = rawSceneLocation && SCENE_LOCATION_MARKERS.some((marker) =>
    rawSceneLocation.toLowerCase().includes(marker));
  return (sceneLocation ? rawSceneLocation : undefined)
    || direct?.location
    || snapshot?.location
    || fallback.location;
};

/**
 * Room anchors intentionally collapse free-form descriptions to a room. These
 * stable offsets preserve meaningful in-room waypoints such as sofa -> table.
 */
const spotOffsetFor = (location: string, beatIndex: number): Point => {
  const value = location.toLowerCase();
  if (value.includes("ソファ") || value.includes("sofa")) return { x: -34, y: 8 };
  if (value.includes("ローテーブル") || value.includes("coffee table")) return { x: 30, y: 10 };
  if (value.includes("テーブル") || value.includes("食卓") || value.includes("table")) return { x: 22, y: -8 };
  if (value.includes("キッチン台") || value.includes("調理台") || value.includes("counter")) return { x: -28, y: -9 };
  if (value.includes("窓") || value.includes("window")) return { x: 28, y: -12 };
  if (value.includes("入口") || value.includes("ドア") || value.includes("door")) return { x: -25, y: -12 };

  // Free-form descriptions still get deterministic, bounded spots. Include
  // the beat number so two distinct movements within one room remain visible.
  let hash = beatIndex + 17;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const offsets = [
    { x: -20, y: -8 },
    { x: 20, y: -8 },
    { x: -24, y: 9 },
    { x: 24, y: 9 },
    { x: 0, y: 13 },
  ];
  return offsets[Math.abs(hash) % offsets.length] ?? { x: 0, y: 0 };
};

const pointForLocation = (
  person: CharacterId,
  location: string,
  state: CharacterState,
  beatIndex: number,
): Point => {
  const anchor = characterAnchor(person, { ...state, location });
  const offset = spotOffsetFor(location, beatIndex);
  return { x: anchor.x + offset.x, y: anchor.y + offset.y };
};

const legacyBeatsForEvent = (
  event: GameEvent,
  game: GameState,
  endingLocations: Record<CharacterId, string>,
): EventStoryBeat[] => {
  const result: EventStoryBeat[] = [];
  if (endingLocations.haru === endingLocations.aoi) {
    result.push({ kind: "move", actor: "both", location: endingLocations.haru });
  } else {
    result.push({ kind: "move", actor: "haru", location: endingLocations.haru });
    result.push({ kind: "move", actor: "aoi", location: endingLocations.aoi });
  }

  const conversation = conversationForEvent(event);
  const actionAdded: Partial<Record<CharacterId, boolean>> = {};
  for (const line of conversation) {
    if (!actionAdded[line.speaker]) {
      const action = line.speaker === "haru" ? event.haruAction : event.aoiAction;
      if (action?.trim()) result.push({ kind: "action", actor: line.speaker, action: action.trim() });
      actionAdded[line.speaker] = true;
    }
    result.push({ kind: "dialogue", actor: line.speaker, text: line.text });
  }

  // A legacy event can have actions without dialogue. Do not lose those beats.
  for (const person of PEOPLE) {
    const action = person === "haru" ? event.haruAction : event.aoiAction;
    if (action?.trim() && !actionAdded[person]) {
      result.push({ kind: "action", actor: person, action: action.trim() });
    }
  }
  return result.length ? result : [
    { kind: "move", actor: "haru", location: game.haru.location },
    { kind: "move", actor: "aoi", location: game.aoi.location },
  ];
};

export const createAfterScenePlan = (
  event: GameEvent,
  game: GameState,
  turnStart?: Partial<Record<CharacterId, CharacterState>>,
): AfterScenePlan => {
  const startingLocations: Record<CharacterId, string> = {
    haru: locationFor(event, "haru", "before", turnStart?.haru ?? game.haru),
    aoi: locationFor(event, "aoi", "before", turnStart?.aoi ?? game.aoi),
  };
  const endingLocations: Record<CharacterId, string> = {
    haru: locationFor(event, "haru", "after", game.haru),
    aoi: locationFor(event, "aoi", "after", game.aoi),
  };
  const points: Record<CharacterId, Point> = {
    haru: characterAnchor("haru", { ...(turnStart?.haru ?? game.haru), location: startingLocations.haru }),
    aoi: characterAnchor("aoi", { ...(turnStart?.aoi ?? game.aoi), location: startingLocations.aoi }),
  };
  const initialPoints = copyPoints(points);
  const locations = { ...startingLocations };
  const directions: Record<CharacterId, SpriteDirection> = { haru: "south", aoi: "south" };
  const lastTravelDirections: Partial<Record<CharacterId, SpriteDirection>> = {};
  const sourceBeats = event.storyBeats?.length
    ? event.storyBeats
    : legacyBeatsForEvent(event, game, endingLocations);
  const beats: AfterSceneBeat[] = [];

  sourceBeats.forEach((beat, beatIndex) => {
    if (beat.kind === "move") {
      const movingPeople = new Set(actorsFor(beat.actor));
      const targets = copyPoints(points);
      for (const person of PEOPLE) {
        if (movingPeople.has(person)) {
          targets[person] = pointForLocation(person, beat.location, game[person], beatIndex);
        }
      }
      const detouringPeople = new Set(PEOPLE.filter((person) => {
        if (!movingPeople.has(person)) return false;
        const start = points[person];
        const end = targets[person];
        if (Math.hypot(end.x - start.x, end.y - start.y) < 1) {
          // Free-form Director aliases can name the same furniture waypoint
          // differently ("リビングのソファ" -> "ソファ"). Give that semantic
          // leg a small loop so it remains a visible movement and turn.
          return locations[person].trim().toLowerCase() !== beat.location.trim().toLowerCase();
        }
        const previous = lastTravelDirections[person];
        return previous !== undefined && directionForTravel(start, end) === previous;
      }));

      // If two story legs would reuse the same sprite row, take one short
      // perpendicular step first. This behaves like walking around furniture
      // and makes the direction change physically match the route.
      if (detouringPeople.size > 0) {
        const detourRoutes = {} as Record<CharacterId, ResidentRoute>;
        for (const person of PEOPLE) {
          const start = { ...points[person] };
          const previous = lastTravelDirections[person] ?? directions[person];
          const end = detouringPeople.has(person)
            ? detourPointFor(start, previous)
            : start;
          const hasTravel = Math.hypot(end.x - start.x, end.y - start.y) >= 1;
          const direction = hasTravel ? directionForTravel(start, end) : directions[person];
          detourRoutes[person] = { start, end, direction, hasTravel };
          if (hasTravel) {
            points[person] = end;
            directions[person] = direction;
            lastTravelDirections[person] = direction;
          }
        }
        beats.push({
          ...beat,
          routes: detourRoutes,
          points: copyPoints(points),
          directions: copyDirections(directions),
          focusLocation: beat.location,
        });
      }

      const routes = {} as Record<CharacterId, ResidentRoute>;
      for (const person of PEOPLE) {
        const start = { ...points[person] };
        const end = movingPeople.has(person)
          ? targets[person]
          : start;
        const hasTravel = Math.hypot(end.x - start.x, end.y - start.y) >= 1;
        const direction = hasTravel ? directionForTravel(start, end) : directions[person];
        routes[person] = { start, end, direction, hasTravel };
        if (movingPeople.has(person)) {
          points[person] = end;
          locations[person] = beat.location;
          directions[person] = direction;
          if (hasTravel) lastTravelDirections[person] = direction;
        }
      }
      beats.push({
        ...beat,
        routes,
        points: copyPoints(points),
        directions: copyDirections(directions),
        focusLocation: beat.location,
      });
      return;
    }

    const focusPerson = beat.actor === "both" ? "haru" : beat.actor;
    beats.push({
      ...beat,
      points: copyPoints(points),
      directions: copyDirections(directions),
      focusLocation: locations[focusPerson],
    } as AfterSceneBeat);
  });

  const finalPoints = copyPoints(points);
  const routes = {} as Record<CharacterId, ResidentRoute>;
  for (const person of PEOPLE) {
    const start = initialPoints[person];
    const end = finalPoints[person];
    const hasTravel = Math.hypot(end.x - start.x, end.y - start.y) >= 1;
    routes[person] = {
      start,
      end,
      direction: hasTravel ? directionForTravel(start, end) : directions[person],
      hasTravel,
    };
  }

  return {
    eventId: event.id,
    initialPoints,
    finalPoints,
    finalDirections: copyDirections(directions),
    beats,
    routes,
    conversation: conversationForEvent(event),
  };
};
