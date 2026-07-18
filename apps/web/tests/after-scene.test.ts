import { describe, expect, it } from "vitest";
import { INITIAL_GAME_STATE } from "../src/api.js";
import {
  conversationForEvent,
  createAfterScenePlan,
  directionForTravel,
} from "../src/after-scene.js";
import type { GameEvent, GameState } from "../src/types.js";

const event = (overrides: Partial<GameEvent> = {}): GameEvent => ({
  id: "event-1",
  day: 1,
  phase: "morning",
  eventTitle: "朝の会話",
  narration: "ふたりが話した。",
  ...overrides,
});

describe("post-event room scene", () => {
  it("maps all four isometric travel vectors to sprite sheet rows", () => {
    const origin = { x: 100, y: 100 };
    expect(directionForTravel(origin, { x: 75, y: 112.5 })).toBe("south");
    expect(directionForTravel(origin, { x: 125, y: 112.5 })).toBe("east");
    expect(directionForTravel(origin, { x: 125, y: 87.5 })).toBe("north");
    expect(directionForTravel(origin, { x: 75, y: 87.5 })).toBe("west");
  });

  it("uses the ordered Director conversation when present", () => {
    expect(conversationForEvent(event({
      conversation: [
        { speaker: "aoi", text: " 今日はどうする？ " },
        { speaker: "haru", text: "一緒に決めよう。" },
        { speaker: "aoi", text: "うん。" },
      ],
    }))).toEqual([
      { speaker: "aoi", text: "今日はどうする？" },
      { speaker: "haru", text: "一緒に決めよう。" },
      { speaker: "aoi", text: "うん。" },
    ]);
  });

  it("falls back to legacy Haru/Aoi dialogue without inventing lines", () => {
    expect(conversationForEvent(event({
      haruDialogue: "少し話そうか。",
      aoiDialogue: "うん、聞かせて。",
    }))).toEqual([
      { speaker: "haru", text: "少し話そうか。" },
      { speaker: "aoi", text: "うん、聞かせて。" },
    ]);
  });

  it("builds routes from the previous snapshot to the committed state", () => {
    const game: GameState = {
      ...INITIAL_GAME_STATE,
      haru: { ...INITIAL_GAME_STATE.haru, location: "キッチン" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "ベランダ" },
    };
    const plan = createAfterScenePlan(event({
      statesBefore: {
        haru: { energy: 70, stress: 20, affection: 20, trust: 30, romanticAwareness: 5, location: "Haru room" },
        aoi: { energy: 65, stress: 25, affection: 20, trust: 30, romanticAwareness: 5, location: "Aoi room" },
      },
      statesAfter: {
        haru: { energy: 68, stress: 18, affection: 22, trust: 32, romanticAwareness: 6, location: "キッチン" },
        aoi: { energy: 63, stress: 22, affection: 22, trust: 32, romanticAwareness: 6, location: "ベランダ" },
      },
    }), game);

    expect(plan.routes.haru.hasTravel).toBe(true);
    expect(plan.routes.aoi.hasTravel).toBe(true);
    expect(plan.routes.haru.start).not.toEqual(plan.routes.haru.end);
    expect(plan.routes.aoi.start).not.toEqual(plan.routes.aoi.end);
  });

  it("gives same-room Director scenes a visible character-specific destination", () => {
    const game: GameState = {
      ...INITIAL_GAME_STATE,
      haru: { ...INITIAL_GAME_STATE.haru, location: "リビング" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "リビング" },
    };
    const plan = createAfterScenePlan(event({
      before: {
        characters: {
          haru: { energy: 70, stress: 20, affection: 20, trust: 30, romanticAwareness: 5, location: "リビング" },
          aoi: { energy: 65, stress: 25, affection: 20, trust: 30, romanticAwareness: 5, location: "リビング" },
        },
      },
      scene: {
        haru: "リビングのソファで腰を下ろす",
        aoi: "リビングのローテーブルへ近づく",
      },
    }), game);

    expect(plan.routes.haru.hasTravel).toBe(true);
    expect(plan.routes.aoi.hasTravel).toBe(true);
    expect(plan.routes.haru.end.x - plan.routes.haru.start.x).toBe(-18);
    expect(plan.routes.aoi.end.x - plan.routes.aoi.start.x).toBe(18);
    expect(plan.routes.haru.end.y - plan.routes.haru.start.y).toBe(9);
    expect(plan.routes.aoi.end.y - plan.routes.aoi.start.y).toBe(9);
  });
});
