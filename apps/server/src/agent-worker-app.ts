import { createHash, timingSafeEqual } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import {
  autonomousActionCandidateSchema,
  characterDecisionSchema,
  characterDefinitionSchema,
  characterStateSchema,
  directorResolvedEventSchema,
  eventDefinitionSchema,
  memorySchema,
  navigatorAgentOutputSchema,
  phases,
  relationshipLabels,
  safeSuggestionSchema,
  type CharacterDecisionInput,
  type CharacterId,
  type DirectorInput,
  type NavigatorInput,
} from "@roommates/shared";
import type { AppServerAdapter } from "./agents/coordinator.js";
import {
  agentReflectionInputSchema,
  agentResultReflectionSchemaFor,
  type AgentReflectionInput,
} from "./agents/reflection.js";

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_IDEMPOTENCY_TTL_MS = 5 * 60_000;
const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 256;
const DEFAULT_MAX_CONCURRENT_INVOCATIONS = 8;
const DEFAULT_MAX_INVOCATIONS_PER_MINUTE = 60;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;

type AgentWorkerResult = { value: unknown; threadId: string };

/**
 * The process client owns one Codex App Server child. `scope` must isolate its
 * role threads by session so public game sessions never share model history.
 */
export interface AgentWorkerClient {
  ready(): Promise<void>;
  scope(sessionId: string): AppServerAdapter;
  shutdown(): Promise<void>;
}

export type AgentWorkerAppOptions = {
  client: AgentWorkerClient;
  token?: string;
  requireToken?: boolean;
  bodyLimitBytes?: number;
  idempotencyTtlMs?: number;
  idempotencyMaxEntries?: number;
  maxConcurrentInvocations?: number;
  maxInvocationsPerMinute?: number;
  rateLimitWindowMs?: number;
  now?: () => number;
};

type AgentWorkerAppRuntime = {
  app: express.Express;
  shutdown(): Promise<void>;
};

const shortText = z.string().trim().min(1).max(2_000);
const turnIdSchema = z.string().trim().min(1).max(200);
const sessionIdSchema = z.string().regex(SESSION_ID_PATTERN);
const scopeIdSchema = z.string().regex(SCOPE_ID_PATTERN);
const characterIdSchema = z.enum(["haru", "aoi"]);
const characterStateInputSchema = characterStateSchema.strict();
const memoryInputSchema = memorySchema.strict();
const sharedStateInputSchema = z
  .object({
    day: z.number().int().min(1).max(7),
    phase: z.enum(phases),
    relationshipLabel: z.enum(relationshipLabels),
    unresolvedConflicts: z.array(shortText).max(64),
    sharedMemories: z.array(memoryInputSchema).max(64),
  })
  .strict();
const gameSnapshotInputSchema = z
  .object({
    seed: z.string().min(1).max(2_000),
    revision: z.number().int().nonnegative(),
    characters: z
      .object({
        haru: characterStateInputSchema,
        aoi: characterStateInputSchema,
      })
      .strict(),
    shared: sharedStateInputSchema,
  })
  .strict();

const navigatorInputSchema = z
  .object({
    turnId: turnIdSchema,
    rawInput: z.string().max(500),
    day: z.number().int().min(1).max(7),
    phase: z.enum(phases),
    resolvedSuggestion: safeSuggestionSchema,
  })
  .strict();

const characterDecisionInputSchema = z
  .object({
    turnId: turnIdSchema,
    characterId: characterIdSchema,
    character: characterDefinitionSchema,
    snapshot: gameSnapshotInputSchema,
    self: characterStateInputSchema,
    otherKnownInfo: characterStateInputSchema
      .pick({ mood: true, location: true, currentGoal: true })
      .strict(),
    recentMemories: z.array(memoryInputSchema).max(5),
    importantMemories: z.array(memoryInputSchema).max(5),
    suggestion: safeSuggestionSchema,
    autonomousCandidates: z.array(autonomousActionCandidateSchema).max(6).optional(),
  })
  .strict();

