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
    expect(plan.routes.haru.end).not.toEqual(plan.routes.haru.start);
    expect(plan.routes.aoi.end).not.toEqual(plan.routes.aoi.start);
    expect(plan.routes.haru.end).not.toEqual(plan.routes.aoi.end);
  });

  it("routes desk and laundry beats to each resident's safe destination", () => {
    const game: GameState = {
      ...INITIAL_GAME_STATE,
      haru: { ...INITIAL_GAME_STATE.haru, location: "作業机" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "洗濯スペース" },
    };
    const plan = createAfterScenePlan(event({
      storyBeats: [
        { kind: "move", actor: "haru", location: "作業机の前" },
        { kind: "action", actor: "haru", action: "ノートを開く" },
        { kind: "move", actor: "aoi", location: "洗濯ラック前" },
      ],
    }), game, {
      haru: { ...INITIAL_GAME_STATE.haru, location: "リビング" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "リビング" },
    });

    const moves = plan.beats.filter((beat) => beat.kind === "move");
    expect(moves).toHaveLength(2);
    expect(moves[0]?.routes.haru.hasTravel).toBe(true);
    expect(moves[1]?.routes.aoi.hasTravel).toBe(true);
    expect(plan.finalPoints.haru).not.toEqual(plan.finalPoints.aoi);
  });

  it("places both residents on opposite sides of the island and faces them together", () => {
    const game: GameState = {
      ...INITIAL_GAME_STATE,
      haru: { ...INITIAL_GAME_STATE.haru, location: "アイランドキッチン" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "アイランドキッチン" },
    };
    const plan = createAfterScenePlan(event({
      storyBeats: [
        { kind: "move", actor: "both", location: "アイランドキッチン" },
        { kind: "dialogue", actor: "haru", text: "向かいで野菜を切るね。" },
        { kind: "dialogue", actor: "aoi", text: "顔が見えると作りやすいね。" },
      ],
    }), game, {
      haru: { ...INITIAL_GAME_STATE.haru, location: "Haru room" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "Aoi room" },
    });

    const move = plan.beats.find((beat) => beat.kind === "move");
    const dialogue = plan.beats.find((beat) => beat.kind === "dialogue");
    expect(move?.points.haru).not.toEqual(move?.points.aoi);
    expect(dialogue?.directions).toEqual({ haru: "east", aoi: "west" });
  });

  it("preserves a Director story as ordered movement, dialogue, and action beats", () => {
    const game: GameState = {
      ...INITIAL_GAME_STATE,
      haru: { ...INITIAL_GAME_STATE.haru, location: "ベランダ" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "リビング" },
    };
    const plan = createAfterScenePlan(event({
      storyBeats: [
        { kind: "move", actor: "haru", location: "キッチンの調理台" },
        { kind: "dialogue", actor: "haru", text: "まずスープを温めよう。" },
        { kind: "action", actor: "haru", action: "鍋を弱火にかける" },
        { kind: "move", actor: "haru", location: "ベランダの窓際" },
        { kind: "dialogue", actor: "aoi", text: "いい匂いがしてきたね。" },
      ],
    }), game, {
      haru: { ...INITIAL_GAME_STATE.haru, location: "リビング" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "リビング" },
    });

    expect(plan.beats.map((beat) => beat.kind)).toEqual([
      "move", "dialogue", "action", "move", "dialogue",
    ]);
    expect(plan.beats[1]).toMatchObject({
      kind: "dialogue",
      actor: "haru",
      text: "まずスープを温めよう。",
    });
    expect(plan.beats[2]).toMatchObject({
      kind: "action",
      actor: "haru",
      action: "鍋を弱火にかける",
    });
    const moves = plan.beats.filter((beat) => beat.kind === "move");
    expect(moves).toHaveLength(2);
    expect(moves[0]?.routes.haru.hasTravel).toBe(true);
    expect(moves[1]?.routes.haru.hasTravel).toBe(true);
    expect(moves[0]?.routes.haru.direction).not.toBe(moves[1]?.routes.haru.direction);
    expect(moves[0]?.points.haru).not.toEqual(moves[1]?.points.haru);
  });

  it("adds a physical turn when consecutive story legs would face one direction", () => {
    const game: GameState = {
      ...INITIAL_GAME_STATE,
      haru: { ...INITIAL_GAME_STATE.haru, location: "リビングのローテーブル" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "リビングのローテーブル" },
    };
    const plan = createAfterScenePlan(event({
      storyBeats: [
        { kind: "move", actor: "both", location: "ダイニングの食卓" },
        { kind: "dialogue", actor: "haru", text: "食卓を片付けよう。" },
        { kind: "action", actor: "both", action: "食器をまとめる" },
        { kind: "dialogue", actor: "aoi", text: "次はリビングだね。" },
        { kind: "move", actor: "both", location: "リビングのローテーブル" },
        { kind: "dialogue", actor: "haru", text: "ここもきれいになった。" },
      ],
    }), game, {
      haru: { ...INITIAL_GAME_STATE.haru, location: "キッチン" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "キッチン" },
    });

    const moves = plan.beats.filter((beat) => beat.kind === "move");
    expect(moves).toHaveLength(3);
    expect(new Set(moves.map((beat) => beat.routes.haru.direction)).size).toBeGreaterThan(1);
    expect(new Set(moves.map((beat) => beat.routes.aoi.direction)).size).toBeGreaterThan(1);
    expect(moves.every((beat) => beat.routes.haru.hasTravel)).toBe(true);
    expect(moves.every((beat) => beat.routes.aoi.hasTravel)).toBe(true);
  });

  it("keeps synonymous furniture destinations visible as a turning loop", () => {
    const game: GameState = {
      ...INITIAL_GAME_STATE,
      haru: { ...INITIAL_GAME_STATE.haru, location: "ソファ" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "ソファ" },
    };
    const plan = createAfterScenePlan(event({
      storyBeats: [
        { kind: "move", actor: "both", location: "リビングのソファ" },
        { kind: "dialogue", actor: "haru", text: "ここで話そう。" },
        { kind: "action", actor: "both", action: "飲み物を手に取る" },
        { kind: "move", actor: "both", location: "ソファ" },
        { kind: "dialogue", actor: "aoi", text: "続きを聞かせて。" },
      ],
    }), game, {
      haru: { ...INITIAL_GAME_STATE.haru, location: "キッチン" },
      aoi: { ...INITIAL_GAME_STATE.aoi, location: "キッチン" },
    });

    const moves = plan.beats.filter((beat) => beat.kind === "move");
    expect(moves).toHaveLength(3);
    expect(moves.every((beat) => beat.routes.haru.hasTravel)).toBe(true);
    expect(moves.every((beat) => beat.routes.aoi.hasTravel)).toBe(true);
    expect(new Set(moves.map((beat) => beat.routes.haru.direction)).size).toBeGreaterThan(1);
    expect(new Set(moves.map((beat) => beat.routes.aoi.direction)).size).toBeGreaterThan(1);
  });
});
