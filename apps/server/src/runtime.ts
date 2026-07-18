import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { CodexAppServerClient } from "./agents/app-server/client.js";
import { AgentWorkerClient } from "./agents/app-server/remote-client.js";
import {
  ResilientAgentCoordinator,
  type AppServerAdapter,
} from "./agents/coordinator.js";

export function createAgentCoordinator() {
  let appServer: AppServerAdapter | undefined;
  let coordinatorTimeoutMs = config.timeoutMs;
  if (config.agentMode !== "mock") {
    if (config.agentWorkerUrl) {
      try {
        appServer = new AgentWorkerClient({
          baseUrl: config.agentWorkerUrl,
          sessionId: randomUUID(),
          token: config.agentWorkerToken,
          timeoutMs: config.timeoutMs,
          probeTimeoutMs: config.agentWorkerProbeTimeoutMs,
        });
        // The adapter owns the operation deadline. Leave enough outer margin
        // for the readiness probe and response cleanup so it fails first.
        coordinatorTimeoutMs =
          config.timeoutMs + config.agentWorkerProbeTimeoutMs + 5_000;
      } catch {
        // Invalid or unsafe remote settings must never stop the game server.
        // The coordinator will report a normal fallback runtime instead.
        appServer = undefined;
      }
    } else {
      appServer = new CodexAppServerClient(config.codexBin, process.cwd(), {
        requestTimeoutMs: Math.min(10_000, Math.max(1_000, config.timeoutMs - 1_000)),
        turnTimeoutMs: Math.max(1_000, config.timeoutMs - 1_000),
      });
    }
  }
  return new ResilientAgentCoordinator(
    config.agentMode,
    coordinatorTimeoutMs,
    appServer,
  );
}
