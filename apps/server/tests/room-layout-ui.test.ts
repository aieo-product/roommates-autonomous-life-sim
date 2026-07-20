import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ROOM_ZONES,
  ROOM_STAND_SPOTS,
  ROOM_TURN_SPOTS,
  characterAnchor,
  projectCharacterFloorPoint,
  roomForEvent,
  roomForLocation,
  worldDestinationForLocation,
} from "../../web/src/room-layout.js";
import type { CharacterState, GameEvent } from "../../web/src/types.js";

type Rect = { x: number; y: number; width: number; height: number };
type LayoutArea = {
  id: string;
  bounds: Rect | Rect[];
  blocked?: Rect[];
  zones?: LayoutArea[];
};
type FurnitureManifest = {
  assets: Array<{ id: string; footprintTiles: { width: number; depth: number } }>;
  defaultScene: {
    instances: Array<{
      instanceId: string;
      assetId: string;
      roomId: string;
      floorContact: { x: number; y: number };
    }>;
  };
};

const furnitureManifest = JSON.parse(readFileSync(
  new URL("../../../assets/furniture/manifest.json", import.meta.url),
  "utf8",
)) as FurnitureManifest;
const canonicalLayout = JSON.parse(readFileSync(
  new URL("../../../docs/room-layout.json", import.meta.url),
  "utf8",
)) as { rooms: LayoutArea[] };
const layoutAreas = canonicalLayout.rooms.flatMap((room) => [room, ...(room.zones ?? [])]);
const layoutAreaById = new Map(layoutAreas.map((area) => [area.id, area]));
const furnitureAssetById = new Map(furnitureManifest.assets.map((asset) => [asset.id, asset]));

const pointInside = (point: { x: number; y: number }, rect: Rect): boolean =>
  point.x > rect.x
  && point.x < rect.x + rect.width
  && point.y > rect.y
  && point.y < rect.y + rect.height;

const pointWithin = (point: { x: number; y: number }, rect: Rect): boolean =>
  point.x >= rect.x
  && point.x <= rect.x + rect.width
  && point.y >= rect.y
  && point.y <= rect.y + rect.height;

const furnitureFootprintsByRoom = new Map<string, Rect[]>();
for (const instance of furnitureManifest.defaultScene.instances) {
  const asset = furnitureAssetById.get(instance.assetId);
  if (!asset) continue;
  const footprints = furnitureFootprintsByRoom.get(instance.roomId) ?? [];
  footprints.push({
    x: instance.floorContact.x - asset.footprintTiles.width,
    y: instance.floorContact.y - asset.footprintTiles.depth,
    width: asset.footprintTiles.width,
    height: asset.footprintTiles.depth,
  });
  furnitureFootprintsByRoom.set(instance.roomId, footprints);
}

const expectWalkable = (
  roomId: string,
  point: { x: number; y: number },
  label: string,
): void => {
  const area = layoutAreaById.get(roomId);
  expect(area, `${label} should reference a canonical room`).toBeDefined();
  const bounds = Array.isArray(area?.bounds) ? area.bounds : area ? [area.bounds] : [];
  expect(bounds.some((rect) => pointWithin(point, rect)), `${label} should stay inside ${roomId}`).toBe(true);
  for (const footprint of furnitureFootprintsByRoom.get(roomId) ?? []) {
    expect(pointInside(point, footprint), `${label} should avoid furniture in ${roomId}`).toBe(false);
  }
  for (const blocked of area?.blocked ?? []) {
    expect(pointInside(point, blocked), `${label} should avoid blocked space in ${roomId}`).toBe(false);
  }
};

const event = (overrides: Partial<GameEvent> = {}): GameEvent => ({
  id: "event-1",
  day: 1,
  phase: "evening",
  eventTitle: "できごと",
  narration: "ふたりは静かに過ごした。",
  ...overrides,
});

const state = (location: string): CharacterState => ({
  energy: 70,
  stress: 20,
  affection: 30,
  trust: 30,
  romanticAwareness: 10,
  mood: "穏やか",
  location,
  currentGoal: "自分のペースで過ごす",
});

