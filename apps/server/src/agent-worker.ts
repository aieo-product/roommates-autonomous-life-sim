import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CodexAppServerClient,
  type AppServerReasoningEffort,
  type CodexAppServerModelPolicy,
} from "./agents/app-server/client.js";
import { createAgentWorkerApp } from "./agent-worker-app.js";

// A cold App Server may need more than ten seconds to initialize the selected
// model on the first thread/start. Keep this below the remote operation budget
// while allowing that one-time setup to finish instead of forcing a fallback.
const DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_APP_SERVER_TURN_TIMEOUT_MS = 50_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const DEFAULT_AGENT_WORKER_MODEL = "gpt-5.6-terra";
const DEFAULT_FAST_REASONING_EFFORT: AppServerReasoningEffort = "low";
const DEFAULT_DELIBERATE_REASONING_EFFORT: AppServerReasoningEffort = "medium";
const MAX_MODEL_NAME_LENGTH = 128;
const APP_SERVER_REASONING_EFFORTS = new Set<AppServerReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

function loopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function agentWorkerModel(value: string | undefined): string {
  const model = value === undefined ? DEFAULT_AGENT_WORKER_MODEL : value.trim();
  if (model.length === 0 || model.length > MAX_MODEL_NAME_LENGTH) {
    throw new Error(
      `AGENT_WORKER_MODEL must be 1-${MAX_MODEL_NAME_LENGTH} characters`,
    );
  }
  return model;
}

function reasoningEffort(
  value: string | undefined,
  fallback: AppServerReasoningEffort,
  name: string,
): AppServerReasoningEffort {
  const effort = value === undefined ? fallback : value.trim();
  if (!APP_SERVER_REASONING_EFFORTS.has(effort as AppServerReasoningEffort)) {
    throw new Error(`${name} is invalid`);
  }
  return effort as AppServerReasoningEffort;
}

export type AgentWorkerCwd = {
  cwd: string;
  temporary: boolean;
  cleanup(): void;
};

/**
 * Keep App Server's read-only sandbox away from the repository by default.
 * A custom cwd is an explicit escape hatch and therefore needs a second opt-in
 * in production in addition to setting the path itself.
 */
