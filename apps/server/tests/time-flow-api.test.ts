import request from "supertest";
import { describe, expect, it } from "vitest";
import { getDefaultCharacterSettings } from "@roommates/shared";
import { createApp } from "../src/app.js";
import { GameEngine } from "../src/engine/game-engine.js";
import { MemoryGameRepository } from "../src/persistence/repository.js";
import { StaticAgentCoordinator } from "./helpers.js";

async function timeFlowApp() {
  const agents = new StaticAgentCoordinator();
  const engine = new GameEngine(new MemoryGameRepository(), agents);
  await engine.initialize();
  return { app: createApp(engine), agents };
}

describe("time progression API", () => {
  it("rejects advance before a turn, then advances exactly one phase", async () => {
    const { app } = await timeFlowApp();

    const tooEarly = await request(app).post("/api/game/advance").send({});
    expect(tooEarly.status).toBe(409);

    const fastForwarded = await request(app)
      .post("/api/game/fast-forward")
      .send({ turns: 1 });
    expect(fastForwarded.status).toBe(200);
    expect(fastForwarded.body).toMatchObject({
      revision: 1,
      status: "resolved",
      shared: { day: 1, phase: "morning" },
    });
    expect(fastForwarded.body.eventLog).toHaveLength(1);
    expect(fastForwarded.body.eventLog[0].inputMethod).toBe("fast_forward");

    const advanced = await request(app).post("/api/game/advance").send({});
    expect(advanced.status).toBe(200);
    expect(advanced.body).toMatchObject({
      revision: 2,
      status: "awaiting_suggestion",
      shared: { day: 1, phase: "afternoon" },
    });
    expect(advanced.body.eventLog).toHaveLength(1);
  });

  it("runs the default eight-turn skip and preserves personality settings", async () => {
    const { app, agents } = await timeFlowApp();
    const characterSettings = getDefaultCharacterSettings();
    characterSettings.characters.haru.profile.name = "時間経過テストの春";
    characterSettings.characters.aoi.personality.initiative = 3;

    const skipped = await request(app)
      .post("/api/game/fast-forward")
      .send({ characterSettings });

    expect(skipped.status).toBe(200);
    expect(skipped.body).toMatchObject({
      revision: 15,
      status: "resolved",
      shared: { day: 2, phase: "night" },
    });
    expect(skipped.body.eventLog).toHaveLength(8);
    expect(
      skipped.body.eventLog.every(
        (entry: { inputMethod?: string }) => entry.inputMethod === "fast_forward",
      ),
    ).toBe(true);
    expect(agents.inputs.haru?.character.profile.name).toBe("時間経過テストの春");
    expect(agents.inputs.aoi?.character.personality.initiative).toBe(3);
  });

  it("allows only one response to win when advance is double-submitted", async () => {
    const { app } = await timeFlowApp();
    await request(app).post("/api/game/fast-forward").send({ turns: 1 });

    const responses = await Promise.all([
      request(app).post("/api/game/advance").send({}),
      request(app).post("/api/game/advance").send({}),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const state = await request(app).get("/api/game");
    expect(state.body).toMatchObject({
      revision: 2,
      status: "awaiting_suggestion",
      shared: { day: 1, phase: "afternoon" },
    });
  });
});
