/// <reference types="@cloudflare/workers-types" />

import {
  characterSettingsSchema,
  createInitialGameState,
  resetRequestSchema,
  turnRequestSchema,
  type CharacterSettings,
  type GameState,
  type StreamEvent,
} from "@roommates/shared";
import { AgentWorkerClient } from "./agents/app-server/remote-client.js";
import { ResilientAgentCoordinator } from "./agents/coordinator.js";
import {
  DEFAULT_OPENAI_RESPONSES_MODEL,
  DEFAULT_OPENAI_RESPONSES_TIMEOUT_MS,
  MAX_OPENAI_RESPONSES_TIMEOUT_MS,
  MIN_OPENAI_RESPONSES_TIMEOUT_MS,
  OpenAIResponsesClient,
} from "./agents/openai/responses-client.js";
import {
  ProviderCascadeAdapter,
  type ProviderFailureDiagnostic,
} from "./agents/provider-cascade.js";
import { GameConflictError, GameEngine } from "./engine/game-engine.js";
import {
  D1GameRepository,
  D1OptimisticConflictError,
  type D1DatabaseBinding,
} from "./persistence/d1-repository.js";
import {
  PUBLIC_STREAM_ERROR_MESSAGE,
  toPublicGameState,
  toPublicStreamEvent,
} from "./public-dto.js";

export interface Env {
  DB: D1DatabaseBinding;
  ASSETS: Pick<Fetcher, "fetch">;
  AGENT_WORKER_URL?: string;
  AGENT_WORKER_TOKEN?: string;
  AGENT_WORKER_TIMEOUT_MS?: string;
  AGENT_WORKER_PROBE_TIMEOUT_MS?: string;
  OPENAI_API_KEY?: string;
  OPENAI_API_MODEL?: string;
  OPENAI_API_TIMEOUT_MS?: string;
}

export type AgentWorkerEnv = Pick<
  Env,
  | "AGENT_WORKER_URL"
  | "AGENT_WORKER_TOKEN"
  | "AGENT_WORKER_TIMEOUT_MS"
  | "AGENT_WORKER_PROBE_TIMEOUT_MS"
  | "OPENAI_API_KEY"
  | "OPENAI_API_MODEL"
  | "OPENAI_API_TIMEOUT_MS"
>;

const SESSION_COOKIE = "roommates_session";
const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_AGENT_WORKER_TIMEOUT_MS = 60_000;
const MIN_AGENT_WORKER_TIMEOUT_MS = 1_000;
const MAX_AGENT_WORKER_TIMEOUT_MS = 120_000;
const DEFAULT_AGENT_WORKER_PROBE_TIMEOUT_MS = 2_000;
const MIN_AGENT_WORKER_PROBE_TIMEOUT_MS = 250;
const MAX_AGENT_WORKER_PROBE_TIMEOUT_MS = 10_000;
const AGENT_WORKER_COORDINATOR_TIMEOUT_GRACE_MS = 5_000;
const OPENAI_API_MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const MAX_AGENT_WORKER_ATTEMPTS_PER_OPERATION = 2;
// Navigator, Haru, Aoi, and director are the four remote operations that may
// run between persisted checkpoints. Count them conservatively as sequential
// even though character decisions currently run in parallel.
const MAX_AGENT_WORKER_OPERATIONS_PER_CHECKPOINT = 4;
const MAX_AGENT_PROVIDER_COORDINATOR_TIMEOUT_MS =
  MAX_AGENT_WORKER_TIMEOUT_MS +
  MAX_AGENT_WORKER_PROBE_TIMEOUT_MS +
  MAX_OPENAI_RESPONSES_TIMEOUT_MS +
  AGENT_WORKER_COORDINATOR_TIMEOUT_GRACE_MS;
export const MAX_WORKER_AGENT_CHECKPOINT_BUDGET_MS =
  MAX_AGENT_PROVIDER_COORDINATOR_TIMEOUT_MS *
  MAX_AGENT_WORKER_ATTEMPTS_PER_OPERATION *
  MAX_AGENT_WORKER_OPERATIONS_PER_CHECKPOINT;
const MIN_WORKER_STATE_LEASE_MS = 20 * 60_000;
const WORKER_STATE_LEASE_SAFETY_MARGIN_MS = 60_000;
// A cross-isolate reader must never reclaim a legitimate remote turn while it
// is still within the maximum supported operation budget.
export const WORKER_STATE_LEASE_MS = Math.max(
  MIN_WORKER_STATE_LEASE_MS,
  MAX_WORKER_AGENT_CHECKPOINT_BUDGET_MS + WORKER_STATE_LEASE_SAFETY_MARGIN_MS,
);
export const SSE_KEEPALIVE_INTERVAL_MS = 15_000;
const SSE_KEEPALIVE_BYTES = new TextEncoder().encode(": keepalive\n\n");
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

