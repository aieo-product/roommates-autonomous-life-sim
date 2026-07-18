import type {
  AgentResultReflection,
  CharacterDecision,
  CharacterDecisionInput,
  CharacterId,
  CharacterState,
  CharacterSettings,
  CueInputMethod,
  CueResolutionOutcome,
  GameResult,
  GameSnapshot,
  GameState,
  NavigatorAgentOutput,
  NavigatorInput,
  Phase,
  PublicCharacterDecision,
  RelationshipLabel,
  ResolutionBranch,
  StatDelta,
  StreamEvent,
  TurnStateSnapshot,
} from "@roommates/shared";
import {
  DEFAULT_CHARACTER_SETTINGS,
  createInitialGameState,
  mutableStatKeys,
} from "@roommates/shared";
import type { AgentCoordinator, AgentResult } from "../agents/coordinator.js";
import {
  buildNavigatorResponse,
  fallbackNavigatorOutput,
} from "../agents/navigator.js";
import {
  buildAgentReflectionInput,
  fallbackAgentReflection,
  REFLECTION_VERSION,
} from "../agents/reflection.js";
import type { GameRepository } from "../persistence/repository.js";
import {
  applyDelta,
  confessionEligible,
  createMemory,
  decorateCharacterState,
  deriveRelationship,
  endingFor,
} from "./rules.js";
import { EVENT_DEFINITIONS_BY_ID } from "./event-definitions.js";
import { constrainResolvedEvent } from "./event-policy.js";
import {
  buildProducerResult,
  buildResultNarrative,
  PRODUCER_SCORING_VERSION,
  RESULT_NARRATIVE_VERSION,
} from "./result/index.js";
import { resolveSuggestion } from "./suggestion.js";

type Emit = (event: StreamEvent) => void;
const phaseOrder: Phase[] = ["morning", "afternoon", "evening", "night"];
const cooperative = new Set(["ACCEPT", "MODIFY", "INITIATE"]);

export class GameConflictError extends Error {}

function deepFreeze<T extends object>(value: T): T {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child as object);
  }
  return value;
}

function toPublicDecision(decision: CharacterDecision): PublicCharacterDecision {
  return {
    decision: decision.decision,
    action: decision.action,
    dialogue: decision.dialogue,
    publicReason: decision.publicReason,
  };
}

function turnSnapshot(
  characters: Record<CharacterId, CharacterState>,
  relationshipLabel: RelationshipLabel,
  unresolvedConflicts: string[],
  memoryIds: string[],
): TurnStateSnapshot {
  return {
    characters: structuredClone(characters),
    shared: {
      relationshipLabel,
      unresolvedConflicts: [...unresolvedConflicts],
      memoryIds: [...memoryIds],
    },
  };
}

function appliedStatDelta(before: CharacterState, after: CharacterState): StatDelta {
  const delta: StatDelta = {};
  for (const key of mutableStatKeys) delta[key] = after[key] - before[key];
  return delta;
}

function appliedEffects(
  before: Record<CharacterId, CharacterState>,
  after: Record<CharacterId, CharacterState>,
): Record<CharacterId, StatDelta> {
  return {
    haru: appliedStatDelta(before.haru, after.haru),
    aoi: appliedStatDelta(before.aoi, after.aoi),
  };
}

function resolutionBranch(
  haru: CharacterDecision,
  aoi: CharacterDecision,
): ResolutionBranch {
  if (haru.decision === "INITIATE" || aoi.decision === "INITIATE") return "self_initiated";
  if (haru.decision === "MODIFY" || aoi.decision === "MODIFY") return "modified";
  const haruParticipates = cooperative.has(haru.decision);
  const aoiParticipates = cooperative.has(aoi.decision);
  if (haruParticipates && aoiParticipates) return "both_participated";
  if (haruParticipates || aoiParticipates) return "one_participated";
  return "both_declined";
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Result generation failed").slice(0, 2_000);
}

function safeEmit(emit: Emit, event: StreamEvent): void {
  try {
    emit(event);
  } catch {
    // A disconnected SSE client must not roll back an already committed turn.
  }
}

export class GameEngine {
  private state: GameState = createInitialGameState();
  private resolving = false;
  private completed = new Map<string, GameState>();

  constructor(
    private readonly repository: GameRepository,
    private readonly agents: AgentCoordinator,
  ) {}