const directorInputSchema = z
  .object({
    turnId: turnIdSchema,
    snapshot: gameSnapshotInputSchema,
    suggestion: safeSuggestionSchema,
    eventDefinition: eventDefinitionSchema.optional(),
    haruDecision: characterDecisionSchema,
    aoiDecision: characterDecisionSchema,
  })
  .strict();

const invokeRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      sessionId: sessionIdSchema,
      scopeId: scopeIdSchema.optional(),
      operation: z.literal("navigate"),
      input: navigatorInputSchema,
    })
    .strict(),
  z
    .object({
      sessionId: sessionIdSchema,
      scopeId: scopeIdSchema.optional(),
      operation: z.literal("decide"),
      characterId: characterIdSchema,
      input: characterDecisionInputSchema,
    })
    .strict(),
  z
    .object({
      sessionId: sessionIdSchema,
      scopeId: scopeIdSchema.optional(),
      operation: z.literal("resolve"),
      input: directorInputSchema,
    })
    .strict(),
  z
    .object({
      sessionId: sessionIdSchema,
      scopeId: scopeIdSchema.optional(),
      operation: z.literal("reflect"),
      characterId: characterIdSchema,
      input: agentReflectionInputSchema,
    })
    .strict(),
]);

type InvokeRequest = z.infer<typeof invokeRequestSchema>;

class PublicGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(publicMessage);
    this.name = "PublicGatewayError";
  }
}

type CacheEntry = {
  fingerprint: string;
  promise: Promise<AgentWorkerResult>;
  settled: boolean;
  expiresAt: number;
};

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().split("%", 1)[0];
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function sameToken(expectedDigest: Buffer, actual: string): boolean {
  return timingSafeEqual(expectedDigest, tokenDigest(actual));
}

function requestFingerprint(input: InvokeRequest): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function parseIdempotencyKey(request: Request): string | undefined {
  const value = request.get("Idempotency-Key");
  if (value === undefined) return undefined;
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new PublicGatewayError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key is invalid",
    );
  }
  return value;
}

function validateResult(
  result: { value: unknown; threadId: string },
  schema: { safeParse(value: unknown): { success: true; data: unknown } | { success: false } },
): AgentWorkerResult {
  if (
    typeof result.threadId !== "string" ||
    result.threadId.length < 1 ||
    result.threadId.length > 500
  ) {
    throw new PublicGatewayError(
      502,
      "INVALID_APP_SERVER_RESPONSE",
      "Agent runtime returned an invalid response",
    );
  }
  const parsed = schema.safeParse(result.value);
  if (!parsed.success) {
    throw new PublicGatewayError(
      502,
      "INVALID_APP_SERVER_RESPONSE",
      "Agent runtime returned an invalid response",
    );
  }
  return { value: parsed.data, threadId: result.threadId };
}

async function invokeScoped(
  client: AgentWorkerClient,
  request: InvokeRequest,
): Promise<AgentWorkerResult> {
  await client.ready();
  const scoped = client.scope(request.scopeId ?? request.sessionId);

  if (request.operation === "navigate") {
    if (!scoped.navigate) throw new Error("Navigator runtime is unavailable");
    const result = await scoped.navigate(request.input as NavigatorInput);
    return validateResult(result, navigatorAgentOutputSchema);
  }
  if (request.operation === "decide") {
    if (request.characterId !== request.input.characterId) {
      throw new PublicGatewayError(
        400,
        "CHARACTER_MISMATCH",
        "Character does not match the decision input",
      );
    }
    const result = await scoped.decide(
      request.characterId as CharacterId,
      request.input as CharacterDecisionInput,
    );
    return validateResult(result, characterDecisionSchema);
  }
  if (request.operation === "resolve") {
    const result = await scoped.resolve(request.input as DirectorInput);
    return validateResult(result, directorResolvedEventSchema);
  }
  if (request.characterId !== request.input.characterId) {
    throw new PublicGatewayError(
      400,
      "CHARACTER_MISMATCH",
      "Character does not match the reflection input",
    );
  }
  if (!scoped.reflect) throw new Error("Reflection runtime is unavailable");
  const input = request.input as AgentReflectionInput;
  const result = await scoped.reflect(request.characterId as CharacterId, input);
  return validateResult(result, agentResultReflectionSchemaFor(input));
}

