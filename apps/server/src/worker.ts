/// <reference types="@cloudflare/workers-types" />

import {
  createInitialGameState,
  resetRequestSchema,
  turnRequestSchema,
  type GameState,
  type StreamEvent,
} from "@roommates/shared";
import { ResilientAgentCoordinator } from "./agents/coordinator.js";
import { GameConflictError, GameEngine } from "./engine/game-engine.js";
import {
  D1GameRepository,
  D1OptimisticConflictError,
  type D1DatabaseBinding,
} from "./persistence/d1-repository.js";

export interface Env {
  DB: D1DatabaseBinding;
  ASSETS: Pick<Fetcher, "fetch">;
}

const SESSION_COOKIE = "roommates_session";
const MAX_BODY_BYTES = 32 * 1024;
export const WORKER_STATE_LEASE_MS = 60_000;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SessionWorkKind = "mutation" | "result";
type SessionWork = { token: symbol; kind: SessionWorkKind };

// Advisory same-isolate guard only. D1's optimistic db_version remains the
// cross-isolate source of truth; no request-owned Promise or I/O object is shared.
const activeSessionWork = new Map<string, SessionWork>();

function acquireSessionWork(
  sessionId: string,
  kind: SessionWorkKind,
): (() => void) | undefined {
  if (activeSessionWork.has(sessionId)) return undefined;
  const token = Symbol(sessionId);
  activeSessionWork.set(sessionId, { token, kind });
  return () => {
    if (activeSessionWork.get(sessionId)?.token === token) {
      activeSessionWork.delete(sessionId);
    }
  };
}

function sessionHasActiveWork(sessionId: string): boolean {
  return activeSessionWork.has(sessionId);
}

class InvalidJsonBodyError extends Error {
  constructor() {
    super("リクエストデータが正しくありません");
    this.name = "InvalidJsonBodyError";
  }
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("リクエストデータが大きすぎます");
    this.name = "RequestBodyTooLargeError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "予期しないエラーが発生しました";
}

function cookieValue(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return SESSION_ID_PATTERN.test(value) ? value : undefined;
  }
  return undefined;
}

function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}

function responseHeaders(sessionId: string, contentType: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Set-Cookie", sessionCookie(sessionId));
  return headers;
}

function jsonResponse(body: unknown, sessionId: string, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(sessionId, "application/json; charset=utf-8"),
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    if (!text) return {};
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    throw new InvalidJsonBodyError();
  }
}

function createEngine(repository: D1GameRepository): GameEngine {
  const agents = new ResilientAgentCoordinator("mock", 15_000);
  return new GameEngine(repository, agents);
}

async function latestState(
  database: D1DatabaseBinding,
  sessionId: string,
  fallback: GameState,
): Promise<GameState> {
  return (await new D1GameRepository(database, sessionId).load()) ?? fallback;
}

export async function stateForRead(
  database: D1DatabaseBinding,
  sessionId: string,
  now = Date.now(),
): Promise<GameState> {
  const repository = new D1GameRepository(database, sessionId);
  const stored = await repository.load();

  if (stored?.status === "resolving") {
    if (
      sessionHasActiveWork(sessionId) ||
      !repository.isStale(now, WORKER_STATE_LEASE_MS)
    ) {
      return stored;
    }
  } else if (
    stored?.status === "ended" &&
    stored.result?.status === "generating" &&
    (sessionHasActiveWork(sessionId) ||
      !repository.isStale(now, WORKER_STATE_LEASE_MS))
  ) {
    return stored;
  } else if (
    stored &&
    !(
      stored.status === "ended" &&
      stored.ending &&
      (!stored.result || stored.result.status === "generating")
    )
  ) {
    return stored;
  }

  const release = acquireSessionWork(sessionId, "result");
  if (!release) return stored ?? createInitialWorkerState();

  try {
    const engine = createEngine(repository);
    await engine.initialize();
    const initialized = engine.getState();
    if (stored?.status === "resolving" && initialized.status !== "resolving") {
      await repository.save(initialized);
    }
    return await latestState(database, sessionId, initialized);
  } catch (error) {
    if (error instanceof D1OptimisticConflictError) {
      const latest = await new D1GameRepository(database, sessionId).load();
      if (latest) return latest;
    }
    throw error;
  } finally {
    release();
  }
}

function createInitialWorkerState(): GameState {
  return createInitialGameState("demo-heart");
}

type PreparedMutation = {
  engine: GameEngine;
  release: () => void;
};

async function engineForMutation(
  database: D1DatabaseBinding,
  sessionId: string,
  resolvingMessage: string,
  now = Date.now(),
): Promise<PreparedMutation> {
  const release = acquireSessionWork(sessionId, "mutation");
  if (!release) throw new GameConflictError(resolvingMessage);

  const repository = new D1GameRepository(database, sessionId);
  try {
    const stored = await repository.load();
    if (
      (stored?.status === "resolving" || stored?.result?.status === "generating") &&
      !repository.isStale(now, WORKER_STATE_LEASE_MS)
    ) {
      throw new GameConflictError(resolvingMessage);
    }

    const engine = createEngine(repository);
    await engine.initialize();
    const initialized = engine.getState();
    if (stored?.status === "resolving" && initialized.status !== "resolving") {
      await repository.save(initialized);
    }
    return { engine, release };
  } catch (error) {
    release();
    throw error;
  }
}

