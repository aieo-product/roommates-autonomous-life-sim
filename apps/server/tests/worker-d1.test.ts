import { describe, expect, it } from "vitest";
import {
  createInitialGameState,
  gameStateSchema,
  type Ending,
  type GameResult,
  type GameState,
} from "@roommates/shared";
import {
  buildProducerResult,
  PRODUCER_SCORING_VERSION,
  RESULT_NARRATIVE_VERSION,
} from "../src/engine/result/index.js";
import { REFLECTION_VERSION } from "../src/agents/reflection.js";
import {
  D1GameRepository,
  D1OptimisticConflictError,
  type D1DatabaseBinding,
  type D1RunResult,
  type D1SessionBinding,
  type D1StatementBinding,
} from "../src/persistence/d1-repository.js";
import worker, {
  MAX_WORKER_AGENT_CHECKPOINT_BUDGET_MS,
  SSE_KEEPALIVE_INTERVAL_MS,
  stateForRead,
  stateForHealth,
  WORKER_STATE_LEASE_MS,
  workerAgentCoordinatorTimeoutMs,
  workerAgentMode,
  workerAgentProbeTimeoutMs,
  workerAgentWorkerConfigured,
  workerAgentTimeoutMs,
  workerOpenAiApiConfigured,
  workerOpenAiApiModel,
  workerOpenAiApiTimeoutMs,
} from "../src/worker.js";

type StoredRow = {
  state: string;
  db_version: number;
  created_at: number;
  updated_at: number;
};

