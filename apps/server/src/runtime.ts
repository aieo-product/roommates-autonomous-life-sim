import { config } from "./config.js";
import { CodexAppServerClient } from "./agents/app-server/client.js";
import { ResilientAgentCoordinator } from "./agents/coordinator.js";

export function createAgentCoordinator() {
  const appServer =
    config.agentMode === "mock" ? undefined : new CodexAppServerClient(config.codexBin, process.cwd());
  return new ResilientAgentCoordinator(config.agentMode, config.timeoutMs, appServer);
}
