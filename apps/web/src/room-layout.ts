import type { CharacterState, GameEvent } from "./types.js";

export type CharacterId = "haru" | "aoi";

export type RoomId =
  | "haru_room"
  | "aoi_room"
  | "entry"
  | "washroom"
  | "hallway"
  | "bathroom"
  | "kitchen"
  | "dining"
  | "living"
  | "balcony";

export type Point = { x: number; y: number };

export type GridObstacle = {
  roomId: RoomId;
  x: number;
  y: number;
  width: number;
  depth: number;
};

type CharacterSpots = Record<CharacterId, Point>;

export type RoomZone = {
  id: RoomId;
  label: string;
  labelPoint: Point;
  points: string;
};

export const projectRoomPoint = (x: number, y: number): Point => ({
  x: 600 + x * 25 - y * 25,
  y: 100 + x * 12.5 + y * 12.5,
});

const iso = projectRoomPoint;

// SceneCharacter's SVG origin sits 18 px above the contact point used by its
// shadow and feet. Keeping room layout data in world coordinates makes the
// furniture footprints and resident destinations directly comparable.
export const CHARACTER_FLOOR_OFFSET_Y = 18;

export const projectCharacterFloorPoint = (point: Point): Point => {
  const projected = iso(point.x, point.y);
  return { x: projected.x, y: projected.y - CHARACTER_FLOOR_OFFSET_Y };
};

const polygon = (...points: Array<[number, number]>): string =>
  points.map(([x, y]) => {
    const point = iso(x, y);
    return `${point.x},${point.y}`;
  }).join(" ");

export const ROOM_ZONES: RoomZone[] = [
  { id: "haru_room", label: "HARU ROOM", labelPoint: iso(3.2, 1.4), points: polygon([0, 0], [8, 0], [8, 6], [0, 6]) },
  { id: "aoi_room", label: "AOI ROOM", labelPoint: iso(11.2, 1.4), points: polygon([8, 0], [16, 0], [16, 6], [8, 6]) },
  { id: "entry", label: "ENTRY", labelPoint: iso(16.8, 0.8), points: polygon([16, 0], [19, 0], [19, 3], [16, 3]) },
  { id: "washroom", label: "WASH", labelPoint: iso(20.2, 0.8), points: polygon([19, 0], [24, 0], [24, 3], [19, 3]) },
  {
    id: "hallway",
    label: "HALL",
    labelPoint: iso(8.6, 6.6),
    // The canonical layout defines the hall as the union of a horizontal
    // corridor and the vertical leg between the entry and the LDK.
    points: polygon([0, 6], [16, 6], [16, 3], [19, 3], [19, 8], [0, 8]),
  },
  { id: "bathroom", label: "BATH", labelPoint: iso(20.4, 4.3), points: polygon([19, 3], [24, 3], [24, 8], [19, 8]) },
  { id: "kitchen", label: "KITCHEN", labelPoint: iso(2.2, 9), points: polygon([0, 8], [7, 8], [7, 16], [0, 16]) },
  { id: "dining", label: "DINING", labelPoint: iso(9.1, 9), points: polygon([7, 8], [14, 8], [14, 16], [7, 16]) },
  { id: "living", label: "LIVING", labelPoint: iso(17.5, 9.1), points: polygon([14, 8], [24, 8], [24, 16], [14, 16]) },
  { id: "balcony", label: "BALCONY", labelPoint: iso(10.5, 16.7), points: polygon([0, 16], [24, 16], [24, 18], [0, 18]) },
];

const ROOM_FOCUS_POINTS: Record<RoomId, Point> = {
  haru_room: iso(4.5, 3),
  aoi_room: iso(12.5, 3),
  entry: iso(17.3, 1.3),
  washroom: iso(21.5, 1.3),
  hallway: iso(10, 6.8),
  bathroom: iso(21.3, 5.3),
  kitchen: iso(3.2, 12),
  dining: iso(10.5, 13.2),
  living: iso(19.2, 12.7),
  balcony: iso(17.2, 16.7),
};

/**
 * Furniture-safe standing positions in the same 24 x 18 world grid used by
 * the furniture manifest. These are floor-contact points, not sprite origins.
 */