function encodeSse(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

function streamTurn(
  engine: GameEngine,
  input: { suggestion: string; idempotencyKey: string; revision: number },
  sessionId: string,
  context: ExecutionContext,
  releaseSession: () => void,
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let writeQueue: Promise<void> = Promise.resolve();

  const emit = (event: StreamEvent): void => {
    writeQueue = writeQueue
      .then(() => writer.write(encodeSse(event)))
      .catch(() => undefined);
  };

  const streamTask = (async (): Promise<void> => {
    try {
      await engine.resolveTurn(
        input.suggestion,
        input.idempotencyKey,
        input.revision,
        emit,
      );
    } catch (error) {
      emit({ type: "error", message: errorMessage(error) });
    } finally {
      await writeQueue;
      try {
        await writer.close();
      } catch {
        // The browser may have disconnected while the turn was resolving.
      }
      releaseSession();
    }
  })();

  context.waitUntil(streamTask);
  const headers = responseHeaders(sessionId, "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  return new Response(readable, { status: 200, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function handleApi(
  request: Request,
  env: Env,
  context: ExecutionContext,
  sessionId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

  if (request.method === "GET" && path === "/api/health") {
    const state = await stateForRead(env.DB, sessionId);
    return jsonResponse(
      {
        ok: true,
        agentMode: "mock",
        runtime: state.runtime,
        day: state.shared.day,
        phase: state.shared.phase,
      },
      sessionId,
    );
  }

  if (request.method === "GET" && path === "/api/game") {
    return jsonResponse(await stateForRead(env.DB, sessionId), sessionId);
  }

  if (request.method === "POST" && path === "/api/game/turn") {
    const parsed = turnRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonResponse(
        {
          error: "提案データが正しくありません",
          details: parsed.error.flatten(),
        },
        sessionId,
        400,
      );
    }

    const prepared = await engineForMutation(
      env.DB,
      sessionId,
      "すでにターンを処理中です",
    );
    const { engine, release } = prepared;
    const current = engine.getState();
    if (current.status !== "awaiting_suggestion" || current.revision !== parsed.data.revision) {
      release();
      return jsonResponse(
        {
          error:
            current.status === "resolving"
              ? "すでにターンを処理中です"
              : "ゲーム状態が更新されています",
        },
        sessionId,
        409,
      );
    }

    try {
      return streamTurn(engine, parsed.data, sessionId, context, release);
    } catch (error) {
      release();
      throw error;
    }
  }

  if (request.method === "POST" && path === "/api/game/advance") {
    const { engine, release } = await engineForMutation(
      env.DB,
      sessionId,
      "ターン処理中です",
    );
    try {
      return jsonResponse(await engine.advance(), sessionId);
    } finally {
      release();
    }
  }

  if (request.method === "POST" && path === "/api/game/reset") {
    const parsed = resetRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return jsonResponse({ error: "シード値が正しくありません" }, sessionId, 400);
    }
    const { engine, release } = await engineForMutation(
      env.DB,
      sessionId,
      "ターン処理中はリセットできません",
    );
    try {
      return jsonResponse(await engine.reset(parsed.data.seed), sessionId);
    } finally {
      release();
    }
  }

  if (request.method === "POST" && path === "/api/game/fast-forward") {
    const body = await readJsonBody(request);
    const turns = isRecord(body) && typeof body.turns === "number" ? body.turns : 8;
    const { engine, release } = await engineForMutation(
      env.DB,
      sessionId,
      "すでにターンを処理中です",
    );
    try {
      return jsonResponse(await engine.fastForward(turns), sessionId);
    } finally {
      release();
    }
  }

  return jsonResponse({ error: "Not found" }, sessionId, 404);
}

async function serveStaticAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const acceptsHtml = request.headers.get("Accept")?.includes("text/html") ?? false;
  if (response.status !== 404 || request.method !== "GET" || !acceptsHtml) {
    return response;
  }

  await response.body?.cancel();
  const indexUrl = new URL(request.url);
  indexUrl.pathname = "/index.html";
  indexUrl.search = "";
  return env.ASSETS.fetch(new Request(indexUrl.toString(), request));
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return serveStaticAsset(request, env);

    const sessionId = cookieValue(request.headers.get("Cookie")) ?? crypto.randomUUID();
    try {
      return await handleApi(request, env, context, sessionId);
    } catch (error) {
      const status =
        error instanceof GameConflictError || error instanceof D1OptimisticConflictError
          ? 409
          : error instanceof RequestBodyTooLargeError
            ? 413
            : error instanceof InvalidJsonBodyError
              ? 400
              : 500;
      if (status === 500) {
        console.error(
          JSON.stringify({
            message: "ROOMMATES Worker request failed",
            error: errorMessage(error),
            path: url.pathname,
          }),
        );
      }
      return jsonResponse({ error: errorMessage(error) }, sessionId, status);
    }
  },
} satisfies ExportedHandler<Env>;
