import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  CharacterDecision,
  CharacterDecisionInput,
  CharacterId,
  DirectorInput,
  ResolvedEvent,
} from "@roommates/shared";
import { createApp } from "../src/app.js";
import type { AgentCoordinator, AgentResult } from "../src/agents/coordinator.js";
import { GameEngine } from "../src/engine/game-engine.js";
import { MemoryGameRepository } from "../src/persistence/repository.js";
import { PUBLIC_STREAM_ERROR_MESSAGE } from "../src/public-dto.js";

const privateMarkers = [
  "PRIVATE_API_SUMMARY",
  "PRIVATE_API_THREAD",
  "PRIVATE_API_RUNTIME_ERROR",
];

class LeakyCoordinator implements AgentCoordinator {
  async decide(
    id: CharacterId,
    _input: CharacterDecisionInput,
  ): Promise<AgentResult<CharacterDecision>> {
    return {
      value: {
        decision: "ACCEPT",
        action: `${id}はテーブルにつく`,
        dialogue: "一緒に過ごそう。",
        publicReason: "落ち着いて話せそうだから",
        internalSummary: "PRIVATE_API_SUMMARY",
        expectedEffects: { trust: 2 },
      },
      runtime: {
        source: "app_server",
        latencyMs: 11,
        threadId: "PRIVATE_API_THREAD",
        error: "PRIVATE_API_RUNTIME_ERROR",
      },
    };
  }

  async resolve(_input: DirectorInput): Promise<AgentResult<ResolvedEvent>> {
    return {
      value: {
        eventTitle: "静かな夕食",
        narration: "二人は落ち着いて夕食を囲んだ。",
        haruDialogue: "温かいね。",
        aoiDialogue: "うん。",
        effects: {
          haru: { trust: 2, affection: 1 },
          aoi: { trust: 2, affection: 1 },
        },
        memory: {
          title: "静かな夕食",
          summary: "二人で夕食を囲んだ。",
          emotionalImpact: 2,
          importance: 3,
        },
      },
      runtime: {
        source: "app_server",
        latencyMs: 13,
        threadId: "PRIVATE_API_THREAD",
        error: "PRIVATE_API_RUNTIME_ERROR",
      },
    };
  }
}

class FailingCoordinator extends LeakyCoordinator {
  override async decide(): Promise<AgentResult<CharacterDecision>> {
    throw new Error("PRIVATE_UPSTREAM_ERROR /private/provider/path");
  }
}

async function appWith(coordinator: AgentCoordinator) {
  const engine = new GameEngine(new MemoryGameRepository(), coordinator);
  await engine.initialize();
  return createApp(engine);
}

describe("public API boundary", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("sanitizes game, health, state responses, and every streamed payload", async () => {
    const app = await appWith(new LeakyCoordinator());
    const turn = await request(app).post("/api/game/turn").send({
      suggestion: "一緒に夕食を作ってみたら？",
      idempotencyKey: "public-api-turn",
      revision: 0,
    });

    expect(turn.status).toBe(200);
    expect(turn.text).toContain("event: agent.completed");
    expect(turn.text).toContain("落ち着いて話せそうだから");
    for (const marker of privateMarkers) expect(turn.text).not.toContain(marker);
    expect(turn.text).not.toContain("internalSummary");
    expect(turn.text).not.toContain("expectedEffects");

    const [game, health, advanced] = await Promise.all([
      request(app).get("/api/game"),
      request(app).get("/api/health"),
      request(app).post("/api/game/advance").send({}),
    ]);

    expect(game.status).toBe(200);
    expect(game.body.characters.haru.lastDecision).toEqual({
      decision: "ACCEPT",
      action: "Haruはテーブルにつく",
      dialogue: "一緒に過ごそう。",
      publicReason: "落ち着いて話せそうだから",
    });
    expect(game.body.runtime.haru).toEqual({ source: "app_server", latencyMs: 11 });
    expect(health.body.runtime.haru).toEqual({ source: "app_server", latencyMs: 11 });
    expect(advanced.status).toBe(200);
    for (const response of [game, health, advanced]) {
      const serialized = JSON.stringify(response.body);
      for (const marker of privateMarkers) expect(serialized).not.toContain(marker);
    }

    const fastForwarded = await request(app)
      .post("/api/game/fast-forward")
      .send({ turns: 1 });
    expect(fastForwarded.status).toBe(200);
    for (const marker of privateMarkers) {
      expect(JSON.stringify(fastForwarded.body)).not.toContain(marker);
    }

    const reset = await request(app).post("/api/game/reset").send({ seed: "safe-reset" });
    expect(reset.status).toBe(200);
    expect(reset.body.seed).toBe("safe-reset");
  });

  it("never sends a caught raw error through SSE", async () => {
    const app = await appWith(new FailingCoordinator());
    const turn = await request(app).post("/api/game/turn").send({
      suggestion: "映画を見よう",
      idempotencyKey: "failing-public-api-turn",
      revision: 0,
    });

    expect(turn.status).toBe(200);
    expect(turn.text).toContain("event: error");
    expect(turn.text).toContain(PUBLIC_STREAM_ERROR_MESSAGE);
    expect(turn.text).not.toContain("PRIVATE_UPSTREAM_ERROR");
    expect(turn.text).not.toContain("/private/provider/path");
  });
});
