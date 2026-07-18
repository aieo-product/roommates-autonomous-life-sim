import type {
  CharacterDecisionInput,
  CharacterId,
  DirectorInput,
  NavigatorInput,
} from "@roommates/shared";
import type { AppServerAdapter } from "../coordinator.js";
import type { AgentReflectionInput } from "../reflection.js";

export const MAX_AGENT_WORKER_RESPONSE_BYTES = 256 * 1024;
export const DEFAULT_AGENT_WORKER_TIMEOUT_MS = 60_000;
export const DEFAULT_AGENT_WORKER_PROBE_TIMEOUT_MS = 2_000;
export const DEFAULT_AGENT_WORKER_RETRY_AFTER_MS = 5_000;

type AgentWorkerOperation = "navigate" | "decide" | "resolve" | "reflect";

type AgentWorkerEnvelope = {
  value: unknown;
  threadId: string;
};

export type AgentWorkerClientOptions = {
  baseUrl: string;
  sessionId: string;
  /** Conversation namespace. Rotate this when the game is reset. */
  scopeId?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
  timeoutMs?: number;
  probeTimeoutMs?: number;
  retryAfterMs?: number;
};

const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function safeHeaderSegment(value: string, maxLength: number): string {
  const segment = value
    .trim()
    .replace(/[^A-Za-z0-9._~-]/g, "_")
    .slice(0, maxLength);
  return segment || "-";
}

function turnIdFrom(input: unknown): string | undefined {
  if (!isRecord(input) || typeof input.turnId !== "string") return undefined;
  const turnId = input.turnId.trim();
  return turnId || undefined;
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalJsonValue(item) ?? null);
  }
  if (isRecord(value)) {
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = canonicalJsonValue(value[key]);
      if (item !== undefined) canonical[key] = item;
    }
    return canonical;
  }
  return undefined;
}

async function inputHash(input: unknown): Promise<string> {
  const canonical = JSON.stringify(canonicalJsonValue(input));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Preserve the original HTTP or size error if the peer already closed.
  }
}

export class AgentWorkerClient implements AppServerAdapter {
  private readonly invokeUrl: string;
  private readonly healthUrl: string;
  private readonly sessionId: string;
  private scopeId: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;
  private readonly probeTimeoutMs: number;
  private readonly retryAfterMs: number;
  private unavailableReason?: Error;
  private unavailableAt?: number;
  private readinessPromise?: Promise<void>;

  constructor(options: AgentWorkerClientOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.username || baseUrl.password) {
      throw new Error("Agent Worker baseUrl must not contain userinfo");
    }
    const loopback = isLoopbackHostname(baseUrl.hostname);
    if (
      baseUrl.protocol !== "https:" &&
      !(baseUrl.protocol === "http:" && loopback)
    ) {
      throw new Error(
        "Agent Worker baseUrl must use HTTPS, except for loopback development",
      );
    }
    if (!options.sessionId.trim()) {
      throw new Error("Agent Worker sessionId must not be empty");
    }
    const scopeId = options.scopeId?.trim() || options.sessionId.trim();
    if (!SCOPE_ID_PATTERN.test(scopeId)) {
      throw new Error(
        "Agent Worker scopeId must be 1-128 ASCII letters, numbers, dots, underscores, colons, or hyphens",
      );
    }
    const token = options.token?.trim() || undefined;
    if (!loopback && !token) {
      throw new Error("Agent Worker token is required for non-loopback URLs");
    }