describe("whole-apartment UI layout contract", () => {
  it("contains every canonical room and the L-shaped hallway leg", () => {
    expect(ROOM_ZONES.map((zone) => zone.id)).toEqual([
      "haru_room",
      "aoi_room",
      "entry",
      "washroom",
      "hallway",
      "bathroom",
      "kitchen",
      "dining",
      "living",
      "balcony",
    ]);

    expect(ROOM_ZONES.find((zone) => zone.id === "hallway")?.points).toBe(
      "450,175 850,375 925,337.5 1000,375 875,437.5 400,200",
    );
  });

  it("maps each person's generic private room independently", () => {
    expect(roomForLocation("自室", "haru")).toBe("haru_room");
    expect(roomForLocation("自室", "aoi")).toBe("aoi_room");
    expect(roomForLocation("作業机", "haru")).toBe("haru_room");
    expect(roomForLocation("デスク", "aoi")).toBe("aoi_room");
    expect(roomForLocation("Aoiのデスク", "haru")).toBe("aoi_room");
  });

  it("maps shared laundry destinations to the balcony", () => {
    expect(roomForLocation("洗濯スペース", "haru")).toBe("balcony");
    expect(roomForLocation("ランドリーラック", "aoi")).toBe("balcony");
    expect(roomForLocation("laundry corner", "haru")).toBe("balcony");
    expect(roomForLocation("リビングで洗濯物を畳む", "haru")).toBe("living");
  });

  it("uses canonical event defaults but honors an explicit scene location", () => {
    expect(roomForEvent(event({ eventDefinitionId: "gentle-conversation" }))).toBe("living");
    expect(roomForEvent(event({
      eventDefinitionId: "gentle-conversation",
      suggestion: "ベランダで話してみたら？",
    }))).toBe("balcony");
    expect(roomForEvent(event({ eventDefinitionId: "confession-space" }))).toBe("living");
    expect(roomForEvent(event({
      eventDefinitionId: "small-gift",
      narration: "玄関で小さな贈り物を手渡した。",
    }))).toBe("entry");
  });

  it("does not invent a shared focus for an unspecified rest scene", () => {
    expect(roomForEvent(event({ eventDefinitionId: "observe-rest" }))).toBeUndefined();
  });

  it("places split-room characters from their own resolved locations", () => {
    const haru = characterAnchor("haru", state("自室"));
    const aoi = characterAnchor("aoi", state("リビング"));

    expect(haru).not.toEqual(aoi);
    expect(roomForLocation("自室", "haru")).toBe("haru_room");
    expect(roomForLocation("リビング", "aoi")).toBe("living");
  });

  it("uses floor-contact projections for furniture-safe room positions", () => {
    expect(characterAnchor("haru", state("キッチン"))).toEqual(
      projectCharacterFloorPoint(ROOM_STAND_SPOTS.kitchen.haru),
    );
    expect(characterAnchor("aoi", state("リビング"))).toEqual(
      projectCharacterFloorPoint(ROOM_STAND_SPOTS.living.aoi),
    );

    expect(ROOM_STAND_SPOTS.kitchen.haru.y).toBeGreaterThan(10);
    expect(ROOM_STAND_SPOTS.kitchen.aoi.y).toBeGreaterThan(10);
    expect(ROOM_STAND_SPOTS.living.haru.x).toBeLessThan(20);
  });

  it("resolves named furniture destinations to walkable world positions", () => {
    const counter = worldDestinationForLocation("haru", "キッチンの調理台前");
    const sofa = worldDestinationForLocation("aoi", "リビングのソファ前");
    const desk = worldDestinationForLocation("haru", "作業机の前");
    const laundry = worldDestinationForLocation("aoi", "洗濯ラック前");

    expect(counter.y).toBeGreaterThan(10);
    expect(sofa.x).toBeGreaterThan(21);
    expect(desk).toEqual({ x: 7.3, y: 3.2 });
    expect(laundry).toEqual({ x: 12.3, y: 17.4 });
    expect(worldDestinationForLocation("haru", "Aoiのデスク前")).toEqual({ x: 15.2, y: 3.2 });
  });

  it("keeps every resident stand, turn, and named destination off furniture and blocked paths", () => {
    for (const [roomId, spots] of Object.entries(ROOM_STAND_SPOTS)) {
      expectWalkable(roomId, spots.haru, `${roomId}.stand.haru`);
      expectWalkable(roomId, spots.aoi, `${roomId}.stand.aoi`);
    }
    for (const [roomId, spots] of Object.entries(ROOM_TURN_SPOTS)) {
      expectWalkable(roomId, spots.haru, `${roomId}.turn.haru`);
      expectWalkable(roomId, spots.aoi, `${roomId}.turn.aoi`);
    }

    const namedDestinations = [
      "リビングのソファ前",
      "リビングのローテーブル横",
      "ダイニングの食卓横",
      "キッチンの調理台前",
      "リビングの窓際",
      "ベランダの窓際",
      "玄関のドア前",
      "作業机の前",
      "Aoiのデスク前",
      "洗濯ラック前",
    ];
    for (const location of namedDestinations) {
      for (const person of ["haru", "aoi"] as const) {
        const roomId = roomForLocation(location, person);
        expectWalkable(
          roomId,
          worldDestinationForLocation(person, location),
          `${location}.${person}`,
        );
      }
    }
  });
});
