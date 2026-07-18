import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { characterSettingsSchema, resetRequestSchema, turnRequestSchema, type StreamEvent } from "@roommates/shared";
import { config } from "./config.js";
import { GameConflictError, type GameEngine } from "./engine/game-engine.js";
import {
  PUBLIC_STREAM_ERROR_MESSAGE,
  toPublicGameState,
  toPublicStreamEvent,
} from "./public-dto.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "予期しないエラーが発生しました";
}

function sse(response: Response, event: StreamEvent): void {
  const publicEvent = toPublicStreamEvent(event);
  response.write(`event: ${publicEvent.type}\n`);
  response.write(`data: ${JSON.stringify(publicEvent)}\n\n`);
}

export function createApp(engine: GameEngine) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_request, response) => {
    const state = toPublicGameState(engine.getState());
    response.json({
      ok: true,
      agentMode: config.agentMode,
      runtime: state.runtime,
      day: state.shared.day,
      phase: state.shared.phase,
    });
  });

  app.get("/api/game", (_request, response) =>
    response.json(toPublicGameState(engine.getState())),
  );

  app.post("/api/game/turn", async (request, response) => {
    const parsed = turnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "提案データが正しくありません", details: parsed.error.flatten() });
      return;
    }
    const current = engine.getState();
    if (current.status !== "awaiting_suggestion" || current.revision !== parsed.data.revision) {
      response.status(409).json({ error: current.status === "resolving" ? "すでにターンを処理中です" : "ゲーム状態が更新されています" });
      return;
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 5_000);
    try {
      await engine.resolveTurn(
        parsed.data.suggestion,
        parsed.data.idempotencyKey,
        parsed.data.revision,
        (event) => sse(response, event),
        parsed.data.characterSettings,
      );
    } catch (error) {
      sse(response, { type: "error", message: PUBLIC_STREAM_ERROR_MESSAGE });
    } finally {
      clearInterval(heartbeat);
      response.end();
    }
  });

  app.post("/api/game/advance", async (_request, response, next) => {
    try {
      response.json(toPublicGameState(await engine.advance()));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/game/reset", async (request, response, next) => {
    const parsed = resetRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: "シード値が正しくありません" });
      return;
    }
    try {
      response.json(toPublicGameState(await engine.reset(parsed.data.seed)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/game/fast-forward", async (request, response, next) => {
    try {
      const turns = typeof request.body?.turns === "number" ? request.body.turns : 8;
      const parsedSettings = characterSettingsSchema.safeParse(request.body?.characterSettings);
      if (request.body?.characterSettings !== undefined && !parsedSettings.success) {
        response.status(400).json({ error: "個性設定が正しくありません" });
        return;
      }
      response.json(
        toPublicGameState(
          await engine.fastForward(
            turns,
            parsedSettings.success ? parsedSettings.data : undefined,
          ),
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  const webDist = resolve(process.cwd(), "apps/web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("/{*path}", (_request, response) => response.sendFile(resolve(webDist, "index.html")));
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = error instanceof GameConflictError ? 409 : 500;
    response.status(status).json({
      error: status === 409 ? errorMessage(error) : "サーバーでエラーが発生しました",
    });
  });

  return app;
}
