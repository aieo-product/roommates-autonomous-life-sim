/// <reference types="@cloudflare/workers-types" />

import type { GameState } from "@roommates/shared";
import { gameStateSchema } from "@roommates/shared";
import type { GameRepository } from "./repository.js";

type GameSessionRow = {
  state: string;
  db_version: number;
  updated_at: number;
};

export type D1RunResult = { meta: { changes?: number } };

export interface D1StatementBinding {
  bind(...values: unknown[]): D1StatementBinding;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface D1SessionBinding {
  prepare(query: string): D1StatementBinding;
}

export interface D1DatabaseBinding {
  withSession(constraint: "first-primary"): D1SessionBinding;
}

export class D1OptimisticConflictError extends Error {
  constructor() {
    super("ゲーム状態が更新されています。再読み込みしてください");
    this.name = "D1OptimisticConflictError";
  }
}

export class D1GameRepository implements GameRepository {
  private readonly session: D1SessionBinding;
  private loaded = false;
  private state?: GameState;
  private dbVersion?: number;
  private updatedAt?: number;
  private nextInsertVersion = 0;

  constructor(
    database: D1DatabaseBinding,
    private readonly sessionId: string,
  ) {
    this.session = database.withSession("first-primary");
  }

  async load(): Promise<GameState | undefined> {
    if (this.loaded) return this.cloneState();

    const row = await this.session
      .prepare(
        `SELECT state, db_version, updated_at
         FROM game_sessions
         WHERE session_id = ?
         LIMIT 1`,
      )
      .bind(this.sessionId)
      .first<GameSessionRow>();

    this.loaded = true;
    if (!row) return undefined;
    if (!Number.isSafeInteger(row.db_version) || row.db_version < 0) {
      throw new Error("保存されたゲーム状態のバージョンが正しくありません");
    }
    if (!Number.isSafeInteger(row.updated_at) || row.updated_at < 0) {
      throw new Error("保存されたゲーム状態の更新時刻が正しくありません");
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(row.state);
    } catch {
      throw new Error("保存されたゲーム状態を読み込めませんでした");
    }

    const parsed = gameStateSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error("保存されたゲーム状態の形式が正しくありません");
    }

    this.dbVersion = row.db_version;
    this.updatedAt = row.updated_at;
    this.state = parsed.data as GameState;
    return this.cloneState();
  }

  isStale(now: number, maxAgeMs: number): boolean {
    return this.updatedAt !== undefined && now - this.updatedAt >= maxAgeMs;
  }

  async save(state: GameState): Promise<void> {
    await this.ensureLoaded();

    const serialized = JSON.stringify(state);
    const now = Date.now();
    if (this.dbVersion === undefined) {
      const version = this.nextInsertVersion;
      const result = await this.session
        .prepare(
          `INSERT INTO game_sessions
             (session_id, state, db_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO NOTHING`,
        )
        .bind(this.sessionId, serialized, version, now, now)
        .run();

      if (result.meta.changes !== 1) throw new D1OptimisticConflictError();
      this.dbVersion = version;
      this.updatedAt = now;
      this.nextInsertVersion = 0;
      this.state = structuredClone(state);
      return;
    }

    const expectedVersion = this.dbVersion;
    const result = await this.session
      .prepare(
        `UPDATE game_sessions
         SET state = ?, db_version = db_version + 1, updated_at = ?
         WHERE session_id = ? AND db_version = ?`,
      )
      .bind(serialized, now, this.sessionId, expectedVersion)
      .run();

    if (result.meta.changes !== 1) throw new D1OptimisticConflictError();
    this.dbVersion = expectedVersion + 1;
    this.updatedAt = now;
    this.state = structuredClone(state);
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    if (this.dbVersion === undefined) {
      this.state = undefined;
      return;
    }

    const expectedVersion = this.dbVersion;
    const result = await this.session
      .prepare(
        `DELETE FROM game_sessions
         WHERE session_id = ? AND db_version = ?`,
      )
      .bind(this.sessionId, expectedVersion)
      .run();

    if (result.meta.changes !== 1) throw new D1OptimisticConflictError();
    this.dbVersion = undefined;
    this.updatedAt = undefined;
    this.nextInsertVersion = expectedVersion + 1;
    this.state = undefined;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  private cloneState(): GameState | undefined {
    return this.state ? structuredClone(this.state) : undefined;
  }
}

