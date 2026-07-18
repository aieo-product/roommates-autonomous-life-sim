import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  CharacterDecisionInput,
  CharacterId,
  DirectorInput,
  NavigatorInput,
} from "@roommates/shared";
import type { AppServerAdapter } from "../coordinator.js";
import type { AgentReflectionInput } from "../reflection.js";
import { extractJson } from "./json.js";
import {
  characterInstructions,
  characterPrompt,
  directorInstructions,
  directorPrompt,
  navigatorInstructions,
  navigatorPrompt,
  reflectionInstructions,
  reflectionPrompt,
} from "./prompts.js";
import {
  characterOutputSchema,
  directorOutputSchema,
  navigatorOutputSchema,
  reflectionOutputSchema,
} from "./schemas.js";

type RpcResponse = { id: number; result?: unknown; error?: { message?: string; code?: number } };
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};
type TurnWaiter = {
  texts: string[];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};
type AppServerRole = CharacterId | "navigator" | "director" | `${CharacterId}-reflection`;
type SessionScopeState = {
  activeOperations: number;
  lastUsedAt: number;
};
type ScopeOperation = {
  scope: string;
  sessionState?: SessionScopeState;
};
type RequestOptions = {
  fatalOnFailure?: boolean;
};

export type CodexAppServerClientOptions = {
  requestTimeoutMs?: number;
  turnTimeoutMs?: number;
  sessionScopeTtlMs?: number;
  maxSessionScopes?: number;
  now?: () => number;
  modelPolicy?: CodexAppServerModelPolicy;
};

export type AppServerReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export type CodexAppServerModelPolicy = {
  model: string;
  fastReasoningEffort: AppServerReasoningEffort;
  deliberateReasoningEffort: AppServerReasoningEffort;
};

export class AppServerScopeCapacityError extends Error {
  constructor() {
    super("App Server session capacity is exhausted");
    this.name = "AppServerScopeCapacityError";
  }
}

const DEFAULT_THREAD_SCOPE = "default";
const SESSION_NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_TURN_TIMEOUT_MS = 120_000;
const DEFAULT_SESSION_SCOPE_TTL_MS = 30 * 60_000;
const DEFAULT_MAX_SESSION_SCOPES = 64;
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
const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "hooks",
  "multi_agent",
  "remote_plugin",
  "shell_snapshot",
  "memories",
  "goals",
  "personality",
  "plugins",
  "plugin_sharing",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "image_generation",
  "in_app_browser",
  "auth_elicitation",
  "skill_mcp_dependency_install",
  "tool_suggest",
  "workspace_dependencies",
] as const;
const APP_SERVER_ENVIRONMENT_KEYS = [
  "HOME",
  "PATH",
  "CODEX_HOME",
  "CODEX_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
] as const;

function sessionThreadScope(namespace: string): string {
  if (!SESSION_NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(
      "App Server scope namespace must be 1-128 ASCII letters, numbers, dots, underscores, colons, or hyphens",
    );
  }
  // Keep explicitly scoped game sessions separate from the legacy/default
  // methods even when a caller happens to use the namespace "default".
  return `session:${namespace}`;
}

function positiveTimeout(value: number | undefined, fallback: number, name: string): number {
  const timeout = value ?? fallback;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return timeout;
}

function modelPolicy(
  value: CodexAppServerModelPolicy | undefined,
): CodexAppServerModelPolicy | undefined {
  if (value === undefined) return undefined;

  const model = value.model.trim();
  if (model.length === 0 || model.length > MAX_MODEL_NAME_LENGTH) {
    throw new Error(`modelPolicy.model must be 1-${MAX_MODEL_NAME_LENGTH} characters`);
  }
  if (!APP_SERVER_REASONING_EFFORTS.has(value.fastReasoningEffort)) {
    throw new Error("modelPolicy.fastReasoningEffort is invalid");
  }
  if (!APP_SERVER_REASONING_EFFORTS.has(value.deliberateReasoningEffort)) {
    throw new Error("modelPolicy.deliberateReasoningEffort is invalid");
  }
  return {
    model,
    fastReasoningEffort: value.fastReasoningEffort,
    deliberateReasoningEffort: value.deliberateReasoningEffort,
  };
}

function appServerEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const key of APP_SERVER_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function appServerArguments(): string[] {
  return [
    ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    "-c",
    "web_search='disabled'",
    "-c",
    "shell_environment_policy.inherit='none'",
    "-c",
    "shell_environment_policy.include_only=[]",
    "-c",
    "mcp_servers={}",
    "app-server",
    "--stdio",
  ];
}

function restrictedThreadConfig(): Record<string, unknown> {
  return {
    features: Object.fromEntries(DISABLED_FEATURES.map((feature) => [feature, false])),
    web_search: "disabled",
    shell_environment_policy: {
      inherit: "none",
      include_only: [],
    },
    mcp_servers: {},
  };
}

function readableAppServerError(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") return parsed.error.message;
  } catch {
    // Some App Server versions already send a plain message.
  }
  return value;
}

export class CodexAppServerClient implements AppServerAdapter {
  private process?: ChildProcessWithoutNullStreams;
  private startPromise?: Promise<void>;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly turns = new Map<string, TurnWaiter>();
  private readonly threadIds = new Map<string, string>();
  private readonly sessionScopes = new Map<string, SessionScopeState>();
  private readonly requestTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private readonly sessionScopeTtlMs: number;
  private readonly maxSessionScopes: number;
  private readonly now: () => number;
  private readonly modelPolicy?: CodexAppServerModelPolicy;
  private activeOperations = 0;
  private stderrTail = "";

  constructor(
    private readonly executable: string,
    private readonly cwd: string,
    options: CodexAppServerClientOptions = {},
  ) {
    this.requestTimeoutMs = positiveTimeout(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.turnTimeoutMs = positiveTimeout(
      options.turnTimeoutMs,
      DEFAULT_TURN_TIMEOUT_MS,
      "turnTimeoutMs",
    );
    this.sessionScopeTtlMs = positiveTimeout(
      options.sessionScopeTtlMs,
      DEFAULT_SESSION_SCOPE_TTL_MS,
      "sessionScopeTtlMs",
    );
    const maxSessionScopes = options.maxSessionScopes ?? DEFAULT_MAX_SESSION_SCOPES;
    if (!Number.isSafeInteger(maxSessionScopes) || maxSessionScopes <= 0) {
      throw new Error("maxSessionScopes must be a positive safe integer");
    }
    this.maxSessionScopes = maxSessionScopes;
    this.now = options.now ?? Date.now;
    this.modelPolicy = modelPolicy(options.modelPolicy);
  }

  async navigate(input: NavigatorInput): Promise<{ value: unknown; threadId: string }> {
    return this.navigateInScope(DEFAULT_THREAD_SCOPE, input);
  }

  async decide(id: CharacterId, input: CharacterDecisionInput): Promise<{ value: unknown; threadId: string }> {
    return this.decideInScope(DEFAULT_THREAD_SCOPE, id, input);
  }

  async resolve(input: DirectorInput): Promise<{ value: unknown; threadId: string }> {
    return this.resolveInScope(DEFAULT_THREAD_SCOPE, input);
  }

  async reflect(id: CharacterId, input: AgentReflectionInput): Promise<{ value: unknown; threadId: string }> {
    return this.reflectInScope(DEFAULT_THREAD_SCOPE, id, input);
  }

  scope(namespace: string): AppServerAdapter {
    const scope = sessionThreadScope(namespace);
    return {
      navigate: (input) => this.navigateInScope(scope, input),
      decide: (id, input) => this.decideInScope(scope, id, input),
      resolve: (input) => this.resolveInScope(scope, input),
      reflect: (id, input) => this.reflectInScope(scope, id, input),
      // A scoped view must not clear the other sessions owned by the shared
      // client. Context resets are only meaningful on the owner itself.
      resetContext: async () => undefined,
      // The scoped view does not own the shared Codex process. The owner must
      // shut down the client itself when the gateway exits.
      shutdown: async () => undefined,
    };
  }

  async ready(): Promise<void> {
    await this.start();
  }

  private async navigateInScope(
    scope: string,
    input: NavigatorInput,
  ): Promise<{ value: unknown; threadId: string }> {
    return this.withThreadScope(scope, async () => {
      const threadId = await this.thread(scope, "navigator");
      const value = await this.turn(threadId, navigatorPrompt(input), navigatorOutputSchema);
      return { value, threadId };
    });
  }

  private async decideInScope(
    scope: string,
    id: CharacterId,
    input: CharacterDecisionInput,
  ): Promise<{ value: unknown; threadId: string }> {
    return this.withThreadScope(scope, async () => {
      const threadId = await this.thread(scope, id);
      const value = await this.turn(threadId, characterPrompt(input), characterOutputSchema);
      return { value, threadId };
    });
  }

  private async resolveInScope(
    scope: string,
    input: DirectorInput,
  ): Promise<{ value: unknown; threadId: string }> {
    return this.withThreadScope(scope, async () => {
      const threadId = await this.thread(scope, "director");
      const value = await this.turn(threadId, directorPrompt(input), directorOutputSchema);
      return { value, threadId };
    });
  }

  private async reflectInScope(
    scope: string,
    id: CharacterId,
    input: AgentReflectionInput,
  ): Promise<{ value: unknown; threadId: string }> {
    return this.withThreadScope(scope, async () => {
      // Keep public reflections isolated from live decision threads, which can
      // contain private summaries from earlier turns.
      const threadId = await this.thread(scope, `${id}-reflection`);
      const value = await this.turn(threadId, reflectionPrompt(input), reflectionOutputSchema);
      return { value, threadId };
    });
  }

  private async withThreadScope<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    const scopeOperation = this.enterThreadScope(scope);
    try {
      return await operation();
    } finally {
      this.leaveThreadScope(scopeOperation);
    }
  }