function configuredAgentWorkerUrl(env?: AgentWorkerEnv): string | undefined {
  const value = env?.AGENT_WORKER_URL?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1";
    if (url.protocol === "http:" && !loopback) return undefined;
    if (!loopback && !env?.AGENT_WORKER_TOKEN?.trim()) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function configuredOpenAiApiKey(env?: AgentWorkerEnv): string | undefined {
  const value = env?.OPENAI_API_KEY?.trim();
  if (!value || value.length > 512 || /[\s\u0000-\u001f\u007f]/.test(value)) {
    return undefined;
  }
  return value;
}

export function workerAgentWorkerConfigured(env?: AgentWorkerEnv): boolean {
  return configuredAgentWorkerUrl(env) !== undefined;
}

export function workerOpenAiApiConfigured(env?: AgentWorkerEnv): boolean {
  return configuredOpenAiApiKey(env) !== undefined;
}

export function workerAgentMode(env?: AgentWorkerEnv): "auto" | "mock" {
  return workerAgentWorkerConfigured(env) || workerOpenAiApiConfigured(env)
    ? "auto"
    : "mock";
}

export function workerAgentTimeoutMs(env?: AgentWorkerEnv): number {
  const raw = env?.AGENT_WORKER_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_AGENT_WORKER_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_AGENT_WORKER_TIMEOUT_MS;
  return Math.min(
    MAX_AGENT_WORKER_TIMEOUT_MS,
    Math.max(MIN_AGENT_WORKER_TIMEOUT_MS, Math.trunc(parsed)),
  );
}

export function workerAgentProbeTimeoutMs(env?: AgentWorkerEnv): number {
  const raw = env?.AGENT_WORKER_PROBE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_AGENT_WORKER_PROBE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_AGENT_WORKER_PROBE_TIMEOUT_MS;
  return Math.min(
    MAX_AGENT_WORKER_PROBE_TIMEOUT_MS,
    Math.max(MIN_AGENT_WORKER_PROBE_TIMEOUT_MS, Math.trunc(parsed)),
  );
}

export function workerOpenAiApiModel(env?: AgentWorkerEnv): string {
  const value = env?.OPENAI_API_MODEL?.trim();
  return value && OPENAI_API_MODEL_PATTERN.test(value)
    ? value
    : DEFAULT_OPENAI_RESPONSES_MODEL;
}

export function workerOpenAiApiTimeoutMs(env?: AgentWorkerEnv): number {
  const raw = env?.OPENAI_API_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_OPENAI_RESPONSES_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_OPENAI_RESPONSES_TIMEOUT_MS;
  return Math.min(
    MAX_OPENAI_RESPONSES_TIMEOUT_MS,
    Math.max(MIN_OPENAI_RESPONSES_TIMEOUT_MS, Math.trunc(parsed)),
  );
}

export function workerAgentCoordinatorTimeoutMs(env?: AgentWorkerEnv): number {
  return (
    workerAgentTimeoutMs(env) +
    workerAgentProbeTimeoutMs(env) +
    (workerOpenAiApiConfigured(env) ? workerOpenAiApiTimeoutMs(env) : 0) +
    AGENT_WORKER_COORDINATOR_TIMEOUT_GRACE_MS
  );
}

export function createWorkerAgentCoordinator(
  sessionId: string,
  env?: AgentWorkerEnv,
  fetchImpl?: typeof fetch,
  agentEpoch = 0,
): ResilientAgentCoordinator {
  const baseUrl = configuredAgentWorkerUrl(env);
  const openAiApiKey = configuredOpenAiApiKey(env);
  const timeoutMs = workerAgentTimeoutMs(env);
  const probeTimeoutMs = workerAgentProbeTimeoutMs(env);
  const remote = baseUrl
    ? new AgentWorkerClient({
        baseUrl,
        sessionId,
        scopeId: `${sessionId}:${agentEpoch}`,
        token: env?.AGENT_WORKER_TOKEN,
        timeoutMs,
        probeTimeoutMs,
        fetchImpl,
      })
    : undefined;
  const openAi = openAiApiKey
    ? new OpenAIResponsesClient({
        apiKey: openAiApiKey,
        model: workerOpenAiApiModel(env),
        timeoutMs: workerOpenAiApiTimeoutMs(env),
        fetchImpl,
      }).scope(`${sessionId}:${agentEpoch}`)
    : undefined;
  const providers = [
    ...(remote ? [{ source: "app_server" as const, adapter: remote }] : []),
    ...(openAi ? [{ source: "openai_api" as const, adapter: openAi }] : []),
  ];
  const logProviderFailure = (diagnostic: ProviderFailureDiagnostic): void => {
    console.warn(
      JSON.stringify({
        message: "ROOMMATES agent provider failed",
        ...diagnostic,
      }),
    );
  };
  const cascade =
    providers.length > 0
      ? new ProviderCascadeAdapter(providers, logProviderFailure)
      : undefined;
  return new ResilientAgentCoordinator(
    cascade ? "auto" : "mock",
    workerAgentCoordinatorTimeoutMs(env),
    cascade,
  );
}

function createEngine(
  repository: D1GameRepository,
  sessionId: string,
  env?: AgentWorkerEnv,
  agentEpoch = 0,
): GameEngine {
  const agents = createWorkerAgentCoordinator(
    sessionId,
    env,
    undefined,
    agentEpoch,
  );
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
  agentEnv?: AgentWorkerEnv,
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
    const engine = createEngine(
      repository,
      sessionId,
      agentEnv,
      stored?.agentEpoch ?? 0,
    );
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

export async function stateForHealth(
  database: D1DatabaseBinding,
  sessionId: string,
): Promise<GameState> {
  return (
    (await new D1GameRepository(database, sessionId).load()) ??
    createInitialWorkerState()
  );
}

type PreparedMutation = {
  engine: GameEngine;
  release: () => void;
};

async function engineForMutation(
  database: D1DatabaseBinding,
  sessionId: string,
  resolvingMessage: string,
  agentEnv?: AgentWorkerEnv,
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

    const engine = createEngine(
      repository,
      sessionId,
      agentEnv,
      stored?.agentEpoch ?? 0,
    );
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
  const publicEvent = toPublicStreamEvent(event);
  return new TextEncoder().encode(
    `event: ${publicEvent.type}\ndata: ${JSON.stringify(publicEvent)}\n\n`,
  );
}

/** @internal Exported to keep the Worker timer behavior directly testable. */
export function startWorkerSseKeepalive(
  enqueue: (bytes: Uint8Array) => void,
): () => void {
  const timer = setInterval(() => {
    enqueue(SSE_KEEPALIVE_BYTES);
  }, SSE_KEEPALIVE_INTERVAL_MS);
  return () => clearInterval(timer);
}

function streamTurn(
  engine: GameEngine,
  input: {
    suggestion: string;
    idempotencyKey: string;
    revision: number;
    characterSettings?: CharacterSettings;
  },
  sessionId: string,
  context: ExecutionContext,
  releaseSession: () => void,
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let writeQueue: Promise<void> = Promise.resolve();

  const enqueue = (bytes: Uint8Array): void => {
    writeQueue = writeQueue
      .then(() => writer.write(bytes))
      .catch(() => undefined);
  };
  const emit = (event: StreamEvent): void => enqueue(encodeSse(event));
  const stopKeepalive = startWorkerSseKeepalive(enqueue);

  const streamTask = (async (): Promise<void> => {
    try {
      await engine.resolveTurn(
        input.suggestion,
        input.idempotencyKey,
        input.revision,
        emit,
        input.characterSettings,
      );
    } catch (error) {
      emit({ type: "error", message: PUBLIC_STREAM_ERROR_MESSAGE });
    } finally {
      stopKeepalive();
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
    const state = await stateForHealth(env.DB, sessionId);
    return jsonResponse(
      {
        ok: true,
        agentMode: workerAgentMode(env),
        agentWorkerConfigured: workerAgentWorkerConfigured(env),
        openaiApiConfigured: workerOpenAiApiConfigured(env),
        runtime: toPublicGameState(state).runtime,
        day: state.shared.day,
        phase: state.shared.phase,
      },
      sessionId,
    );
  }

  if (request.method === "GET" && path === "/api/game") {
    return jsonResponse(
      toPublicGameState(await stateForRead(env.DB, sessionId, Date.now(), env)),
      sessionId,
    );
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
      env,
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
      env,
    );
    try {
      return jsonResponse(toPublicGameState(await engine.advance()), sessionId);
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
      env,
    );
    try {
      return jsonResponse(
        toPublicGameState(await engine.reset(parsed.data.seed)),
        sessionId,
      );
    } finally {
      release();
    }
  }

  if (request.method === "POST" && path === "/api/game/fast-forward") {
    const body = await readJsonBody(request);
    const turns = isRecord(body) && typeof body.turns === "number" ? body.turns : 8;
    const settingsInput = isRecord(body) ? body.characterSettings : undefined;
    const parsedSettings = characterSettingsSchema.safeParse(settingsInput);
    if (settingsInput !== undefined && !parsedSettings.success) {
      return jsonResponse({ error: "個性設定が正しくありません" }, sessionId, 400);
    }
    const { engine, release } = await engineForMutation(
      env.DB,
      sessionId,
      "すでにターンを処理中です",
      env,
    );
    try {
      return jsonResponse(
        toPublicGameState(
          await engine.fastForward(
            turns,
            parsedSettings.success ? parsedSettings.data : undefined,
          ),
        ),
        sessionId,
      );
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
      return jsonResponse(
        {
          error:
            status === 500
              ? "サーバーでエラーが発生しました"
              : errorMessage(error),
        },
        sessionId,
        status,
      );
    }
  },
} satisfies ExportedHandler<Env>;
