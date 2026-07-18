import { describe, expect, it } from "vitest";
import {
  ROOM_ZONES,
  characterAnchor,
  roomForEvent,
  roomForLocation,
} from "../../web/src/room-layout.js";
import type { CharacterState, GameEvent } from "../../web/src/types.js";

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
});