  async initialize(): Promise<void> {
    const stored = await this.repository.load();
    if (stored) {
      this.state = stored.status === "resolving" ? { ...stored, status: "awaiting_suggestion", turnId: undefined } : stored;
      if (
        this.state.status === "ended" &&
        this.state.ending &&
        this.state.result?.status === "generating"
      ) {
        this.state = await this.recoverGeneratingResult(this.state);
      } else if (
        this.state.status === "ended" &&
        this.state.ending &&
        !this.state.result
      ) {
        this.state = await this.generateResult(this.state, () => undefined);
      }
    } else {
      await this.repository.save(this.state);
    }
  }

  getState(): GameState {
    return structuredClone(this.state);
  }

  async reset(seed?: string): Promise<GameState> {
    if (this.resolving) throw new GameConflictError("ターン処理中はリセットできません");
    this.state = createInitialGameState(seed ?? "demo-heart");
    this.completed.clear();
    await this.repository.clear();
    await this.repository.save(this.state);
    return this.getState();
  }

  async resolveTurn(
    rawSuggestion: string,
    idempotencyKey: string,
    revision: number,
    emit: Emit = () => undefined,
    characterSettings: CharacterSettings = DEFAULT_CHARACTER_SETTINGS,
    inputMethod?: CueInputMethod,
  ): Promise<GameState> {
    const previous = this.completed.get(idempotencyKey);
    if (previous) return structuredClone(previous);
    if (this.resolving || this.state.status === "resolving") throw new GameConflictError("すでにターンを処理中です");
    if (this.state.status !== "awaiting_suggestion") throw new GameConflictError("先に次のターンへ進んでください");
    if (revision !== this.state.revision) throw new GameConflictError("ゲーム状態が更新されています。再読み込みしてください");

    const before = this.getState();
    const suggestion = deepFreeze(resolveSuggestion(rawSuggestion, before));
    const eventDefinition = EVENT_DEFINITIONS_BY_ID.get(suggestion.eventDefinitionId);
    if (!eventDefinition) {
      throw new Error(`Unknown event definition: ${suggestion.eventDefinitionId}`);
    }
    this.resolving = true;
    const turnId = `${before.shared.day}-${before.shared.phase}-${revision + 1}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
    const snapshot = deepFreeze<GameSnapshot>({
      seed: before.seed,
      revision: before.revision,
      characters: {
        haru: structuredClone(before.characters.haru.state),
        aoi: structuredClone(before.characters.aoi.state),
      },
      shared: structuredClone(before.shared),
    });

    this.state = { ...before, status: "resolving", turnId };
    await this.repository.save(this.state);
    emit({ type: "turn.started", message: `Day ${before.shared.day} ${before.shared.phase} の提案を受け付けました`, data: suggestion });

    let turnCommitted = false;
    try {
      const navigatorInput = deepFreeze<NavigatorInput>({
        turnId,
        rawInput: rawSuggestion.slice(0, 500),
        day: before.shared.day,
        phase: before.shared.phase,
        resolvedSuggestion: suggestion,
      });
      emit({
        type: "navigator.thinking",
        agent: "navigator",
        message: "デコピンが指示を確認しています…",
      });
      let navigator: AgentResult<NavigatorAgentOutput>;
      if (inputMethod === "fast_forward") {
        navigator = {
          value: fallbackNavigatorOutput(navigatorInput),
          runtime: { source: "mock", latencyMs: 0 },
        };
      } else if (!this.agents.navigate) {
        navigator = {
          value: fallbackNavigatorOutput(navigatorInput),
          runtime: {
            source: "fallback",
            error: "Navigator agent is unavailable",
          },
        };
      } else {
        try {
          navigator = await this.agents.navigate(navigatorInput);
        } catch (error) {
          navigator = {
            value: fallbackNavigatorOutput(navigatorInput),
            runtime: {
              source: "fallback",
              error: errorMessage(error).slice(0, 180),
            },
          };
        }
      }
      const navigatorResponse = buildNavigatorResponse(navigatorInput, navigator.value);
      emit({
        type: "navigator.completed",
        agent: "navigator",
        message: navigatorResponse.message,
        data: {
          ...navigatorResponse,
          navigatorMessage: navigatorResponse.message,
        },
      });

      const buildInput = (id: CharacterId): CharacterDecisionInput => {
        const other = id === "haru" ? "aoi" : "haru";
        const recent = snapshot.shared.sharedMemories.slice(-5);
        const important = snapshot.shared.sharedMemories.filter((memory) => memory.importance >= 6).slice(-5);
        return {
          turnId,
          characterId: id,
          character: structuredClone(characterSettings.characters[id]),
          snapshot,
          self: snapshot.characters[id],
          otherKnownInfo: {
            mood: snapshot.characters[other].mood,
            location: snapshot.characters[other].location,
            currentGoal: snapshot.characters[other].currentGoal,
          },
          recentMemories: recent,
          importantMemories: important,
          suggestion,
        };
      };

      emit({ type: "agent.thinking", agent: "haru", message: "Haru is thinking…" });
      emit({ type: "agent.thinking", agent: "aoi", message: "Aoi is thinking…" });
      const [haru, aoi] = await Promise.all([
        this.agents.decide("haru", buildInput("haru")),
        this.agents.decide("aoi", buildInput("aoi")),
      ]);
      emit({
        type: "agent.completed",
        agent: "haru",
        message: `Haru: ${haru.value.decision}`,
        data: toPublicDecision(haru.value),
      });
      emit({
        type: "agent.completed",
        agent: "aoi",
        message: `Aoi: ${aoi.value.decision}`,
        data: toPublicDecision(aoi.value),
      });
      if (haru.runtime.source === "fallback" || aoi.runtime.source === "fallback") {
        emit({ type: "warning", message: "App Serverに接続できないため、安全なモックへ切り替えました" });
      }

      emit({ type: "director.resolving", agent: "director", message: "Director is resolving…" });
      const director = await this.agents.resolve({
        turnId,
        snapshot,
        suggestion,
        haruDecision: haru.value,
        aoiDecision: aoi.value,
      });
      let resolved = {
        ...constrainResolvedEvent(
          eventDefinition,
          director.value,
          { haru: haru.value, aoi: aoi.value },
          before.shared.unresolvedConflicts,
          {
            suppressRelationshipEffects:
              suggestion.cue.transformed && eventDefinition.category === "rest",
          },
        ),
        navigatorMessage: navigatorResponse.message,
      };
      emit({ type: "director.completed", agent: "director", message: resolved.eventTitle, data: resolved });

      const nextCharacters = {
        haru: applyDelta(before.characters.haru.state, resolved.effects.haru),
        aoi: applyDelta(before.characters.aoi.state, resolved.effects.aoi),
      };
      if (resolved.scene?.haru) nextCharacters.haru.location = resolved.scene.haru;
      if (resolved.scene?.aoi) nextCharacters.aoi.location = resolved.scene.aoi;

      const conflicts = before.shared.unresolvedConflicts
        .filter((conflict) => !resolved.conflictUpdate?.resolve?.includes(conflict))
        .concat(resolved.conflictUpdate?.add ?? []);
      let relationship = deriveRelationship(nextCharacters, conflicts, before.shared.relationshipLabel);
      const memory = createMemory(resolved.memory, before.shared.day, before.shared.phase, turnId);
      const independentYes = cooperative.has(haru.value.decision) && cooperative.has(aoi.value.decision);
      if (eventDefinition.category === "confession" && independentYes && confessionEligible(snapshot)) {
        relationship = "couple";
        resolved = {
          ...resolved,
          eventTitle: "二人が選んだ告白",
          narration: `${resolved.narration} きっかけに急かされるのではなく、二人はそれぞれの意志で気持ちを伝え、受け止めた。`,
          memory: { ...resolved.memory, title: "二人が選んだ告白" },
        };
        memory.title = "二人が選んだ告白";
      }

      const positive = resolved.memory.emotionalImpact > 0;
      nextCharacters.haru = decorateCharacterState(nextCharacters.haru, "haru", positive);
      nextCharacters.aoi = decorateCharacterState(nextCharacters.aoi, "aoi", positive);
      nextCharacters.haru.currentGoal = haru.value.action;
      nextCharacters.aoi.currentGoal = aoi.value.action;
      const isLastTurn = before.shared.day === 7 && before.shared.phase === "night";
      const haruPublicDecision = toPublicDecision(haru.value);
      const aoiPublicDecision = toPublicDecision(aoi.value);
      const beforeSnapshot = turnSnapshot(
        {
          haru: before.characters.haru.state,
          aoi: before.characters.aoi.state,
        },
        before.shared.relationshipLabel,
        before.shared.unresolvedConflicts,
        before.shared.sharedMemories.map((item) => item.id),
      );
      const afterSnapshot = turnSnapshot(
        nextCharacters,
        relationship,
        conflicts,
        [...before.shared.sharedMemories.map((item) => item.id), memory.id],
      );
      const cueOutcome: CueResolutionOutcome = navigatorResponse.outcome;
      const nextState: GameState = {
        ...before,
        revision: before.revision + 1,
        status: isLastTurn ? "ended" : "resolved",
        turnId,
        characters: {
          haru: { state: nextCharacters.haru, lastDecision: haruPublicDecision },
          aoi: { state: nextCharacters.aoi, lastDecision: aoiPublicDecision },
        },
        shared: {
          ...before.shared,
          relationshipLabel: relationship,
          unresolvedConflicts: conflicts,
          sharedMemories: [...before.shared.sharedMemories, memory].slice(-40),
        },
        lastEvent: resolved,
        navigator: navigatorResponse,
        eventLog: [
          ...before.eventLog,
          {
            id: `log-${turnId}`,
            turnId,
            day: before.shared.day,
            phase: before.shared.phase,
            eventDefinitionId: eventDefinition.id,
            eventCategory: eventDefinition.category,
            intimacyTier: eventDefinition.intimacyTier,
            cooldownPhases: eventDefinition.cooldownPhases,
            cueSafetyFlags: suggestion.cue.safetyFlags,
            suggestion: suggestion.text,
            haruReaction: `${haru.value.decision}: ${haru.value.action}`,
            aoiReaction: `${aoi.value.decision}: ${aoi.value.action}`,
            haruDecision: haru.value.decision,
            aoiDecision: aoi.value.decision,
            haruAction: haru.value.action,
            aoiAction: aoi.value.action,
            haruDialogue: resolved.haruDialogue,
            aoiDialogue: resolved.aoiDialogue,
            haruPublicReason: haru.value.publicReason,
            aoiPublicReason: aoi.value.publicReason,
            scene: {
              haru: nextCharacters.haru.location,
              aoi: nextCharacters.aoi.location,
            },
            memoryId: memory.id,
            cue: suggestion.cue,
            inputMethod:
              inputMethod ??
              (suggestion.kind === "observe" ? "observe" : "free_text"),
            requestedEventId: suggestion.lock?.requestedEventId,
            alternativesShown: suggestion.alternatives,
            lock: suggestion.lock,
            cueOutcome,
            navigatorMessage: navigatorResponse.message,
            navigatorResponse,
            decisions: { haru: haruPublicDecision, aoi: aoiPublicDecision },
            resolutionBranch: resolutionBranch(haru.value, aoi.value),
            before: beforeSnapshot,
            after: afterSnapshot,
            appliedEffects: appliedEffects(beforeSnapshot.characters, afterSnapshot.characters),
            memory,
            conflictUpdate: {
              add: resolved.conflictUpdate?.add ?? [],
              resolve: resolved.conflictUpdate?.resolve ?? [],
            },
            runtimeSources: {
              haru: haru.runtime.source,
              aoi: aoi.runtime.source,
              navigator: navigator.runtime.source,
              director: director.runtime.source,
            },
            eventTitle: resolved.eventTitle,
            narration: resolved.narration,
            relationshipBefore: before.shared.relationshipLabel,
            relationshipAfter: relationship,
            createdAt: new Date().toISOString(),
          },
        ].slice(-50),
        runtime: {
          haru: haru.runtime,
          aoi: aoi.runtime,
          navigator: navigator.runtime,
          director: director.runtime,
        },
        ending: isLastTurn ? endingFor(relationship, nextCharacters) : undefined,
      };

      this.state = nextState;
      await this.repository.save(this.state);
      turnCommitted = true;
      if (isLastTurn) this.state = await this.generateResult(this.state, emit);
      this.completed.set(idempotencyKey, this.getState());
      if (this.completed.size > 20) this.completed.delete(this.completed.keys().next().value ?? "");
      emit({ type: "turn.completed", message: resolved.eventTitle, data: this.getState() });
      return this.getState();
    } catch (error) {
      if (!turnCommitted) {
        this.state = { ...before, status: "awaiting_suggestion", turnId: undefined };
        await this.repository.save(this.state);
      }
      throw error;
    } finally {
      this.resolving = false;
    }
  }

  private async generateResult(terminalState: GameState, emit: Emit): Promise<GameState> {
    if (terminalState.status !== "ended" || !terminalState.ending) return terminalState;
    if (terminalState.result?.status === "ready" || terminalState.result?.status === "partial") {
      return terminalState;
    }
    if (terminalState.result?.status === "generating") {
      return this.recoverGeneratingResult(terminalState);
    }

    let producer: ReturnType<typeof buildProducerResult>;
    try {
      producer = buildProducerResult(terminalState.eventLog, terminalState.ending);
    } catch {
      safeEmit(emit, {
        type: "warning",
        message: "リザルトのスコアを作成できませんでした",
      });
      return terminalState;
    }

    const identity = {
      generationKey: [
        "result",
        terminalState.seed,
        terminalState.revision,
        PRODUCER_SCORING_VERSION,
        RESULT_NARRATIVE_VERSION,
        REFLECTION_VERSION,
      ].join(":"),
      endingRevision: terminalState.revision,
      scoringVersion: PRODUCER_SCORING_VERSION,
      narrativeVersion: RESULT_NARRATIVE_VERSION,
      reflectionVersion: REFLECTION_VERSION,
    } as const;
    const generating: GameResult = {
      ...identity,
      status: "generating",
      ending: terminalState.ending,
      producer,
      startedAt: new Date().toISOString(),
    };
    this.state = { ...terminalState, result: generating };
    await this.repository.save(this.state);
    safeEmit(emit, {
      type: "result.generating",
      message: "7日間の総集編とアフターインタビューを作成しています",
      data: generating,
    });

    const failures: Array<{
      component: "narrative" | "haru_reflection" | "aoi_reflection";
      reason: string;
      retryable: boolean;
    }> = [];
    let narrative: ReturnType<typeof buildResultNarrative> | undefined;
    try {
      narrative = buildResultNarrative(
        terminalState.eventLog,
        terminalState.ending,
        producer.highlights,
      );
    } catch {
      failures.push({
        component: "narrative",
        reason: "Result narrative could not be built from the saved log",
        retryable: true,
      });
    }

    const highlightIds = producer.highlights
      .map((highlight) => highlight.eventLogIds[0])
      .filter((id): id is string => Boolean(id));
    const reflect = async (
      id: CharacterId,
    ): Promise<{
      value?: AgentResultReflection;
      failure?: {
        component: "haru_reflection" | "aoi_reflection";
        reason: string;
        retryable: boolean;
      };
    }> => {
      const component = `${id}_reflection` as const;
      safeEmit(emit, {
        type: "agent.reflecting",
        agent: id,
        message: `${id === "haru" ? "Haru" : "Aoi"}が7日間を振り返っています`,
      });

      let input: ReturnType<typeof buildAgentReflectionInput>;
      try {
        input = buildAgentReflectionInput(terminalState, id, highlightIds);
      } catch {
        return {
          failure: {
            component,
            reason: "Reflection input could not be built from the saved public log",
            retryable: false,
          },
        };
      }

      if (!this.agents.reflect) {
        return {
          value: {
            ...fallbackAgentReflection(input),
            runtime: {
              source: "fallback",
              error: "Reflection agent is unavailable",
            },
          },
          failure: {
            component,
            reason: "Reflection agent is unavailable",
            retryable: true,
          },
        };
      }

      try {
        const reflected = await this.agents.reflect(id, input);
        const value: AgentResultReflection = {
          ...reflected.value,
          runtime: reflected.runtime,
        };
        safeEmit(emit, {
          type: "agent.reflected",
          agent: id,
          message: `${id === "haru" ? "Haru" : "Aoi"}の振り返りが届きました`,
          data: value,
        });
        return reflected.runtime.source === "fallback" && reflected.runtime.error
          ? {
              value,
              failure: {
                component,
                reason: reflected.runtime.error,
                retryable: true,
              },
            }
          : { value };
      } catch (error) {
        const reason = errorMessage(error);
        return {
          value: {
            ...fallbackAgentReflection(input),
            runtime: { source: "fallback", error: reason },
          },
          failure: { component, reason, retryable: true },
        };
      }
    };

    const [haru, aoi] = await Promise.all([reflect("haru"), reflect("aoi")]);
    if (haru.failure) failures.push(haru.failure);
    if (aoi.failure) failures.push(aoi.failure);
    const reflections: Partial<Record<CharacterId, AgentResultReflection>> = {};
    if (haru.value) reflections.haru = haru.value;
    if (aoi.value) reflections.aoi = aoi.value;

    const generatedAt = new Date().toISOString();
    const result: GameResult =
      failures.length === 0 && narrative && haru.value && aoi.value
        ? {
            ...identity,
            status: "ready",
            ending: terminalState.ending,
            producer,
            narrative,
            reflections: { haru: haru.value, aoi: aoi.value },
            generatedAt,
            dataQuality: "complete",
          }
        : {
            ...identity,
            status: "partial",
            ending: terminalState.ending,
            producer,
            ...(narrative ? { narrative } : {}),
            reflections,
            failures,
            generatedAt,
            dataQuality: "partial",
          };
    this.state = { ...terminalState, result };
    await this.repository.save(this.state);
    safeEmit(emit, {
      type: "result.completed",
      message:
        result.status === "ready"
          ? "7日間のリザルトが完成しました"
          : "取得できた内容でリザルトを作成しました",
      data: result,
    });
    return this.getState();
  }

  /**
   * A persisted `generating` state means a previous process may already have
   * called the external reflection agents. Recovery is deliberately local and
   * non-generative so restart never duplicates those side effects.
   */
  private async recoverGeneratingResult(terminalState: GameState): Promise<GameState> {
    const generating = terminalState.result;
    if (
      terminalState.status !== "ended" ||
      !terminalState.ending ||
      generating?.status !== "generating"
    ) {
      return terminalState;
    }

    const failures: Array<{
      component: "narrative" | "haru_reflection" | "aoi_reflection";
      reason: string;
      retryable: boolean;
    }> = [];
    let narrative: ReturnType<typeof buildResultNarrative> | undefined;
    try {
      narrative = buildResultNarrative(
        terminalState.eventLog,
        terminalState.ending,
        generating.producer.highlights,
      );
    } catch {
      failures.push({
        component: "narrative",
        reason: "Result narrative could not be recovered from the saved log",
        retryable: true,
      });
    }

    const highlightIds = generating.producer.highlights
      .map((highlight) => highlight.eventLogIds[0])
      .filter((id): id is string => Boolean(id));
    const reflections: Partial<Record<CharacterId, AgentResultReflection>> = {};
    for (const id of ["haru", "aoi"] as const) {
      const component = `${id}_reflection` as const;
      try {
        const input = buildAgentReflectionInput(terminalState, id, highlightIds);
        reflections[id] = {
          ...fallbackAgentReflection(input),
          runtime: {
            source: "fallback",
            error: "Reflection generation was interrupted before completion",
          },
        };
        failures.push({
          component,
          reason: "Reflection generation was interrupted before completion",
          retryable: true,
        });
      } catch {
        failures.push({
          component,
          reason: "Reflection input could not be recovered from the saved public log",
          retryable: false,
        });
      }
    }

    const result: GameResult = {
      generationKey: generating.generationKey,
      endingRevision: generating.endingRevision,
      scoringVersion: generating.scoringVersion,
      narrativeVersion: generating.narrativeVersion,
      reflectionVersion: generating.reflectionVersion,
      status: "partial",
      ending: terminalState.ending,
      producer: generating.producer,
      ...(narrative ? { narrative } : {}),
      reflections,
      failures,
      generatedAt: new Date().toISOString(),
      dataQuality: "partial",
    };
    this.state = { ...terminalState, result };
    await this.repository.save(this.state);
    return this.getState();
  }

  async advance(): Promise<GameState> {
    if (this.resolving) throw new GameConflictError("ターン処理中です");
    if (this.state.status !== "resolved") throw new GameConflictError("現在のターンを先に完了してください");
    const currentIndex = phaseOrder.indexOf(this.state.shared.phase);
    const wraps = currentIndex === phaseOrder.length - 1;
    this.state = {
      ...this.state,
      revision: this.state.revision + 1,
      status: "awaiting_suggestion",
      turnId: undefined,
      shared: {
        ...this.state.shared,
        day: wraps ? Math.min(7, this.state.shared.day + 1) : this.state.shared.day,
        phase: phaseOrder[(currentIndex + 1) % phaseOrder.length]!,
      },
    };
    await this.repository.save(this.state);
    return this.getState();
  }

  async fastForward(
    turns = 8,
    characterSettings: CharacterSettings = DEFAULT_CHARACTER_SETTINGS,
  ): Promise<GameState> {
    const presets = [
      "一緒に夕食を作ってみたら？",
      "今日は二人で映画を見よう",
      "温かい飲み物を飲みながら話してみて",
      "部屋に花を置いてみよう",
    ];
    for (let index = 0; index < Math.max(1, Math.min(12, turns)); index += 1) {
      if (this.state.status === "ended") break;
      if (this.state.status === "resolved") await this.advance();
      await this.resolveTurn(
        presets[index % presets.length]!,
        `fast-${globalThis.crypto.randomUUID()}`,
        this.state.revision,
        () => undefined,
        characterSettings,
        "fast_forward",
      );
    }
    return this.getState();
  }
}
