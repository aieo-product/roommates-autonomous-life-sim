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
import {
  stateForRead,
  WORKER_STATE_LEASE_MS,
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
    expect(completed.result?.status).toBe("ready");
    expect(database.updateAttempts.get(generatingSession)).toBe(2);
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