type UpdateGate = {
  started: Promise<void>;
  notifyStarted: () => void;
  release: () => void;
  waitForRelease: Promise<void>;
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeD1Database implements D1DatabaseBinding {
  private readonly rows = new Map<string, StoredRow>();
  private readonly blockedUpdates = new Map<string, UpdateGate>();
  readonly updateAttempts = new Map<string, number>();

  withSession(_constraint: "first-primary"): D1SessionBinding {
    return new FakeD1Session(this);
  }

  seed(sessionId: string, state: GameState, dbVersion: number, updatedAt: number): void {
    this.rows.set(sessionId, {
      state: JSON.stringify(state),
      db_version: dbVersion,
      created_at: updatedAt,
      updated_at: updatedAt,
    });
  }

  readState(sessionId: string): GameState | undefined {
    const row = this.rows.get(sessionId);
    return row
      ? (gameStateSchema.parse(JSON.parse(row.state)) as GameState)
      : undefined;
  }

  blockNextUpdate(sessionId: string): UpdateGate {
    const started = deferred();
    const released = deferred();
    const gate: UpdateGate = {
      started: started.promise,
      notifyStarted: started.resolve,
      release: released.resolve,
      waitForRelease: released.promise,
    };
    this.blockedUpdates.set(sessionId, gate);
    return gate;
  }

  select(sessionId: string): StoredRow | null {
    const row = this.rows.get(sessionId);
    return row ? { ...row } : null;
  }

  async insert(values: unknown[]): Promise<D1RunResult> {
    const [sessionId, state, dbVersion, createdAt, updatedAt] = values;
    if (
      typeof sessionId !== "string" ||
      typeof state !== "string" ||
      typeof dbVersion !== "number" ||
      typeof createdAt !== "number" ||
      typeof updatedAt !== "number"
    ) {
      throw new Error("invalid insert fixture");
    }
    if (this.rows.has(sessionId)) return { meta: { changes: 0 } };
    this.rows.set(sessionId, {
      state,
      db_version: dbVersion,
      created_at: createdAt,
      updated_at: updatedAt,
    });
    return { meta: { changes: 1 } };
  }

  async update(values: unknown[]): Promise<D1RunResult> {
    const [state, updatedAt, sessionId, expectedVersion] = values;
    if (
      typeof state !== "string" ||
      typeof updatedAt !== "number" ||
      typeof sessionId !== "string" ||
      typeof expectedVersion !== "number"
    ) {
      throw new Error("invalid update fixture");
    }
    this.updateAttempts.set(
      sessionId,
      (this.updateAttempts.get(sessionId) ?? 0) + 1,
    );
    const gate = this.blockedUpdates.get(sessionId);
    if (gate) {
      this.blockedUpdates.delete(sessionId);
      gate.notifyStarted();
      await gate.waitForRelease;
    }
    const row = this.rows.get(sessionId);
    if (!row || row.db_version !== expectedVersion) {
      return { meta: { changes: 0 } };
    }
    this.rows.set(sessionId, {
      ...row,
      state,
      db_version: row.db_version + 1,
      updated_at: updatedAt,
    });
    return { meta: { changes: 1 } };
  }

  async delete(values: unknown[]): Promise<D1RunResult> {
    const [sessionId, expectedVersion] = values;
    if (typeof sessionId !== "string" || typeof expectedVersion !== "number") {
      throw new Error("invalid delete fixture");
    }
    const row = this.rows.get(sessionId);
    if (!row || row.db_version !== expectedVersion) {
      return { meta: { changes: 0 } };
    }
    this.rows.delete(sessionId);
    return { meta: { changes: 1 } };
  }
}

class FakeD1Session implements D1SessionBinding {
  constructor(private readonly database: FakeD1Database) {}

  prepare(query: string): D1StatementBinding {
    return new FakeD1Statement(this.database, query);
  }
}

class FakeD1Statement implements D1StatementBinding {
  private values: unknown[] = [];

  constructor(
    private readonly database: FakeD1Database,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1StatementBinding {
    this.values = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const sessionId = this.values[0];
    if (!this.query.includes("SELECT") || typeof sessionId !== "string") {
      throw new Error("invalid select fixture");
    }
    return this.database.select(sessionId) as T | null;
  }

  async run(): Promise<D1RunResult> {
    if (this.query.includes("INSERT INTO")) return this.database.insert(this.values);
    if (this.query.includes("UPDATE")) return this.database.update(this.values);
    if (this.query.includes("DELETE FROM")) return this.database.delete(this.values);
    throw new Error("unsupported D1 fixture query");
  }
}

const ending: Ending = {
  kind: "roommates",
  title: "それぞれの朝",
  narration: "二人は互いの歩幅を尊重した。",
};

function resultIdentity(revision: number) {
  return {
    generationKey: `result:test:${revision}`,
    endingRevision: revision,
    scoringVersion: PRODUCER_SCORING_VERSION,
    narrativeVersion: RESULT_NARRATIVE_VERSION,
    reflectionVersion: REFLECTION_VERSION,
  };
}

function generatingState(seed: string): GameState {
  const initial = createInitialGameState(seed);
  const revision = 28;
  return {
    ...initial,
    revision,
    status: "ended",
    shared: { ...initial.shared, day: 7, phase: "night" },
    ending,
    result: {
      ...resultIdentity(revision),
      status: "generating",
      ending,
      producer: buildProducerResult([]),
      startedAt: "2026-07-18T00:00:00.000Z",
    },
  };
}

function completedState(seed: string): GameState {
  const generating = generatingState(seed);
  const generatingResult = generating.result;
  if (generatingResult?.status !== "generating") {
    throw new Error("invalid generating fixture");
  }
  const result: GameResult = {
    ...resultIdentity(generating.revision),
    status: "partial",
    ending,
    producer: generatingResult.producer,
    reflections: {},
    failures: [
      { component: "narrative", reason: "fixture", retryable: false },
    ],
    generatedAt: "2026-07-18T00:01:00.000Z",
    dataQuality: "partial",
  };
  return { ...generating, result };
}

function resolvingState(seed: string): GameState {
  return {
    ...createInitialGameState(seed),
    status: "resolving",
    turnId: "interrupted-turn",
  };
}

describe("D1 Worker recovery and isolation", () => {
  it("keeps the recovery lease above every supported Agent Worker operation", () => {
    const maximumCoordinatorTimeout = workerAgentCoordinatorTimeoutMs({
      AGENT_WORKER_TIMEOUT_MS: "999999",
      AGENT_WORKER_PROBE_TIMEOUT_MS: "999999",
      OPENAI_API_KEY: "sk-test-max-budget",
      OPENAI_API_TIMEOUT_MS: "999999",
    });
    const maximumConfiguredBudget = maximumCoordinatorTimeout * 2 * 4;

    expect(MAX_WORKER_AGENT_CHECKPOINT_BUDGET_MS).toBe(
      maximumConfiguredBudget,
    );
    expect(WORKER_STATE_LEASE_MS).toBeGreaterThan(
      MAX_WORKER_AGENT_CHECKPOINT_BUDGET_MS,
    );
    expect(WORKER_STATE_LEASE_MS).toBeGreaterThanOrEqual(20 * 60_000);
  });

  it("uses an SSE keepalive interval within the proxy-safe range", () => {
    expect(SSE_KEEPALIVE_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
    expect(SSE_KEEPALIVE_INTERVAL_MS).toBeLessThanOrEqual(15_000);
  });

  it("enables the remote Agent Worker only when its URL is configured", () => {
    expect(workerAgentMode()).toBe("mock");
    expect(workerAgentMode({ AGENT_WORKER_URL: "   " })).toBe("mock");
    expect(
      workerAgentMode({
        AGENT_WORKER_URL: "https://agent.example.test",
        AGENT_WORKER_TOKEN: "secret",
      }),
    ).toBe("auto");
    expect(
      workerAgentMode({ AGENT_WORKER_URL: "https://agent.example.test" }),
    ).toBe("mock");
    expect(
      workerAgentMode({
        AGENT_WORKER_URL: "http://agent.example.test",
        AGENT_WORKER_TOKEN: "secret",
      }),
    ).toBe("mock");
    expect(
      workerAgentMode({ AGENT_WORKER_URL: "http://127.0.0.1:3002" }),
    ).toBe("auto");
    expect(
      workerAgentWorkerConfigured({
        AGENT_WORKER_URL: "https://agent.example.test",
        AGENT_WORKER_TOKEN: "secret",
      }),
    ).toBe(true);
    expect(
      workerAgentWorkerConfigured({ OPENAI_API_KEY: "sk-test-openai" }),
    ).toBe(false);
  });

  it("enables OpenAI independently and strictly validates its public configuration", () => {
    expect(workerOpenAiApiConfigured()).toBe(false);
    expect(workerOpenAiApiConfigured({ OPENAI_API_KEY: "   " })).toBe(false);
    expect(
      workerOpenAiApiConfigured({ OPENAI_API_KEY: "sk-test\n-injected" }),
    ).toBe(false);
    expect(
      workerOpenAiApiConfigured({ OPENAI_API_KEY: "sk-test-openai" }),
    ).toBe(true);
    expect(workerAgentMode({ OPENAI_API_KEY: "sk-test-openai" })).toBe(
      "auto",
    );

    expect(workerOpenAiApiModel()).toBe("gpt-5.6-terra");
    expect(workerOpenAiApiModel({ OPENAI_API_MODEL: "" })).toBe(
      "gpt-5.6-terra",
    );
    expect(
      workerOpenAiApiModel({ OPENAI_API_MODEL: "invalid model value" }),
    ).toBe("gpt-5.6-terra");
    expect(
      workerOpenAiApiModel({ OPENAI_API_MODEL: "gpt-5.6-terra-fast" }),
    ).toBe("gpt-5.6-terra-fast");

    expect(workerOpenAiApiTimeoutMs()).toBe(30_000);
    expect(
      workerOpenAiApiTimeoutMs({ OPENAI_API_TIMEOUT_MS: "invalid" }),
    ).toBe(30_000);
    expect(
      workerOpenAiApiTimeoutMs({ OPENAI_API_TIMEOUT_MS: "20" }),
    ).toBe(1_000);
    expect(
      workerOpenAiApiTimeoutMs({ OPENAI_API_TIMEOUT_MS: "999999" }),
    ).toBe(120_000);
  });

  it("reports only OpenAI configuration status without exposing its secret or model", async () => {
    const apiKey = "sk-test-health-must-stay-secret";
    const response = await worker.fetch(
      new Request("https://roommates.example.test/api/health"),
      {
        DB: new FakeD1Database(),
        ASSETS: {
          fetch: async () => new Response(null, { status: 404 }),
        },
        OPENAI_API_KEY: apiKey,
        OPENAI_API_MODEL: "gpt-test-private-model",
      },
      {} as ExecutionContext,
    );
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(body).toMatchObject({
      ok: true,
      agentMode: "auto",
      agentWorkerConfigured: false,
      openaiApiConfigured: true,
    });
    expect(text).not.toContain(apiKey);
    expect(text).not.toContain("gpt-test-private-model");
  });

  it("uses a short bounded readiness probe timeout", () => {
    expect(workerAgentProbeTimeoutMs()).toBe(2_000);
    expect(
      workerAgentProbeTimeoutMs({ AGENT_WORKER_PROBE_TIMEOUT_MS: "10" }),
    ).toBe(250);
    expect(
      workerAgentProbeTimeoutMs({ AGENT_WORKER_PROBE_TIMEOUT_MS: "99999" }),
    ).toBe(10_000);
  });

  it("lets the adapter timeout before the coordinator timeout", () => {
    const env = {
      AGENT_WORKER_TIMEOUT_MS: "12000",
      AGENT_WORKER_PROBE_TIMEOUT_MS: "3000",
    };

    expect(workerAgentCoordinatorTimeoutMs(env)).toBe(
      workerAgentTimeoutMs(env) + workerAgentProbeTimeoutMs(env) + 5_000,
    );
  });

  it("uses a 60 second remote timeout and clamps unsafe overrides", () => {
    expect(workerAgentTimeoutMs()).toBe(60_000);
    expect(workerAgentTimeoutMs({ AGENT_WORKER_TIMEOUT_MS: "invalid" })).toBe(
      60_000,
    );
    expect(workerAgentTimeoutMs({ AGENT_WORKER_TIMEOUT_MS: "25" })).toBe(1_000);
    expect(workerAgentTimeoutMs({ AGENT_WORKER_TIMEOUT_MS: "999999" })).toBe(
      120_000,
    );
  });

  it("recovers a stale resolving checkpoint and persists the awaiting state", async () => {
    const database = new FakeD1Database();
    const sessionId = "stale-resolving";
    database.seed(sessionId, resolvingState("stale"), 4, 1_000);

    const recovered = await stateForRead(
      database,
      sessionId,
      1_000 + WORKER_STATE_LEASE_MS + 1,
    );

    expect(recovered).toMatchObject({
      seed: "stale",
      status: "awaiting_suggestion",
    });
    expect(recovered.turnId).toBeUndefined();
    expect(database.readState(sessionId)).toMatchObject({
      status: "awaiting_suggestion",
    });
  });

  it("keeps health checks read-only even for a stale resolving checkpoint", async () => {
    const database = new FakeD1Database();
    const sessionId = "health-stale-resolving";
    database.seed(sessionId, resolvingState("health-stale"), 4, 1_000);

    const state = await stateForHealth(database, sessionId);

    expect(state.status).toBe("resolving");
    expect(database.updateAttempts.get(sessionId)).toBeUndefined();
    expect(database.readState(sessionId)?.status).toBe("resolving");
  });

  it("keeps generation single-flight per session without blocking another session", async () => {
    const database = new FakeD1Database();
    const generatingSession = "generating-session";
    const otherSession = "other-session";
    database.seed(generatingSession, generatingState("generating"), 2, 1_000);
    database.seed(otherSession, resolvingState("other"), 8, 1_000);
    const gate = database.blockNextUpdate(generatingSession);
    const now = 1_000 + WORKER_STATE_LEASE_MS + 1;

    const firstRead = stateForRead(database, generatingSession, now);
    await gate.started;

    const duplicateRead = await stateForRead(database, generatingSession, now);
    expect(duplicateRead.result?.status).toBe("generating");
    expect(database.updateAttempts.get(generatingSession)).toBe(1);

    const independentRead = await stateForRead(database, otherSession, now);
    expect(independentRead).toMatchObject({
      seed: "other",
      status: "awaiting_suggestion",
    });

    gate.release();
    const completed = await firstRead;
    if (completed.result?.status !== "partial") {
      throw new Error("expected interrupted generation to recover as partial");
    }
    expect(completed.result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: "haru_reflection", retryable: true }),
        expect.objectContaining({ component: "aoi_reflection", retryable: true }),
      ]),
    );
    expect(database.updateAttempts.get(generatingSession)).toBe(1);
  });

  it("uses optimistic versions so a stale writer cannot replace a completed result", async () => {
    const database = new FakeD1Database();
    const sessionId = "optimistic-result";
    const generating = generatingState("optimistic");
    database.seed(sessionId, generating, 11, 1_000);
    const winner = new D1GameRepository(database, sessionId);
    const stale = new D1GameRepository(database, sessionId);
    await Promise.all([winner.load(), stale.load()]);

    await winner.save(completedState("optimistic"));
    await expect(stale.save(generating)).rejects.toBeInstanceOf(
      D1OptimisticConflictError,
    );

    expect(database.readState(sessionId)?.result?.status).toBe("partial");
  });
});