  private enterThreadScope(scope: string): ScopeOperation {
    if (!scope.startsWith("session:")) {
      this.activeOperations += 1;
      return { scope };
    }

    const now = this.currentTime();
    this.retireExpiredSessionScopes(now);
    let state = this.sessionScopes.get(scope);
    if (!state) {
      while (this.sessionScopes.size >= this.maxSessionScopes) {
        if (!this.retireOldestInactiveSessionScope()) {
          throw new AppServerScopeCapacityError();
        }
      }
      state = { activeOperations: 0, lastUsedAt: now };
    } else {
      // Map insertion order is the LRU order. Reinsert on every use.
      this.sessionScopes.delete(scope);
    }
    state.activeOperations += 1;
    state.lastUsedAt = now;
    this.sessionScopes.set(scope, state);
    this.activeOperations += 1;
    return { scope, sessionState: state };
  }

  private leaveThreadScope(operation: ScopeOperation): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1);
    const state = operation.sessionState;
    if (!state) return;

    state.activeOperations = Math.max(0, state.activeOperations - 1);
    const current = this.sessionScopes.get(operation.scope);
    // A shutdown may have cleared metadata while an operation was unwinding.
    // Only update the map when this is still the same scope generation.
    if (current !== state) return;
    state.lastUsedAt = this.currentTime();
    this.sessionScopes.delete(operation.scope);
    this.sessionScopes.set(operation.scope, state);
  }

  private currentTime(): number {
    const now = this.now();
    if (!Number.isFinite(now)) throw new Error("now must return a finite number");
    return now;
  }

  private retireExpiredSessionScopes(now: number): void {
    for (const [scope, state] of [...this.sessionScopes]) {
      if (state.activeOperations === 0 && now - state.lastUsedAt >= this.sessionScopeTtlMs) {
        this.retireSessionScope(scope, state);
      }
    }
  }

  private retireOldestInactiveSessionScope(): boolean {
    for (const [scope, state] of this.sessionScopes) {
      if (state.activeOperations !== 0) continue;
      this.retireSessionScope(scope, state);
      return true;
    }
    return false;
  }

  private retireSessionScope(scope: string, state: SessionScopeState): void {
    if (state.activeOperations !== 0 || this.sessionScopes.get(scope) !== state) return;
    this.sessionScopes.delete(scope);
    this.retireThreadsForScope(scope);
  }

  private retireThreadsForScope(scope: string): void {
    const prefix = `${scope}\0`;
    for (const [key, threadId] of [...this.threadIds]) {
      if (!key.startsWith(prefix)) continue;
      this.threadIds.delete(key);
      void this.deleteThreadBestEffort(threadId);
    }
  }

  private async deleteThreadBestEffort(threadId: string): Promise<void> {
    try {
      await this.request("thread/delete", { threadId }, { fatalOnFailure: false });
    } catch {
      // A retired session must not make a healthy App Server unavailable.
    }
  }

  private async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.process) return;
    const startPromise = this.doStart();
    this.startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.startPromise === startPromise) this.startPromise = undefined;
    });
    return startPromise;
  }

  private async doStart(): Promise<void> {
    this.stderrTail = "";
    const child = spawn(this.executable, appServerArguments(), {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: appServerEnvironment(),
    });
    this.process = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-2_000);
    });
    child.on("error", (error) => {
      if (this.process !== child) return;
      this.resetProcess(error, true);
    });
    child.on("exit", (code) => {
      if (this.process !== child) return;
      this.resetProcess(
        new Error(`Codex App Server exited (${code ?? "signal"}): ${this.stderrTail.trim()}`),
        false,
      );
    });

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.onLine(line));
    try {
      await this.request("initialize", {
        clientInfo: { name: "roommates-runtime", title: "ROOMMATES Game Runtime", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      this.notify("initialized");
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Codex App Server initialization failed");
      if (this.process === child) this.resetProcess(failure, true);
      else if (!child.killed) child.kill("SIGTERM");
      throw failure;
    }
  }

  private onLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      const response = message as RpcResponse;
      if (response.error) pending.reject(new Error(response.error.message ?? `App Server RPC error ${response.error.code ?? ""}`));
      else pending.resolve(response.result);
      return;
    }
    const method = typeof message.method === "string" ? message.method : "";
    const params = (message.params ?? {}) as Record<string, unknown>;
    const turnId = typeof params.turnId === "string" ? params.turnId : undefined;
    if (method === "item/completed" && turnId) {
      const item = params.item as { type?: string; text?: string } | undefined;
      if (item?.type === "agentMessage" && item.text) this.turns.get(turnId)?.texts.push(item.text);
    } else if (method === "item/agentMessage/delta" && turnId) {
      const delta = typeof params.delta === "string" ? params.delta : "";
      const waiter = this.turns.get(turnId);
      if (waiter && waiter.texts.length === 0 && delta) waiter.texts.push(delta);
      else if (waiter && delta) waiter.texts[waiter.texts.length - 1] += delta;
    } else if (method === "turn/completed") {
      const turn = params.turn as { id?: string; status?: string; error?: { message?: string }; items?: Array<{ type?: string; text?: string }> } | undefined;
      const id = turn?.id ?? turnId;
      if (!id) return;
      const waiter = this.turns.get(id);
      if (!waiter) return;
      this.turns.delete(id);
      clearTimeout(waiter.timer);
      if (turn?.status === "failed") waiter.reject(new Error(turn.error?.message ?? "App Server turn failed"));
      else {
        const itemText = turn?.items?.filter((item) => item.type === "agentMessage").at(-1)?.text;
        const text = itemText ?? waiter.texts.at(-1);
        if (!text) waiter.reject(new Error("App Server completed without an agent message"));
        else {
          try {
            waiter.resolve(extractJson(text));
          } catch (error) {
            waiter.reject(error instanceof Error ? error : new Error("Invalid App Server JSON"));
          }
        }
      }
    } else if (method === "error" && turnId) {
      const waiter = this.turns.get(turnId);
      if (waiter) {
        this.turns.delete(turnId);
        clearTimeout(waiter.timer);
        const nestedError = params.error as { message?: unknown } | undefined;
        const message =
          readableAppServerError(params.message) ??
          readableAppServerError(nestedError?.message) ??
          "App Server error";
        waiter.reject(new Error(message));
      }
    }
  }

  private async thread(scope: string, role: AppServerRole): Promise<string> {
    await this.start();
    const threadKey = `${scope}\0${role}`;
    const existing = this.threadIds.get(threadKey);
    if (existing) return existing;
    const reflectionCharacter =
      role === "haru-reflection"
        ? "haru"
        : role === "aoi-reflection"
          ? "aoi"
          : undefined;
    const baseInstructions =
      role === "director"
        ? directorInstructions
        : role === "navigator"
          ? navigatorInstructions
          : reflectionCharacter
            ? reflectionInstructions(reflectionCharacter)
            : characterInstructions(role === "haru" ? "haru" : "aoi");
    const reasoningEffort =
      role === "director" || reflectionCharacter
        ? this.modelPolicy?.deliberateReasoningEffort
        : this.modelPolicy?.fastReasoningEffort;
    const result = (await this.request("thread/start", {
      ...(this.modelPolicy ? { model: this.modelPolicy.model } : {}),
      cwd: this.cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      baseInstructions,
      experimentalRawEvents: false,
      config: {
        ...restrictedThreadConfig(),
        ...(reasoningEffort ? { model_reasoning_effort: reasoningEffort } : {}),
      },
    })) as { thread?: { id?: string } };
    const id = result.thread?.id;
    if (!id) throw new Error("App Server did not return a thread ID");
    this.threadIds.set(threadKey, id);
    const threadName =
      role === "director"
        ? "Director"
        : role === "navigator"
          ? "デコピン"
          : reflectionCharacter
            ? `${reflectionCharacter === "haru" ? "Haru" : "Aoi"} Reflection`
            : role === "haru"
              ? "Haru"
              : "Aoi";
    void this.request(
      "thread/name/set",
      { threadId: id, name: `ROOMMATES · ${threadName}` },
      { fatalOnFailure: false },
    ).catch(() => undefined);
    return id;
  }

  private async turn(threadId: string, text: string, outputSchema: unknown): Promise<unknown> {
    const response = (await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text, text_elements: [] }],
      outputSchema,
      approvalPolicy: "never",
    })) as { turn?: { id?: string } };
    const turnId = response.turn?.id;
    if (!turnId) throw new Error("App Server did not return a turn ID");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiter = this.turns.get(turnId);
        if (!waiter) return;
        this.turns.delete(turnId);
        clearTimeout(waiter.timer);
        void this.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
        waiter.reject(new Error(`App Server turn timed out after ${this.turnTimeoutMs}ms`));
      }, this.turnTimeoutMs);
      this.turns.set(turnId, { texts: [], resolve, reject, timer });
    });
  }

  private request(method: string, params: unknown, options: RequestOptions = {}): Promise<unknown> {
    const id = this.nextId++;
    const fatalOnFailure = options.fatalOnFailure ?? true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        const error = new Error(`App Server RPC ${method} timed out after ${this.requestTimeoutMs}ms`);
        if (fatalOnFailure) this.resetProcess(error, true);
        else {
          this.pending.delete(id);
          clearTimeout(pending.timer);
          pending.reject(error);
        }
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        const failure = error instanceof Error ? error : new Error("Codex App Server write failed");
        if (fatalOnFailure) this.resetProcess(failure, true);
        else {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(failure);
        }
      }
    });
  }

  private notify(method: string): void {
    this.write({ method });
  }

  private write(message: unknown): void {
    if (!this.process?.stdin.writable) throw new Error("Codex App Server is not running");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    const pending = [...this.pending.values()];
    const turns = [...this.turns.values()];
    this.pending.clear();
    this.turns.clear();
    for (const request of pending) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    for (const turn of turns) {
      clearTimeout(turn.timer);
      turn.reject(error);
    }
  }

  private resetProcess(error: Error, terminate: boolean): void {
    const child = this.process;
    this.process = undefined;
    this.startPromise = undefined;
    this.threadIds.clear();
    this.sessionScopes.clear();
    this.failAll(error);
    if (terminate && child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // The process may already have exited between the timeout and reset.
      }
    }
  }

  async resetContext(): Promise<void> {
    if (this.activeOperations !== 0) {
      throw new Error("Cannot reset App Server context while operations are active");
    }
    const threadIds = [...this.threadIds.values()];
    this.threadIds.clear();
    this.sessionScopes.clear();
    await Promise.all(threadIds.map((threadId) => this.deleteThreadBestEffort(threadId)));
  }

  async shutdown(): Promise<void> {
    this.resetProcess(new Error("Codex App Server shut down"), true);
  }
}
