import { createServer } from "node:http";
import { config } from "./config.js";
import { GameEngine } from "./engine/game-engine.js";
import { JsonGameRepository } from "./persistence/json-repository.js";
import { createAgentCoordinator } from "./runtime.js";
import { createApp } from "./app.js";

const agents = createAgentCoordinator();
const repository = new JsonGameRepository(config.stateFile);
const engine = new GameEngine(repository, agents);
await engine.initialize();

const server = createServer(createApp(engine));
server.listen(config.port, () => {
  console.log(`ROOMMATES server listening on http://localhost:${config.port} (${config.agentMode})`);
});

async function shutdown(): Promise<void> {
  server.close();
  await agents.shutdown?.();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
