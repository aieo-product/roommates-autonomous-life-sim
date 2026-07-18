import { randomUUID } from "node:crypto";
import type {
  CharacterDecisionInput,
  CharacterId,
  CharacterSettings,
  GameSnapshot,
  GameState,
  Phase,
  StreamEvent,
} from "@roommates/shared";
import { DEFAULT_CHARACTER_SETTINGS, createInitialGameState } from "@roommates/shared";
import type { AgentCoordinator } from "../agents/coordinator.js";
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
    const turnId = `${before.shared.day}-${before.shared.phase}-${revision + 1}-${randomUUID().slice(0, 8)}`;
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

    try {
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
      emit({ type: "agent.completed", agent: "haru", message: `Haru: ${haru.value.decision}`, data: haru.value });
      emit({ type: "agent.completed", agent: "aoi", message: `Aoi: ${aoi.value.decision}`, data: aoi.value });
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
      let resolved = constrainResolvedEvent(
        eventDefinition,
        director.value,
        { haru: haru.value, aoi: aoi.value },
        before.shared.unresolvedConflicts,
        {
          suppressRelationshipEffects:
            suggestion.cue.transformed && eventDefinition.category === "rest",
        },
      );
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
      const nextState: GameState = {
        ...before,
        revision: before.revision + 1,
        status: isLastTurn ? "ended" : "resolved",
        turnId,
        characters: {
          haru: { state: nextCharacters.haru, lastDecision: haru.value, internalSummary: haru.value.internalSummary },
          aoi: { state: nextCharacters.aoi, lastDecision: aoi.value, internalSummary: aoi.value.internalSummary },
        },
        shared: {
          ...before.shared,
          relationshipLabel: relationship,
          unresolvedConflicts: conflicts,
          sharedMemories: [...before.shared.sharedMemories, memory].slice(-40),
        },
        lastEvent: resolved,
        eventLog: [
          ...before.eventLog,
          {
            id: `log-${turnId}`,
            day: before.shared.day,
            phase: before.shared.phase,
            eventDefinitionId: eventDefinition.id,
            cueSafetyFlags: suggestion.cue.safetyFlags,
            suggestion: suggestion.text,
            haruReaction: `${haru.value.decision}: ${haru.value.action}`,
            aoiReaction: `${aoi.value.decision}: ${aoi.value.action}`,
            eventTitle: resolved.eventTitle,
            narration: resolved.narration,
            relationshipBefore: before.shared.relationshipLabel,
            relationshipAfter: relationship,
            createdAt: new Date().toISOString(),
          },
        ].slice(-50),
        runtime: { haru: haru.runtime, aoi: aoi.runtime, director: director.runtime },
        ending: isLastTurn ? endingFor(relationship, nextCharacters) : undefined,
      };

      this.state = nextState;
      this.completed.set(idempotencyKey, structuredClone(nextState));
      if (this.completed.size > 20) this.completed.delete(this.completed.keys().next().value ?? "");
      await this.repository.save(this.state);
      emit({ type: "turn.completed", message: resolved.eventTitle, data: this.getState() });
      return this.getState();
    } catch (error) {
      this.state = { ...before, status: "awaiting_suggestion", turnId: undefined };
      await this.repository.save(this.state);
      throw error;
    } finally {
      this.resolving = false;
    }
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
        `fast-${randomUUID()}`,
        this.state.revision,
        undefined,
        characterSettings,
      );
    }
    return this.getState();
  }
}
