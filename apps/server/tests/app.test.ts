import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { GameEngine } from "../src/engine/game-engine.js";
import { MemoryGameRepository } from "../src/persistence/repository.js";
import { StaticAgentCoordinator } from "./helpers.js";

async function testApp() {
  const engine = new GameEngine(new MemoryGameRepository(), new StaticAgentCoordinator());
  await engine.initialize();
  return { app: createApp(engine), engine };
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
    const { app } = await testApp();
    const turn = await request(app)
      .post("/api/game/turn")
      .send({
        suggestion: "一緒に夕食を作ってみたら？",
        idempotencyKey: "api-test-turn",
        revision: 0,
      });

    expect(turn.status).toBe(200);
    expect(turn.headers["content-type"]).toContain("text/event-stream");
    expect(turn.text).toContain("event: navigator.thinking");
    expect(turn.text).toContain("event: navigator.completed");
    expect(turn.text).toContain('"navigatorMessage":"デコピンが二人へきっかけを届けるね。"');
    expect(turn.text).toContain("event: agent.thinking");
    expect(turn.text).toContain("event: director.completed");
    expect(turn.text).toContain("event: turn.completed");

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

  it("rejects invalid and stale turn requests without changing state", async () => {
    const { app } = await testApp();

    expect((await request(app).post("/api/game/turn").send({})).status).toBe(400);
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
