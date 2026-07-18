import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type AgentMode = "auto" | "mock" | "app-server";

function agentMode(value: string | undefined): AgentMode {
  return value === "mock" || value === "app-server" ? value : "auto";
}

export function defaultAppServerTimeoutMs(mode: AgentMode): number {
  return mode === "app-server" ? 60_000 : 15_000;
}

const configuredAgentMode = agentMode(process.env.AGENT_MODE);

export const config = {
  port: Number(process.env.PORT ?? 3001),
  agentMode: configuredAgentMode,
  codexBin:
    process.env.CODEX_BIN ??
    (existsSync(join(homedir(), ".codex/plugins/.plugin-appserver/codex"))
      ? join(homedir(), ".codex/plugins/.plugin-appserver/codex")
      : "codex"),
  timeoutMs: Number(
    process.env.APP_SERVER_TIMEOUT_MS ??
      defaultAppServerTimeoutMs(configuredAgentMode),
  ),
  stateFile: resolve(process.env.GAME_STATE_FILE ?? "./apps/server/data/game-state.json"),
  persist: process.env.NODE_ENV !== "test",
};
