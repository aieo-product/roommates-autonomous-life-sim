import type {
  AgentDecision,
  CharacterState,
  GameEvent,
  GameState,
  Memory,
  Phase,
  RelationshipLabel,
  RuntimeInfo,
  StreamMessage,
} from "./types";
import type { CharacterSettings } from "@roommates/shared";

type JsonRecord = Record<string, unknown>;

const initialCharacter = (name: "haru" | "aoi"): CharacterState => ({
  energy: name === "haru" ? 70 : 65,
  stress: name === "haru" ? 25 : 30,
  affection: 20,
  trust: 30,
  romanticAwareness: 5,
  mood: name === "haru" ? "少し緊張している" : "新生活にわくわく",
  location: "リビング",
  currentGoal: name === "haru" ? "新しい生活に慣れる" : "居心地のいい部屋にする",
});

export const INITIAL_GAME_STATE: GameState = {
  revision: 0,
  status: "awaiting_suggestion",
  haru: initialCharacter("haru"),
  aoi: initialCharacter("aoi"),
  shared: {
    day: 1,
    phase: "morning",
    relationshipLabel: "roommates",
    unresolvedConflicts: [],
    sharedMemories: [],
  },
  decisions: {},
  eventLog: [],
  runtime: { mode: "unknown" },
  completed: false,
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

const first = (...values: unknown[]): unknown =>
  values.find((value) => value !== undefined && value !== null);

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value : fallback;

const numeric = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
};

const normalizePhase = (value: unknown, fallback: Phase): Phase => {
  const normalized = text(value).toLowerCase();
  return ["morning", "afternoon", "evening", "night"].includes(normalized)
    ? (normalized as Phase)
    : fallback;
};

const normalizeRelationship = (
  value: unknown,
  fallback: RelationshipLabel,
): RelationshipLabel => {
  const normalized = text(value).toLowerCase();
  return [
    "strangers",
    "roommates",
    "friends",
    "close_friends",
    "romantic_tension",
    "couple",
    "broken",
  ].includes(normalized)
    ? (normalized as RelationshipLabel)
    : fallback;
};

const normalizeCharacter = (
  value: unknown,
  fallback: CharacterState,
): CharacterState => {
  const outer = record(value);
  const source = record(first(outer.state, outer));
  const stats = record(first(source.stats, source.status));
  return {
    energy: numeric(first(source.energy, stats.energy), fallback.energy),
    stress: numeric(first(source.stress, stats.stress), fallback.stress),
    affection: numeric(first(source.affection, stats.affection), fallback.affection),
    trust: numeric(first(source.trust, stats.trust), fallback.trust),
    romanticAwareness: numeric(
      first(
        source.romanticAwareness,
        source.romantic_awareness,
        stats.romanticAwareness,
      ),
      fallback.romanticAwareness,
    ),
    mood: text(first(source.mood, source.emotion), fallback.mood),
    location: text(source.location, fallback.location),
    currentGoal: text(
      first(source.currentGoal, source.current_goal, source.goal),
      fallback.currentGoal,
    ),
  };
};

const normalizeMemory = (value: unknown, index: number): Memory | undefined => {
  const source = record(value);
  const title = text(source.title);
  if (!title) return undefined;
  return {
    id: text(source.id, `memory-${index}-${title}`),
    day: numeric(source.day, 1),
    phase: text(source.phase, "morning"),
    title,
    summary: text(source.summary),
    emotionalImpact: Number(source.emotionalImpact ?? source.emotional_impact ?? 0),
    participants: Array.isArray(source.participants)
      ? source.participants.filter((item): item is string => typeof item === "string")
      : ["Haru", "Aoi"],
    importance: numeric(source.importance, 5),
  };
};

const normalizeDecision = (value: unknown): AgentDecision | undefined => {
  const source = record(value);
  const decision = text(first(source.decision, source.choice)).toUpperCase();
  const allowed = ["ACCEPT", "DECLINE", "MODIFY", "IGNORE", "INITIATE"];
  if (!allowed.includes(decision)) return undefined;
  return {
    decision: decision as AgentDecision["decision"],
    action: text(source.action, "自分のペースで過ごす"),
    dialogue: text(source.dialogue) || undefined,
    publicReason: text(first(source.publicReason, source.public_reason)) || undefined,
    internalSummary:
      text(first(source.internalSummary, source.internal_summary, source.feeling)) ||
      undefined,
  };
};

