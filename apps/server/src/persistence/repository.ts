import type { GameState } from "@roommates/shared";

export interface GameRepository {
  load(): Promise<GameState | undefined>;
  save(state: GameState): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryGameRepository implements GameRepository {
  private state?: GameState;

  async load(): Promise<GameState | undefined> {
    return this.state ? structuredClone(this.state) : undefined;
  }

  async save(state: GameState): Promise<void> {
    this.state = structuredClone(state);
  }

  async clear(): Promise<void> {
    this.state = undefined;
  }
}
