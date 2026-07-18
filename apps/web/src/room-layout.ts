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

export type RoomZone = {
  id: RoomId;
  label: string;
  labelPoint: Point;
  points: string;
};

const iso = (x: number, y: number): Point => ({
  x: 600 + x * 25 - y * 25,
  y: 100 + x * 12.5 + y * 12.5,
});

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

const PAIR_ANCHORS: Record<RoomId, Point> = {
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
  if (containsAny(haystack, ["ベランダ", "バルコニー", "夕涼み", "laundry", "balcony"])) return "balcony";
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
  const base = PAIR_ANCHORS[room];
  const offset = person === "haru" ? { x: -27, y: -10 } : { x: 29, y: 8 };
  return { x: base.x + offset.x, y: base.y + offset.y };
};

export const focusPointForRoom = (room: RoomId): Point => PAIR_ANCHORS[room];
