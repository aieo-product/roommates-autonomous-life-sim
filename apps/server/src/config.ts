import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type AgentMode = "auto" | "mock" | "app-server";

function agentMode(value: string | undefined): AgentMode {
  return value === "mock" || value === "app-server" ? value : "auto";
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  agentMode: agentMode(process.env.AGENT_MODE),
  codexBin:
    process.env.CODEX_BIN ??
    (existsSync(join(homedir(), ".codex/plugins/.plugin-appserver/codex"))
      ? join(homedir(), ".codex/plugins/.plugin-appserver/codex")
      : "codex"),
  timeoutMs: Number(process.env.APP_SERVER_TIMEOUT_MS ?? 15_000),
  stateFile: resolve(process.env.GAME_STATE_FILE ?? "./apps/server/data/game-state.json"),
  persist: process.env.NODE_ENV !== "test",
};
