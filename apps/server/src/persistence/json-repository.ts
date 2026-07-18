import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GameState } from "@roommates/shared";
import { gameStateSchema } from "@roommates/shared";
import type { GameRepository } from "./repository.js";

export class JsonGameRepository implements GameRepository {
  constructor(private readonly file: string) {}

  async load(): Promise<GameState | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      const result = gameStateSchema.safeParse(parsed);
      return result.success ? (result.data as GameState) : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  async save(state: GameState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    const persisted = gameStateSchema.parse(state) as GameState;
    await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
    await rename(temporary, this.file);
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }
}