export const ROOM_STAND_SPOTS: Record<RoomId, CharacterSpots> = {
  haru_room: { haru: { x: 7.4, y: 3.5 }, aoi: { x: 4.3, y: 4.8 } },
  aoi_room: { haru: { x: 12.2, y: 4.8 }, aoi: { x: 15.2, y: 3.5 } },
  entry: { haru: { x: 16.4, y: 2.6 }, aoi: { x: 18.7, y: 2.6 } },
  washroom: { haru: { x: 22.2, y: 2.2 }, aoi: { x: 23.2, y: 1.8 } },
  hallway: { haru: { x: 9.1, y: 6.9 }, aoi: { x: 11, y: 6.8 } },
  bathroom: { haru: { x: 19.6, y: 5.2 }, aoi: { x: 23, y: 5.2 } },
  // The 1x2 island occupies x=3..4 / y=10..12. Residents stand on its
  // opposite long sides so conversation can resolve as a face-to-face beat.
  kitchen: { haru: { x: 2, y: 11 }, aoi: { x: 5, y: 11 } },
  dining: { haru: { x: 10.2, y: 14.8 }, aoi: { x: 12.6, y: 14.8 } },
  living: { haru: { x: 18.7, y: 14.6 }, aoi: { x: 22.3, y: 13.4 } },
  balcony: { haru: { x: 16.3, y: 16.8 }, aoi: { x: 18.1, y: 16.5 } },
};

// Safe alternates let repeated/synonymous story destinations include a turn
// without inventing a screen-space nudge that can land inside furniture.
export const ROOM_TURN_SPOTS: Record<RoomId, CharacterSpots> = {
  haru_room: { haru: { x: 4.3, y: 4.8 }, aoi: { x: 7.4, y: 3.5 } },
  aoi_room: { haru: { x: 15.2, y: 3.5 }, aoi: { x: 12.2, y: 4.8 } },
  entry: { haru: { x: 18.7, y: 2.6 }, aoi: { x: 16.4, y: 2.6 } },
  washroom: { haru: { x: 23.2, y: 1.8 }, aoi: { x: 22.2, y: 2.2 } },
  hallway: { haru: { x: 10.7, y: 7.2 }, aoi: { x: 9.4, y: 6.7 } },
  bathroom: { haru: { x: 19.8, y: 6.7 }, aoi: { x: 23, y: 6.6 } },
  kitchen: { haru: { x: 2.1, y: 13.4 }, aoi: { x: 5.2, y: 13.4 } },
  dining: { haru: { x: 12.7, y: 14.8 }, aoi: { x: 9.3, y: 13.8 } },
  living: { haru: { x: 22.3, y: 13.4 }, aoi: { x: 18.7, y: 14.6 } },
  balcony: { haru: { x: 18.2, y: 16.6 }, aoi: { x: 16.4, y: 16.8 } },
};

export const DESTINATION_STAND_SPOTS = {
  sofa: { haru: { x: 21.5, y: 12.2 }, aoi: { x: 22.7, y: 12.7 } },
  lowTable: { haru: { x: 20.7, y: 13.8 }, aoi: { x: 22.1, y: 13.7 } },
  diningTable: { haru: { x: 9.2, y: 13.8 }, aoi: { x: 13.3, y: 13.4 } },
  kitchenCounter: { haru: { x: 2, y: 11 }, aoi: { x: 5, y: 11 } },
  livingWindow: { haru: { x: 23.3, y: 10.2 }, aoi: { x: 23.4, y: 11.7 } },
  balconyWindow: { haru: { x: 15.8, y: 16.6 }, aoi: { x: 17.3, y: 16.6 } },
  entryDoor: { haru: { x: 16.4, y: 2.6 }, aoi: { x: 18.7, y: 2.6 } },
  workDesk: { haru: { x: 7.3, y: 3.2 }, aoi: { x: 15.2, y: 3.2 } },
  laundryRack: { haru: { x: 9.7, y: 17.4 }, aoi: { x: 14.6, y: 17.4 } },
} satisfies Record<string, CharacterSpots>;

const ROOM_WORLD_BOUNDS: Record<RoomId, Array<{ x: number; y: number; width: number; height: number }>> = {
  haru_room: [{ x: 0, y: 0, width: 8, height: 6 }],
  aoi_room: [{ x: 8, y: 0, width: 8, height: 6 }],
  entry: [{ x: 16, y: 0, width: 3, height: 3 }],
  washroom: [{ x: 19, y: 0, width: 5, height: 3 }],
  hallway: [
    { x: 0, y: 6, width: 19, height: 2 },
    { x: 16, y: 3, width: 3, height: 3 },
  ],
  bathroom: [{ x: 19, y: 3, width: 5, height: 5 }],
  kitchen: [{ x: 0, y: 8, width: 7, height: 8 }],
  dining: [{ x: 7, y: 8, width: 7, height: 8 }],
  living: [{ x: 14, y: 8, width: 10, height: 8 }],
  balcony: [{ x: 0, y: 16, width: 24, height: 2 }],
};