    const maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? MAX_AGENT_WORKER_RESPONSE_BYTES,
      "Agent Worker maxResponseBytes",
    );
    if (maxResponseBytes > MAX_AGENT_WORKER_RESPONSE_BYTES) {
      throw new Error(
        `Agent Worker maxResponseBytes must not exceed ${MAX_AGENT_WORKER_RESPONSE_BYTES}`,
      );
    }

    baseUrl.search = "";
    baseUrl.hash = "";
    if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
    this.invokeUrl = new URL("v1/invoke", baseUrl).toString();
    this.healthUrl = new URL("health", baseUrl).toString();
    this.sessionId = options.sessionId;
    this.scopeId = scopeId;
    this.token = token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxResponseBytes = maxResponseBytes;
    this.timeoutMs = positiveInteger(
      options.timeoutMs ?? DEFAULT_AGENT_WORKER_TIMEOUT_MS,
      "Agent Worker timeoutMs",
    );
    this.probeTimeoutMs = positiveInteger(
      options.probeTimeoutMs ?? DEFAULT_AGENT_WORKER_PROBE_TIMEOUT_MS,
      "Agent Worker probeTimeoutMs",
    );
    this.retryAfterMs = positiveInteger(
      options.retryAfterMs ?? DEFAULT_AGENT_WORKER_RETRY_AFTER_MS,
      "Agent Worker retryAfterMs",
    );
  }

  async navigate(input: NavigatorInput): Promise<AgentWorkerEnvelope> {
    return this.invoke("navigate", undefined, input);
  }

  async decide(
    id: CharacterId,
    input: CharacterDecisionInput,
  ): Promise<AgentWorkerEnvelope> {
    return this.invoke("decide", id, input);
  }

  async resolve(input: DirectorInput): Promise<AgentWorkerEnvelope> {
    return this.invoke("resolve", undefined, input);
  }

  async reflect(
    id: CharacterId,
    input: AgentReflectionInput,
  ): Promise<AgentWorkerEnvelope> {
    return this.invoke("reflect", id, input);
  }

  async shutdown(): Promise<void> {
    // The remote Agent Worker owns the App Server process and its lifecycle.
  }

  async resetContext(): Promise<void> {
    this.scopeId = `${this.sessionId}:${crypto.randomUUID()}`;
    this.unavailableReason = undefined;
    this.unavailableAt = undefined;
    this.readinessPromise = undefined;
  }

  private async idempotencyKey(
    operation: AgentWorkerOperation,
    characterId: CharacterId | undefined,
    input: unknown,
  ): Promise<string> {
    const session = safeHeaderSegment(this.scopeId, 72);
    const character = characterId ?? "-";
    const turnId = turnIdFrom(input);
    if (!turnId) {
      return `${session}:${operation}:${character}:${await inputHash(input)}`;
    }
    return [
      session,
      safeHeaderSegment(turnId, 96),
      operation,
      character,
    ].join(":");
  }

  private async invoke(
    operation: AgentWorkerOperation,
    characterId: CharacterId | undefined,
    input: unknown,
  ): Promise<AgentWorkerEnvelope> {
    this.retryIfDue();
    if (this.unavailableReason) throw this.unavailableReason;
    await this.ensureReady();
    if (this.unavailableReason) throw this.unavailableReason;
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Idempotency-Key": await this.idempotencyKey(
        operation,
        characterId,
        input,
      ),
    });
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);

    const body = JSON.stringify({
      operation,
      ...(characterId ? { characterId } : {}),
      sessionId: this.sessionId,
      ...(this.scopeId === this.sessionId ? {} : { scopeId: this.scopeId }),
      input,
    });
    const controller = new AbortController();
    let didTimeout = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        didTimeout = true;
        controller.abort();
        reject(
          new Error(`Agent Worker request timed out after ${this.timeoutMs}ms`),
        );
      }, this.timeoutMs);
    });

    try {
      let response: Response;
      try {
        response = await Promise.race([
          this.fetchImpl(this.invokeUrl, {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
          }),
          timeout,
        ]);
      } catch (error) {
        if (didTimeout) {
          throw this.disable(
            new Error(
              `Agent Worker request timed out after ${this.timeoutMs}ms`,
              { cause: error },
            ),
          );
        }
        const message =
          error instanceof Error ? error.message : "unknown fetch error";
        throw this.disable(
          new Error(`Agent Worker request failed: ${message}`, {
            cause: error,
          }),
        );
      }

      if (!response.ok) {
        await cancelBody(response);
        const error = new Error(`Agent Worker returned HTTP ${response.status}`);
        if (
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404 ||
          response.status === 429 ||
          (response.status >= 500 && response.status !== 502)
        ) {
          throw this.disable(error);
        }
        throw error;
      }

      let parsed: unknown;
      try {
        parsed = await Promise.race([this.readJson(response), timeout]);
      } catch (error) {
        if (didTimeout) {
          throw this.disable(
            new Error(
              `Agent Worker request timed out after ${this.timeoutMs}ms`,
              { cause: error },
            ),
          );
        }
        throw this.disable(
          error instanceof Error
            ? error
            : new Error("Agent Worker returned an invalid response"),
        );
      }
      if (
        !isRecord(parsed) ||
        !Object.prototype.hasOwnProperty.call(parsed, "value") ||
        typeof parsed.threadId !== "string" ||
        !parsed.threadId.trim()
      ) {
        throw this.disable(
          new Error("Agent Worker returned an invalid response envelope"),
        );
      }
      return { value: parsed.value, threadId: parsed.threadId };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private disable(error: Error): Error {
    if (!this.unavailableReason) {
      this.unavailableReason = error;
      this.unavailableAt = Date.now();
    }
    return this.unavailableReason;
  }

  private retryIfDue(): void {
    if (
      this.unavailableReason &&
      this.unavailableAt !== undefined &&
      Date.now() - this.unavailableAt >= this.retryAfterMs
    ) {
      this.unavailableReason = undefined;
      this.unavailableAt = undefined;
      this.readinessPromise = undefined;
    }
  }

  private ensureReady(): Promise<void> {
    this.retryIfDue();
    if (this.unavailableReason) return Promise.reject(this.unavailableReason);
    this.readinessPromise ??= this.probeReadiness().catch((error: unknown) => {
      throw this.disable(
        error instanceof Error
          ? error
          : new Error("Agent Worker readiness probe failed"),
      );
    });
    return this.readinessPromise;
  }

  private async probeReadiness(): Promise<void> {
    const headers = new Headers({ Accept: "application/json" });
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    const controller = new AbortController();
    let didTimeout = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        didTimeout = true;
        controller.abort();
        reject(
          new Error(
            `Agent Worker readiness probe timed out after ${this.probeTimeoutMs}ms`,
          ),
        );
      }, this.probeTimeoutMs);
    });

    try {
      let response: Response;
      try {
        response = await Promise.race([
          this.fetchImpl(this.healthUrl, {
            method: "GET",
            headers,
            signal: controller.signal,
          }),
          timeout,
        ]);
      } catch (error) {
        if (didTimeout) {
          throw new Error(
            `Agent Worker readiness probe timed out after ${this.probeTimeoutMs}ms`,
            { cause: error },
          );
        }
        const message =
          error instanceof Error ? error.message : "unknown fetch error";
        throw new Error(`Agent Worker readiness probe failed: ${message}`, {
          cause: error,
        });
      }

      if (!response.ok) {
        await cancelBody(response);
        throw new Error(
          `Agent Worker readiness probe returned HTTP ${response.status}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = await Promise.race([this.readJson(response), timeout]);
      } catch (error) {
        if (didTimeout) {
          throw new Error(
            `Agent Worker readiness probe timed out after ${this.probeTimeoutMs}ms`,
            { cause: error },
          );
        }
        throw new Error("Agent Worker readiness probe returned invalid JSON", {
          cause: error,
        });
      }
      if (!isRecord(parsed) || parsed.ok !== true) {
        throw new Error(
          "Agent Worker readiness probe returned an invalid response",
        );
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    const declaredLength = response.headers.get("Content-Length");
    if (declaredLength) {
      const parsedLength = Number(declaredLength);
      if (Number.isFinite(parsedLength) && parsedLength > this.maxResponseBytes) {
        await cancelBody(response);
        throw new Error(
          `Agent Worker response exceeded ${this.maxResponseBytes} bytes`,
        );
      }
    }
    if (!response.body) {
      throw new Error("Agent Worker returned invalid JSON");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > this.maxResponseBytes) {
          await reader.cancel();
          throw new Error(
            `Agent Worker response exceeded ${this.maxResponseBytes} bytes`,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error("Agent Worker returned invalid JSON", { cause: error });
    }
  }
}