const normalizeEvent = (
  value: unknown,
  fallbackDay: number,
  fallbackPhase: Phase,
  index = 0,
): GameEvent | undefined => {
  const source = record(value);
  const director = record(first(source.director, source.directorResult, source.result));
  const merged = Object.keys(director).length ? { ...source, ...director } : source;
  const eventTitle = text(first(merged.eventTitle, merged.title, merged.event_title));
  const narration = text(first(merged.narration, merged.summary, merged.description));
  if (!eventTitle && !narration) return undefined;
  const phase = normalizePhase(merged.phase, fallbackPhase);
  const day = numeric(merged.day, fallbackDay);
  return {
    id: text(merged.id, `event-${day}-${phase}-${index}-${eventTitle}`),
    eventDefinitionId:
      text(
        first(
          merged.eventDefinitionId,
          merged.event_definition_id,
          merged.definitionId,
          merged.definition_id,
        ),
      ) || undefined,
    day,
    phase,
    eventTitle: eventTitle || "ふたりの時間",
    narration,
    haruDialogue:
      text(first(merged.haruDialogue, merged.haru_dialogue)) || undefined,
    aoiDialogue: text(first(merged.aoiDialogue, merged.aoi_dialogue)) || undefined,
    suggestion: text(first(merged.suggestion, merged.proposal)) || undefined,
    timestamp: text(merged.timestamp) || undefined,
  };
};

const normalizeRuntime = (
  root: JsonRecord,
  fallback: RuntimeInfo,
): RuntimeInfo => {
  const runtime = record(first(root.runtime, root.agentRuntime, root.appServer));
  const haruRuntime = record(first(runtime.haru, runtime.Haru));
  const aoiRuntime = record(first(runtime.aoi, runtime.Aoi));
  const directorRuntime = record(first(runtime.director, runtime.Director));
  const runtimeSources = [haruRuntime.source, aoiRuntime.source, directorRuntime.source]
    .map((source) => text(source).toLowerCase())
    .filter(Boolean);
  const rawMode = text(
    first(
      runtime.mode,
      root.runtimeMode,
      root.runtime_mode,
      runtime.connected === true ? "app-server" : undefined,
      runtimeSources.some((source) => source === "app_server")
        ? "app-server"
        : runtimeSources.length
          ? "mock"
          : undefined,
    ),
    fallback.mode,
  ).toLowerCase();
  const mode: RuntimeInfo["mode"] = rawMode.includes("mock")
    ? "mock"
    : rawMode.includes("offline")
      ? "offline"
      : rawMode.includes("app") || rawMode.includes("codex") || rawMode === "live"
        ? "app-server"
        : fallback.mode;
  const threads = record(first(runtime.threads, root.threads, root.threadIds));
  return {
    mode,
    label: text(runtime.label) || fallback.label,
    model: text(first(runtime.model, root.model)) || fallback.model,
    haruThreadId:
      text(first(runtime.haruThreadId, haruRuntime.threadId, threads.haru, threads.Haru)) ||
      fallback.haruThreadId,
    aoiThreadId:
      text(first(runtime.aoiThreadId, aoiRuntime.threadId, threads.aoi, threads.Aoi)) ||
      fallback.aoiThreadId,
    directorThreadId:
      text(
        first(
          runtime.directorThreadId,
          directorRuntime.threadId,
          threads.director,
          threads.Director,
        ),
      ) ||
      fallback.directorThreadId,
  };
};

const unwrapState = (payload: unknown): JsonRecord => {
  const outer = record(payload);
  const data = record(outer.data);
  return record(
    first(
      outer.gameState,
      outer.game,
      outer.state,
      data.gameState,
      data.game,
      data.state,
      Object.keys(data).length ? data : undefined,
      outer,
    ),
  );
};

