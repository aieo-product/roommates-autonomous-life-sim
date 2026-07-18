import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialGameState, type GameState } from "@roommates/shared";
import { JsonGameRepository } from "../src/persistence/json-repository.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("JSON repository boundary", () => {
  it("migrates legacy saves through gameStateSchema and never writes private summaries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "roommates-json-boundary-"));
    directories.push(directory);
    const file = join(directory, "state.json");
    const repository = new JsonGameRepository(file);
    const initial = createInitialGameState("repository-boundary");
    const legacyState = {
      ...initial,
      version: 1,
      characters: {
        haru: {
          state: initial.characters.haru.state,
          internalSummary: "PRIVATE_RECORD_SUMMARY",
          lastDecision: {
            decision: "MODIFY",
            action: "少しだけ話す",
            dialogue: "短い時間なら話したい。",
            publicReason: "今日は自分のペースを守りたいから",
            internalSummary: "PRIVATE_DECISION_SUMMARY",
            expectedEffects: { trust: 3 },
          },
        },
        aoi: { state: initial.characters.aoi.state },
      },
    } as unknown as GameState;

    await repository.save(legacyState);

    const persisted = await readFile(file, "utf8");
    expect(persisted).not.toContain("PRIVATE_RECORD_SUMMARY");
    expect(persisted).not.toContain("PRIVATE_DECISION_SUMMARY");
    expect(persisted).not.toContain("internalSummary");
    expect(persisted).not.toContain("expectedEffects");
    await expect(repository.load()).resolves.toMatchObject({
      version: 2,
      seed: "repository-boundary",
      characters: {
        haru: {
          lastDecision: {
            decision: "MODIFY",
            action: "少しだけ話す",
            dialogue: "短い時間なら話したい。",
            publicReason: "今日は自分のペースを守りたいから",
          },
        },
      },
    });
  });

  it("does not replace a valid save with a schema-invalid state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "roommates-json-boundary-"));
    directories.push(directory);
    const file = join(directory, "state.json");
    const repository = new JsonGameRepository(file);
    await repository.save(createInitialGameState("valid-state"));

    const invalid = {
      ...createInitialGameState("invalid-state"),
      shared: { ...createInitialGameState().shared, day: 99 },
    } as unknown as GameState;

    await expect(repository.save(invalid)).rejects.toThrow();
    await expect(repository.load()).resolves.toMatchObject({ seed: "valid-state" });
  });
});