export function createAgentWorkerApp(
  options: AgentWorkerAppOptions,
): AgentWorkerAppRuntime {
  if (options.requireToken && !options.token) {
    throw new Error("AGENT_WORKER_TOKEN is required");
  }
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const idempotencyTtlMs =
    options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  const idempotencyMaxEntries =
    options.idempotencyMaxEntries ?? DEFAULT_IDEMPOTENCY_MAX_ENTRIES;
  const maxConcurrentInvocations =
    options.maxConcurrentInvocations ?? DEFAULT_MAX_CONCURRENT_INVOCATIONS;
  const maxInvocationsPerMinute =
    options.maxInvocationsPerMinute ?? DEFAULT_MAX_INVOCATIONS_PER_MINUTE;
  const rateLimitWindowMs =
    options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  if (!Number.isSafeInteger(bodyLimitBytes) || bodyLimitBytes < 1) {
    throw new Error("bodyLimitBytes must be a positive integer");
  }
  if (!Number.isSafeInteger(idempotencyTtlMs) || idempotencyTtlMs < 1) {
    throw new Error("idempotencyTtlMs must be a positive integer");
  }
  if (
    !Number.isSafeInteger(idempotencyMaxEntries) ||
    idempotencyMaxEntries < 1
  ) {
    throw new Error("idempotencyMaxEntries must be a positive integer");
  }
  if (
    !Number.isSafeInteger(maxConcurrentInvocations) ||
    maxConcurrentInvocations < 1
  ) {
    throw new Error("maxConcurrentInvocations must be a positive integer");
  }
  if (
    !Number.isSafeInteger(maxInvocationsPerMinute) ||
    maxInvocationsPerMinute < 1
  ) {
    throw new Error("maxInvocationsPerMinute must be a positive integer");
  }
  if (!Number.isSafeInteger(rateLimitWindowMs) || rateLimitWindowMs < 1) {
    throw new Error("rateLimitWindowMs must be a positive integer");
  }

  const now = options.now ?? Date.now;
  const expectedTokenDigest = options.token
    ? tokenDigest(options.token)
    : undefined;
  const cache = new Map<string, CacheEntry>();
  let activeInvocations = 0;
  let rateLimitWindowStartedAt: number | undefined;
  let invocationsInRateLimitWindow = 0;
  const app = express();
  app.disable("x-powered-by");
  app.disable("trust proxy");

  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use((request, response, next) => {
    if (expectedTokenDigest) {
      const authorization = request.get("Authorization") ?? "";
      const prefix = "Bearer ";
      if (
        !authorization.startsWith(prefix) ||
        !sameToken(expectedTokenDigest, authorization.slice(prefix.length))
      ) {
        response.status(401).json({
          error: { code: "UNAUTHORIZED", message: "Unauthorized" },
        });
        return;
      }
      next();
      return;
    }

    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      response.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Unauthorized" },
      });
      return;
    }
    next();
  });

  app.use(express.json({ limit: bodyLimitBytes, strict: true }));

  app.get("/health", async (_request, response) => {
    try {
      await options.client.ready();
      response.json({ ok: true, service: "roommates-agent-worker" });
    } catch {
      response.status(503).json({
        ok: false,
        service: "roommates-agent-worker",
        error: { code: "APP_SERVER_UNAVAILABLE", message: "Agent runtime is unavailable" },
      });
    }
  });

  function removeExpiredEntries(): void {
    const current = now();
    for (const [key, entry] of cache) {
      if (entry.settled && entry.expiresAt <= current) cache.delete(key);
    }
  }

  function makeCacheRoom(): boolean {
    removeExpiredEntries();
    return cache.size < idempotencyMaxEntries;
  }

  function consumeInvocationRateLimit(): void {
    const current = now();
    if (
      rateLimitWindowStartedAt === undefined ||
      current < rateLimitWindowStartedAt ||
      current >= rateLimitWindowStartedAt + rateLimitWindowMs
    ) {
      rateLimitWindowStartedAt = current;
      invocationsInRateLimitWindow = 0;
    }
    if (invocationsInRateLimitWindow >= maxInvocationsPerMinute) {
      const remainingMs =
        rateLimitWindowStartedAt + rateLimitWindowMs - current;
      throw new PublicGatewayError(
        429,
        "RATE_LIMIT_EXCEEDED",
        "Agent runtime rate limit exceeded",
        Math.max(1, Math.ceil(remainingMs / 1_000)),
      );
    }
    invocationsInRateLimitWindow += 1;
  }

  async function invokeWithinCapacity(
    request: InvokeRequest,
  ): Promise<AgentWorkerResult> {
    if (activeInvocations >= maxConcurrentInvocations) {
      throw new PublicGatewayError(
        429,
        "TOO_MANY_INVOCATIONS",
        "Agent runtime is busy",
      );
    }
    // A process accepts one configured bearer token, so this single bucket is
    // both token-wide and process-wide. Cache hits never reach this point.
    consumeInvocationRateLimit();
    activeInvocations += 1;
    try {
      return await invokeScoped(options.client, request);
    } finally {
      activeInvocations -= 1;
    }
  }

  async function invokeIdempotently(
    request: InvokeRequest,
    idempotencyKey: string | undefined,
  ): Promise<AgentWorkerResult> {
    if (!idempotencyKey) return invokeWithinCapacity(request);

    const scopeId = request.scopeId ?? request.sessionId;
    const cacheKey = `${request.sessionId}\u0000${scopeId}\u0000${idempotencyKey}`;
    const fingerprint = requestFingerprint(request);
    removeExpiredEntries();
    const existing = cache.get(cacheKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new PublicGatewayError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used for a different request",
        );
      }
      return existing.promise;
    }

    if (!makeCacheRoom()) {
      throw new PublicGatewayError(
        503,
        "IDEMPOTENCY_CACHE_BUSY",
        "Agent runtime is busy",
      );
    }

    const entry: CacheEntry = {
      fingerprint,
      promise: Promise.resolve({ value: undefined, threadId: "" }),
      settled: false,
      expiresAt: Number.POSITIVE_INFINITY,
    };
    entry.promise = invokeWithinCapacity(request).then(
      (result) => {
        entry.settled = true;
        entry.expiresAt = now() + idempotencyTtlMs;
        return result;
      },
      (error: unknown) => {
        if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
        throw error;
      },
    );
    cache.set(cacheKey, entry);
    return entry.promise;
  }

  app.post("/v1/invoke", async (request, response) => {
    const parsed = invokeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: "INVALID_REQUEST", message: "Request body is invalid" },
      });
      return;
    }

    try {
      const idempotencyKey = parseIdempotencyKey(request);
      response.json(
        await invokeIdempotently(parsed.data as InvokeRequest, idempotencyKey),
      );
    } catch (error) {
      if (error instanceof PublicGatewayError) {
        if (error.status === 429) {
          response.setHeader(
            "Retry-After",
            String(error.retryAfterSeconds ?? 1),
          );
        }
        response.status(error.status).json({
          error: { code: error.code, message: error.publicMessage },
        });
        return;
      }
      // Do not expose App Server stderr, prompts, inputs, or credentials.
      response.status(503).json({
        error: {
          code: "APP_SERVER_UNAVAILABLE",
          message: "Agent runtime is unavailable",
        },
      });
    }
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      const typed = error as { type?: unknown; status?: unknown };
      if (typed.type === "entity.too.large" || typed.status === 413) {
        response.status(413).json({
          error: { code: "BODY_TOO_LARGE", message: "Request body is too large" },
        });
        return;
      }
      if (error instanceof SyntaxError) {
        response.status(400).json({
          error: { code: "INVALID_JSON", message: "Request body is invalid" },
        });
        return;
      }
      response.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      });
    },
  );

  return {
    app,
    async shutdown(): Promise<void> {
      cache.clear();
      await options.client.shutdown();
    },
  };
}