const characterRect = (point: Point) => ({
  x: point.x - 0.5,
  y: point.y - 0.5,
  width: 1,
  height: 1,
});

const SAFE_DESTINATION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
  [-2, 0], [2, 0], [0, -2], [0, 2],
];

const rectanglesOverlap = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean => left.x < right.x + right.width
  && left.x + left.width > right.x
  && left.y < right.y + right.height
  && left.y + left.height > right.y;

const safeDestination = (
  person: CharacterId,
  room: RoomId,
  preferred: Point,
  obstacles: readonly GridObstacle[],
): Point => {
  if (obstacles.length === 0) return preferred;
  const roomObstacles = obstacles.filter((obstacle) => obstacle.roomId === room);
  const candidates = [
    preferred,
    ROOM_STAND_SPOTS[room][person],
    ROOM_TURN_SPOTS[room][person],
    ...SAFE_DESTINATION_OFFSETS.map(([x, y]) => ({
      x: preferred.x + x,
      y: preferred.y + y,
    })),
  ];

  return candidates.find((candidate) => {
    const occupied = characterRect(candidate);
    const insideRoom = ROOM_WORLD_BOUNDS[room].some((bounds) =>
      occupied.x >= bounds.x
      && occupied.y >= bounds.y
      && occupied.x + occupied.width <= bounds.x + bounds.width
      && occupied.y + occupied.height <= bounds.y + bounds.height);
    if (!insideRoom) return false;
    return roomObstacles.every((obstacle) => !rectanglesOverlap(occupied, {
      x: obstacle.x,
      y: obstacle.y,
      width: obstacle.width,
      height: obstacle.depth,
    }));
  }) ?? preferred;
};

const EVENT_ROOMS: Partial<Record<string, RoomId>> = {
  "shared-cooking": "kitchen",
  "movie-night": "living",
  "shared-cleaning": "living",
  "gentle-conversation": "living",
  "targeted-apology": "living",
  "small-gift": "living",
  "confession-space": "living",
};

const containsAny = (value: string, needles: string[]): boolean =>
  needles.some((needle) => value.includes(needle));

export const roomForLocation = (location: string, person: CharacterId): RoomId => {
  const value = location.toLowerCase();
  if (containsAny(value, ["キッチン", "台所", "kitchen"])) return "kitchen";
  if (containsAny(value, ["ダイニング", "食卓", "dining"])) return "dining";
  if (containsAny(value, ["ベランダ", "バルコニー", "balcony"])) return "balcony";
  if (containsAny(value, ["洗面", "身支度", "washroom"])) return "washroom";
  if (containsAny(value, ["風呂", "浴室", "bathroom"])) return "bathroom";
  if (containsAny(value, ["玄関", "帰宅", "外出", "entry"])) return "entry";
  if (containsAny(value, ["廊下", "hallway"])) return "hallway";
  if (containsAny(value, ["リビング", "living"])) return "living";
  if (containsAny(value, ["作業机", "デスク", "desk"])) {
    if (containsAny(value, ["haru", "ハル"])) return "haru_room";
    if (containsAny(value, ["aoi", "アオイ"])) return "aoi_room";
    return person === "haru" ? "haru_room" : "aoi_room";
  }
  if (containsAny(value, ["洗濯", "ランドリー", "laundry"])) return "balcony";
  if (containsAny(value, ["haru", "ハル"])) return "haru_room";
  if (containsAny(value, ["aoi", "アオイ"])) return "aoi_room";
  if (containsAny(value, ["自室", "寝室", "部屋", "room"])) {
    return person === "haru" ? "haru_room" : "aoi_room";
  }
  return "living";
};