export const normalizeGameState = (
  payload: unknown,
  previous: GameState = INITIAL_GAME_STATE,
): GameState => {
  const root = unwrapState(payload);
  const characters = record(first(root.characters, root.characterStates, root.agents));
  const haruRecord = record(first(characters.haru, characters.Haru));
  const aoiRecord = record(first(characters.aoi, characters.Aoi));
  const shared = record(first(root.shared, root.sharedState, root.world));
  const rawMemories = first(shared.sharedMemories, shared.memories, root.memories);
  const memories = Array.isArray(rawMemories)
    ? rawMemories
        .map(normalizeMemory)
        .filter((item): item is Memory => item !== undefined)
    : previous.shared.sharedMemories;
  const phase = normalizePhase(
    first(shared.phase, root.phase),
    previous.shared.phase,
  );
  const day = numeric(first(shared.day, root.day), previous.shared.day);
  const decisions = record(first(root.decisions, root.agentDecisions, root.lastDecisions));
  const haruDecision = normalizeDecision(
    first(
      decisions.haru,
      decisions.Haru,
      root.haruDecision,
      haruRecord.lastDecision,
    ),
  );
  const aoiDecision = normalizeDecision(
    first(
      decisions.aoi,
      decisions.Aoi,
      root.aoiDecision,
      aoiRecord.lastDecision,
    ),
  );
  const rawEvents = first(root.eventLog, root.events, root.history);
  const eventLog = Array.isArray(rawEvents)
    ? rawEvents
        .map((event, index) => normalizeEvent(event, day, phase, index))
        .filter((event): event is GameEvent => event !== undefined)
    : previous.eventLog;
  const currentEvent = normalizeEvent(
    first(root.currentEvent, root.lastEvent, root.directorResult, root.result),
    day,
    phase,
  );
  const eventLogWithCurrent =
    currentEvent && eventLog.length
      ? eventLog.map((event, index) =>
          index === eventLog.length - 1 &&
          event.day === currentEvent.day &&
          event.phase === currentEvent.phase
            ? {
                ...event,
                haruDialogue: currentEvent.haruDialogue ?? event.haruDialogue,
                aoiDialogue: currentEvent.aoiDialogue ?? event.aoiDialogue,
              }
            : event,
        )
      : eventLog;
  const conflicts = first(shared.unresolvedConflicts, shared.conflicts);
  const endingValue = first(root.ending, root.endingMessage, shared.ending);
  const endingRecord = record(endingValue);
  const endingText = text(
    first(
      endingRecord.narration,
      endingRecord.title,
      endingValue,
    ),
  );
  const rawStatus = text(root.status, previous.status);
  const status = ["awaiting_suggestion", "resolving", "resolved", "ended"].includes(
    rawStatus,
  )
    ? (rawStatus as GameState["status"])
    : previous.status;

  return {
    revision: Number.isFinite(Number(root.revision))
      ? Math.max(0, Math.round(Number(root.revision)))
      : previous.revision,
    status,
    haru: normalizeCharacter(
      first(characters.haru, characters.Haru, root.haru, root.haruState),
      previous.haru,
    ),
    aoi: normalizeCharacter(
      first(characters.aoi, characters.Aoi, root.aoi, root.aoiState),
      previous.aoi,
    ),
    shared: {
      day,
      phase,
      relationshipLabel: normalizeRelationship(
        first(shared.relationshipLabel, shared.relationship, root.relationshipLabel),
        previous.shared.relationshipLabel,
      ),
      unresolvedConflicts: Array.isArray(conflicts)
        ? conflicts.filter((item): item is string => typeof item === "string")
        : previous.shared.unresolvedConflicts,
      sharedMemories: memories,
    },
    decisions: {
      haru: haruDecision ?? previous.decisions.haru,
      aoi: aoiDecision ?? previous.decisions.aoi,
    },
    currentEvent: currentEvent ?? eventLogWithCurrent.at(-1) ?? previous.currentEvent,
    eventLog: eventLogWithCurrent,
    runtime: normalizeRuntime(root, previous.runtime),
    ending: endingText || previous.ending,
    completed:
      root.completed === true ||
      root.gameOver === true ||
      status === "ended" ||
      Boolean(endingText) ||
      previous.completed,
  };
};

const getErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
};

export const getGame = async (signal?: AbortSignal): Promise<unknown> => {
  const response = await fetch("/api/game", { signal });
  if (!response.ok) throw new Error(await getErrorMessage(response));
  return response.json();
};

const postAction = async (path: string, payload: unknown = {}): Promise<unknown> => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await getErrorMessage(response));
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("json") ? response.json() : undefined;
};

export const advanceGame = (): Promise<unknown> => postAction("/api/game/advance");
export const resetGame = (): Promise<unknown> => postAction("/api/game/reset");
export const fastForwardGame = (
  characterSettings: CharacterSettings,
): Promise<unknown> =>
  postAction("/api/game/fast-forward", { characterSettings });

const emitBlock = (
  block: string,
  onMessage: (message: StreamMessage) => void,
): void => {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  let hasSseField = false;
  for (const line of lines) {
    if (line.startsWith(":")) {
      hasSseField = true;
      continue;
    }
    if (line.startsWith("event:")) {
      hasSseField = true;
      event = line.slice(6).trim() || "message";
    }
    if (line.startsWith("data:")) {
      hasSseField = true;
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (hasSseField && dataLines.length === 0) return;
  const raw = dataLines.length ? dataLines.join("\n") : block.trim();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (event === "message" && isRecord(parsed) && typeof parsed.type === "string") {
      onMessage({
        event: parsed.type,
        data: first(parsed.data, parsed.payload, parsed),
      });
    } else {
      onMessage({ event, data: parsed });
    }
  } catch {
    onMessage({ event, data: raw });
  }
};

export const runTurn = async (
  suggestion: string,
  revision: number,
  characterSettings: CharacterSettings,
  onMessage: (message: StreamMessage) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const response = await fetch("/api/game/turn", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify({
      suggestion,
      revision,
      characterSettings,
      idempotencyKey:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
    signal,
  });
  if (!response.ok) throw new Error(await getErrorMessage(response));

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const data = response.status === 204 ? undefined : await response.json();
    onMessage({ event: "done", data });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      emitBlock(buffer.slice(0, boundary), onMessage);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) emitBlock(buffer, onMessage);
};
