import type { GameState, RuntimeAgentState, StreamEvent } from "@roommates/shared";

export type PublicRuntimeAgentState = Pick<RuntimeAgentState, "source" | "latencyMs">;

export const PUBLIC_STREAM_ERROR_MESSAGE =
  "ターンの処理に失敗しました。時間をおいて、もう一度お試しください。";

export const PUBLIC_RESULT_FAILURE_REASONS = {
  narrative: "RESULT_NARRATIVE_UNAVAILABLE",
  haru_reflection: "RESULT_REFLECTION_UNAVAILABLE",
  aoi_reflection: "RESULT_REFLECTION_UNAVAILABLE",
} as const;

const PRIVATE_KEYS = new Set([
  "internalSummary",
  "expectedEffects",
  "threadId",
  "error",
  "stack",
  "cause",
  "rawInput",
  "rawSuggestion",
  "requestHash",
  "idempotencyKey",
]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPublicRuntimeAgentState(value: unknown): PublicRuntimeAgentState | undefined {
  if (!isRecord(value) || typeof value.source !== "string") return undefined;

  const runtime: JsonRecord = { source: value.source };
  if (
    typeof value.latencyMs === "number" &&
    Number.isFinite(value.latencyMs) &&
    value.latencyMs >= 0
  ) {
    runtime.latencyMs = value.latencyMs;
  }
  return runtime as PublicRuntimeAgentState;
}

function toPublicRuntime(value: unknown): unknown {
  const direct = toPublicRuntimeAgentState(value);
  if (direct) return direct;
  if (!isRecord(value)) return undefined;

  const runtimeByAgent: JsonRecord = {};
  for (const [agent, agentRuntime] of Object.entries(value)) {
    const publicRuntime = toPublicRuntimeAgentState(agentRuntime);
    if (publicRuntime) runtimeByAgent[agent] = publicRuntime;
  }
  return runtimeByAgent;
}

function publicFailureReason(component: unknown): string {
  if (typeof component !== "string") return "RESULT_COMPONENT_UNAVAILABLE";
  return (
    PUBLIC_RESULT_FAILURE_REASONS[
      component as keyof typeof PUBLIC_RESULT_FAILURE_REASONS
    ] ?? "RESULT_COMPONENT_UNAVAILABLE"
  );
}

function toPublicResultFailures(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((failure) => ({
    ...(typeof failure.component === "string" ? { component: failure.component } : {}),
    reason: publicFailureReason(failure.component),
    ...(typeof failure.retryable === "boolean" ? { retryable: failure.retryable } : {}),
  }));
}

function toPublicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPublicValue);
  if (!isRecord(value)) return value;

  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key)) continue;
    if (key === "runtime") {
      const runtime = toPublicRuntime(child);
      if (runtime !== undefined) result[key] = runtime;
      continue;
    }
    if (key === "failures") {
      result[key] = toPublicResultFailures(child);
      continue;
    }
    result[key] = toPublicValue(child);
  }
  return result;
}

/**
 * Projects the authoritative state onto the API-safe shape.
 *
 * The generic return keeps callers on the shared GameState contract while this
 * boundary deliberately removes optional/private fields at runtime.
 */
export function toPublicGameState<T extends GameState>(state: T): T {
  return toPublicValue(state) as T;
}

/** Projects all SSE payloads through the same privacy boundary as GET /api/game. */
export function toPublicStreamEvent(event: StreamEvent): StreamEvent {
  if (event.type === "error") {
    return {
      type: "error",
      message: PUBLIC_STREAM_ERROR_MESSAGE,
      ...(event.agent ? { agent: event.agent } : {}),
    };
  }

  return {
    type: event.type,
    message: event.message,
    ...(event.agent ? { agent: event.agent } : {}),
    ...(event.data === undefined ? {} : { data: toPublicValue(event.data) }),
  };
}
