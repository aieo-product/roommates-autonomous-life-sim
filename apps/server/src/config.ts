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
const configuredAgentWorkerUrl =
  process.env.AGENT_WORKER_URL?.trim() || undefined;

export const config = {
  port: Number(process.env.PORT ?? 3001),
  agentMode: configuredAgentMode,
  codexBin:
    process.env.CODEX_BIN ??
    (existsSync(join(homedir(), ".codex/plugins/.plugin-appserver/codex"))
      ? join(homedir(), ".codex/plugins/.plugin-appserver/codex")
      : "codex"),
  timeoutMs: Number(
    process.env.AGENT_WORKER_TIMEOUT_MS ??
      process.env.APP_SERVER_TIMEOUT_MS ??
      (configuredAgentWorkerUrl
        ? 60_000
        : defaultAppServerTimeoutMs(configuredAgentMode)),
  ),
  agentWorkerUrl: configuredAgentWorkerUrl,
  agentWorkerToken: process.env.AGENT_WORKER_TOKEN,
  agentWorkerProbeTimeoutMs: Number(
    process.env.AGENT_WORKER_PROBE_TIMEOUT_MS ?? 2_000,
  ),
  stateFile: resolve(process.env.GAME_STATE_FILE ?? "./apps/server/data/game-state.json"),
  persist: process.env.NODE_ENV !== "test",
};
