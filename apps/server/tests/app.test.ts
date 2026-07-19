import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { getDefaultCharacterSettings } from "@roommates/shared";
import { createApp } from "../src/app.js";
import { GameEngine } from "../src/engine/game-engine.js";
import { MemoryGameRepository } from "../src/persistence/repository.js";
import { StaticAgentCoordinator } from "./helpers.js";

async function testApp() {
  const agents = new StaticAgentCoordinator();
  const engine = new GameEngine(new MemoryGameRepository(), agents);
  await engine.initialize();
  return { app: createApp(engine), engine, agents };
}

describe("game API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("returns the initial game state and health", async () => {
    const { app } = await testApp();
    const [health, game] = await Promise.all([
      request(app).get("/api/health"),
      request(app).get("/api/game"),
    ]);

    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(game.status).toBe(200);
    expect(game.body).toMatchObject({ revision: 0, status: "awaiting_suggestion" });
    expect(game.body.characters.haru.state.energy).toBe(70);
  });

  it("streams a complete turn, advances, and resets", async () => {
    const { app, agents } = await testApp();
    const characterSettings = getDefaultCharacterSettings();
    characterSettings.characters.haru.profile.name = "春";
    const turn = await request(app)
      .post("/api/game/turn")
      .send({
        suggestion: "一緒に夕食を作ってみたら？",
        idempotencyKey: "api-test-turn",
        revision: 0,
        characterSettings,
      });

    expect(turn.status).toBe(200);
    expect(turn.headers["content-type"]).toContain("text/event-stream");
    expect(turn.text).toContain("event: navigator.thinking");
    expect(turn.text).toContain("event: navigator.completed");
    expect(turn.text).toContain('"navigatorMessage":"デコピンが二人へきっかけを届けるね。"');
    expect(turn.text).toContain("event: agent.thinking");
    expect(turn.text).toContain("event: director.completed");
    expect(turn.text).toContain("event: turn.completed");
    expect(agents.inputs.haru?.character.profile.name).toBe("春");

    const resolved = await request(app).get("/api/game");
    expect(resolved.body.status).toBe("resolved");
    expect(resolved.body.shared.sharedMemories).toHaveLength(1);
    expect(resolved.body.navigator).toMatchObject({
      characterId: "navigator",
      characterName: "デコピン",
      eventDefinitionId: "shared-cooking",
    });
    expect(resolved.body.lastEvent.navigatorMessage).toBe("デコピンが二人へきっかけを届けるね。");

    const advanced = await request(app).post("/api/game/advance").send({});
    expect(advanced.status).toBe(200);
    expect(advanced.body).toMatchObject({ revision: 2, status: "awaiting_suggestion" });
    expect(advanced.body.shared.phase).toBe("afternoon");

    const reset = await request(app).post("/api/game/reset").send({ seed: "api-reset" });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ revision: 0, seed: "api-reset", status: "awaiting_suggestion" });
    expect(reset.body.shared.sharedMemories).toHaveLength(0);
  });

  it("routes a named Dekopin instruction through the navigator and keeps it after time advances", async () => {
    const { app, agents } = await testApp();
    const suggestion = "デコピン、二人で朝食を作るよう伝えて";

    const turn = await request(app)
      .post("/api/game/turn")
      .send({
        suggestion,
        idempotencyKey: "api-dekopin-instruction",
        revision: 0,
      });

    expect(turn.status).toBe(200);
    const navigatorThinkingIndex = turn.text.indexOf("event: navigator.thinking");
    const navigatorCompletedIndex = turn.text.indexOf("event: navigator.completed");
    const turnCompletedIndex = turn.text.indexOf("event: turn.completed");
    expect(navigatorThinkingIndex).toBeGreaterThanOrEqual(0);
    expect(navigatorCompletedIndex).toBeGreaterThanOrEqual(0);
    expect(turnCompletedIndex).toBeGreaterThanOrEqual(0);
    expect(navigatorThinkingIndex).toBeLessThan(navigatorCompletedIndex);
    expect(navigatorCompletedIndex).toBeLessThan(turnCompletedIndex);
    expect(agents.navigatorInput).toMatchObject({
      rawInput: suggestion,
      resolvedSuggestion: {
        eventDefinitionId: "easy-breakfast-prep",
        eventTitle: "簡単な朝食を用意する",
      },
    });

    const resolved = await request(app).get("/api/game");
    expect(resolved.body).toMatchObject({
      revision: 1,
      status: "resolved",
      navigator: {
        characterId: "navigator",
        characterName: "デコピン",
        eventDefinitionId: "easy-breakfast-prep",
        outcome: "selected",
      },
    });
    expect(resolved.body.eventLog.at(-1)).toMatchObject({
      suggestion,
      navigatorResponse: {
        characterName: "デコピン",
        eventDefinitionId: "easy-breakfast-prep",
      },
    });

    const advanced = await request(app).post("/api/game/advance").send({});
    expect(advanced.status).toBe(200);
    expect(advanced.body).toMatchObject({
      revision: 2,
      status: "awaiting_suggestion",
      shared: { day: 1, phase: "afternoon" },
      navigator: {
        characterName: "デコピン",
        eventDefinitionId: "easy-breakfast-prep",
      },
    });
  });

  it("rejects invalid and stale turn requests without changing state", async () => {
    const { app } = await testApp();

    expect((await request(app).post("/api/game/turn").send({})).status).toBe(400);
    const invalidSettings = getDefaultCharacterSettings();
    invalidSettings.characters.aoi.personality.initiative = 101;
    expect(
      (
        await request(app).post("/api/game/turn").send({
          suggestion: "映画を見よう",
          idempotencyKey: "invalid-settings",
          revision: 0,
          characterSettings: invalidSettings,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app).post("/api/game/turn").send({
          suggestion: "映画を見よう",
          idempotencyKey: "stale-api-turn",
          revision: 9,
        })
      ).status,
    ).toBe(409);

    const game = await request(app).get("/api/game");
    expect(game.body).toMatchObject({ revision: 0, status: "awaiting_suggestion" });
  });
});