export function resolveAgentWorkerCwd(
  environment: NodeJS.ProcessEnv = process.env,
): AgentWorkerCwd {
  const custom = environment.AGENT_WORKER_CWD?.trim();
  const production = environment.NODE_ENV === "production";
  if (custom) {
    if (
      production &&
      environment.AGENT_WORKER_ALLOW_CUSTOM_CWD?.trim().toLowerCase() !== "true"
    ) {
      throw new Error(
        "AGENT_WORKER_ALLOW_CUSTOM_CWD=true is required for a custom production cwd",
      );
    }
    const cwd = resolve(custom);
    if (!statSync(cwd).isDirectory()) {
      throw new Error("AGENT_WORKER_CWD must be an existing directory");
    }
    return { cwd, temporary: false, cleanup: () => undefined };
  }

  const cwd = mkdtempSync(join(tmpdir(), "roommates-agent-worker-"));
  chmodSync(cwd, 0o700);
  return {
    cwd,
    temporary: true,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

export type AgentWorkerSettings = {
  host: string;
  port: number;
  token?: string;
  production: boolean;
  executable: string;
  requestTimeoutMs: number;
  turnTimeoutMs: number;
  httpRequestTimeoutMs: number;
  shutdownTimeoutMs: number;
  maxConcurrentInvocations: number;
  maxInvocationsPerMinute: number;
  idempotencyTtlMs: number;
  idempotencyMaxEntries: number;
  modelPolicy: CodexAppServerModelPolicy;
};

export function readAgentWorkerSettings(
  environment: NodeJS.ProcessEnv = process.env,
): AgentWorkerSettings {
  const token = environment.AGENT_WORKER_TOKEN?.trim() || undefined;
  const production = environment.NODE_ENV === "production";
  const host =
    environment.AGENT_WORKER_HOST ?? (token ? "0.0.0.0" : "127.0.0.1");
  if (production && !token) {
    throw new Error("AGENT_WORKER_TOKEN is required in production");
  }
  if (!token && !loopbackHost(host)) {
    throw new Error("An unauthenticated AgentWorker may only bind to loopback");
  }

  const executable =
    environment.CODEX_BIN ??
    (existsSync(join(homedir(), ".codex/plugins/.plugin-appserver/codex"))
      ? join(homedir(), ".codex/plugins/.plugin-appserver/codex")
      : "codex");
  return {
    host,
    port: positiveInteger(environment.AGENT_WORKER_PORT, 3002),
    token,
    production,
    executable,
    requestTimeoutMs: positiveInteger(
      environment.AGENT_WORKER_APP_SERVER_REQUEST_TIMEOUT_MS,
      positiveInteger(
        environment.APP_SERVER_REQUEST_TIMEOUT_MS,
        DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS,
      ),
    ),
    turnTimeoutMs: positiveInteger(
      environment.AGENT_WORKER_APP_SERVER_TURN_TIMEOUT_MS,
      positiveInteger(
        environment.APP_SERVER_TURN_TIMEOUT_MS,
        DEFAULT_APP_SERVER_TURN_TIMEOUT_MS,
      ),
    ),
    httpRequestTimeoutMs: positiveInteger(
      environment.AGENT_WORKER_REQUEST_TIMEOUT_MS,
      180_000,
    ),
    shutdownTimeoutMs: positiveInteger(
      environment.AGENT_WORKER_SHUTDOWN_TIMEOUT_MS,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
    ),
    maxConcurrentInvocations: positiveInteger(
      environment.AGENT_WORKER_MAX_CONCURRENT_INVOCATIONS,
      8,
    ),
    maxInvocationsPerMinute: positiveInteger(
      environment.AGENT_WORKER_MAX_INVOCATIONS_PER_MINUTE,
      60,
    ),
    idempotencyTtlMs: positiveInteger(
      environment.AGENT_WORKER_IDEMPOTENCY_TTL_MS,
      5 * 60_000,
    ),
    idempotencyMaxEntries: positiveInteger(
      environment.AGENT_WORKER_IDEMPOTENCY_MAX_ENTRIES,
      256,
    ),
    modelPolicy: {
      model: agentWorkerModel(environment.AGENT_WORKER_MODEL),
      fastReasoningEffort: reasoningEffort(
        environment.AGENT_WORKER_FAST_REASONING_EFFORT,
        DEFAULT_FAST_REASONING_EFFORT,
        "AGENT_WORKER_FAST_REASONING_EFFORT",
      ),
      deliberateReasoningEffort: reasoningEffort(
        environment.AGENT_WORKER_DELIBERATE_REASONING_EFFORT,
        DEFAULT_DELIBERATE_REASONING_EFFORT,
        "AGENT_WORKER_DELIBERATE_REASONING_EFFORT",
      ),
    },
  };
}

async function settleOrTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((done) => {
    timer = setTimeout(() => {
      onTimeout();
      done(false);
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise.then(() => true as const), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type StartedAgentWorker = {
  server: Server;
  cwd: string;
  shutdown(): Promise<void>;
};

export async function startAgentWorker(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<StartedAgentWorker> {
  const settings = readAgentWorkerSettings(environment);
  const cwd = resolveAgentWorkerCwd(environment);
  const client = new CodexAppServerClient(settings.executable, cwd.cwd, {
    requestTimeoutMs: settings.requestTimeoutMs,
    turnTimeoutMs: settings.turnTimeoutMs,
    modelPolicy: settings.modelPolicy,
  });
  const runtime = createAgentWorkerApp({
    client,
    token: settings.token,
    requireToken: settings.production,
    maxConcurrentInvocations: settings.maxConcurrentInvocations,
    maxInvocationsPerMinute: settings.maxInvocationsPerMinute,
    idempotencyTtlMs: settings.idempotencyTtlMs,
    idempotencyMaxEntries: settings.idempotencyMaxEntries,
  });
  const server = createServer(runtime.app);
  server.requestTimeout = settings.httpRequestTimeoutMs;
  server.headersTimeout = 10_000;

  try {
    await new Promise<void>((done, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once("error", onError);
      server.listen(settings.port, settings.host, () => {
        server.off("error", onError);
        done();
      });
    });
  } catch (error) {
    await runtime.shutdown().catch(() => undefined);
    cwd.cleanup();
    throw error;
  }

  console.log(
    `ROOMMATES AgentWorker listening on http://${settings.host}:${settings.port}`,
  );

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      try {
        server.closeIdleConnections();
        const close = new Promise<void>((done) => server.close(() => done()));
        await settleOrTimeout(close, settings.shutdownTimeoutMs, () => {
          server.closeAllConnections();
        });
        await settleOrTimeout(
          runtime.shutdown(),
          settings.shutdownTimeoutMs,
          () => undefined,
        );
      } finally {
        server.closeAllConnections();
        cwd.cleanup();
      }
    })();
    return shutdownPromise;
  };

  return { server, cwd: cwd.cwd, shutdown };
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMainModule()) {
  const running = await startAgentWorker();
  const stop = (): void => {
    void running.shutdown().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