export const roomForEvent = (event?: GameEvent): RoomId | undefined => {
  if (!event) return undefined;
  const haystack = `${event.eventTitle} ${event.narration} ${event.suggestion ?? ""}`.toLowerCase();
  // An explicitly narrated/requested location wins over the event default.
  // This keeps flexible events such as conversation (living/balcony) and
  // gifts (living/entry) faithful to the actual resolved scene.
  if (containsAny(haystack, ["ベランダ", "バルコニー", "夕涼み", "洗濯", "ランドリー", "laundry", "balcony"])) return "balcony";
  if (containsAny(haystack, ["玄関", "帰宅", "外出", "出かけ", "entry"])) return "entry";
  if (containsAny(haystack, ["洗面", "身支度", "washroom"])) return "washroom";
  if (containsAny(haystack, ["風呂", "浴室", "bathroom"])) return "bathroom";
  if (containsAny(haystack, ["廊下", "hallway"])) return "hallway";
  if (containsAny(haystack, ["ダイニング", "食卓", "dining"])) return "dining";
  if (containsAny(haystack, ["キッチン", "台所", "料理", "夕食", "朝食", "カレー", "cook"])) return "kitchen";
  if (containsAny(haystack, ["リビング", "映画", "ソファ", "movie", "living"])) return "living";

  if (event.eventDefinitionId && EVENT_ROOMS[event.eventDefinitionId]) {
    return EVENT_ROOMS[event.eventDefinitionId];
  }
  if (containsAny(haystack, ["食事", "eat"])) return "dining";
  if (containsAny(haystack, ["掃除", "会話", "話", "謝", "贈り物"])) return "living";
  return undefined;
};

export const characterAnchor = (
  person: CharacterId,
  state: CharacterState,
): Point => {
  const room = roomForLocation(state.location, person);
  return projectCharacterFloorPoint(ROOM_STAND_SPOTS[room][person]);
};

const rawWorldDestinationForLocation = (
  person: CharacterId,
  location: string,
): Point => {
  const value = location.toLowerCase();
  const room = roomForLocation(location, person);

  if (containsAny(value, ["ソファ", "sofa"])) return DESTINATION_STAND_SPOTS.sofa[person];
  if (containsAny(value, ["ローテーブル", "coffee table"])) return DESTINATION_STAND_SPOTS.lowTable[person];
  if (containsAny(value, ["作業机", "デスク", "desk"])) {
    return room === "aoi_room"
      ? DESTINATION_STAND_SPOTS.workDesk.aoi
      : DESTINATION_STAND_SPOTS.workDesk.haru;
  }
  if (containsAny(value, ["アイランド", "キッチン台", "調理台", "カウンター", "island", "counter"])) return DESTINATION_STAND_SPOTS.kitchenCounter[person];
  if (containsAny(value, ["洗濯スペース", "洗濯ラック", "ランドリー", "laundry"])) return DESTINATION_STAND_SPOTS.laundryRack[person];
  if (containsAny(value, ["窓", "window"])) {
    return room === "balcony"
      ? DESTINATION_STAND_SPOTS.balconyWindow[person]
      : DESTINATION_STAND_SPOTS.livingWindow[person];
  }
  if (containsAny(value, ["入口", "ドア", "door"])) return DESTINATION_STAND_SPOTS.entryDoor[person];
  if (containsAny(value, ["テーブル", "食卓", "table"])) {
    return room === "living"
      ? DESTINATION_STAND_SPOTS.lowTable[person]
      : DESTINATION_STAND_SPOTS.diningTable[person];
  }

  return ROOM_STAND_SPOTS[room][person];
};

export const worldDestinationForLocation = (
  person: CharacterId,
  location: string,
  obstacles: readonly GridObstacle[] = [],
): Point => {
  const room = roomForLocation(location, person);
  return safeDestination(
    person,
    room,
    rawWorldDestinationForLocation(person, location),
    obstacles,
  );
};

export const characterDestinationForLocation = (
  person: CharacterId,
  location: string,
  obstacles: readonly GridObstacle[] = [],
): Point => projectCharacterFloorPoint(worldDestinationForLocation(person, location, obstacles));

export const characterDetourCandidates = (
  person: CharacterId,
  location: string,
  obstacles: readonly GridObstacle[] = [],
): Point[] => {
  const room = roomForLocation(location, person);
  return [
    projectCharacterFloorPoint(safeDestination(
      person,
      room,
      ROOM_TURN_SPOTS[room][person],
      obstacles,
    )),
    projectCharacterFloorPoint(safeDestination(
      person,
      room,
      ROOM_STAND_SPOTS[room][person],
      obstacles,
    )),
  ];
};

export const focusPointForRoom = (room: RoomId): Point => ROOM_FOCUS_POINTS[room];
