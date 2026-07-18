import type {
  AgentId,
  CharacterDecision,
  CharacterDecisionInput,
  CharacterId,
  DirectorInput,
  NavigatorAgentOutput,
  NavigatorInput,
  ResolvedEvent,
  RuntimeAgentState,
} from "@roommates/shared";
import {
  characterDecisionSchema,
  directorResolvedEventSchema,
  navigatorAgentOutputSchema,
} from "@roommates/shared";
import type { AgentMode } from "../config.js";
import { MockCharacterAgent } from "./mock/character.js";
import { MockDirectorAgent } from "./mock/director.js";
import { MockNavigatorAgent } from "./mock/navigator.js";
import { MockReflectionAgent } from "./mock/reflection.js";
import {
  agentResultReflectionSchemaFor,
  fallbackAgentReflection,
  type AgentReflectionInput,
  type AgentResultReflection,
} from "./reflection.js";

export type AgentResult<T> = { value: T; runtime: RuntimeAgentState };

export interface AgentCoordinator {
  navigate?(input: NavigatorInput): Promise<AgentResult<NavigatorAgentOutput>>;
  decide(id: CharacterId, input: CharacterDecisionInput): Promise<AgentResult<CharacterDecision>>;
  resolve(input: DirectorInput): Promise<AgentResult<ResolvedEvent>>;
  reflect?(id: CharacterId, input: AgentReflectionInput): Promise<AgentResult<AgentResultReflection>>;
  resetContext?(): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface AppServerAdapter {
  navigate?(input: NavigatorInput): Promise<{ value: unknown; threadId: string }>;
  decide(id: CharacterId, input: CharacterDecisionInput): Promise<{ value: unknown; threadId: string }>;
  resolve(input: DirectorInput): Promise<{ value: unknown; threadId: string }>;
  reflect?(id: CharacterId, input: AgentReflectionInput): Promise<{ value: unknown; threadId: string }>;
  resetContext?(): Promise<void>;
  shutdown(): Promise<void>;
}

type SchemaLike<T> = { safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown } };

export class ResilientAgentCoordinator implements AgentCoordinator {
  private readonly characters = {
    haru: new MockCharacterAgent("haru"),
    aoi: new MockCharacterAgent("aoi"),
  };
  private readonly director = new MockDirectorAgent();
  private readonly navigator = new MockNavigatorAgent();
  private readonly reflections = {
    haru: new MockReflectionAgent("haru"),
    aoi: new MockReflectionAgent("aoi"),
  };
  private appServerDisabledReason?: string;
  private appServerDisabledAt?: number;

  private static readonly RETRY_AFTER_MS = 5_000;

  constructor(
    private readonly mode: AgentMode,
    private readonly timeoutMs: number,
    private readonly real?: AppServerAdapter,
  ) {}

  async navigate(input: NavigatorInput): Promise<AgentResult<NavigatorAgentOutput>> {
    return this.run(
      "navigator",
      () => {
        if (!this.real?.navigate) throw new Error("App Server navigator adapter is unavailable");
        return this.real.navigate(input);
      },
      () => this.navigator.respond(input),
      navigatorAgentOutputSchema as SchemaLike<NavigatorAgentOutput>,
      undefined,
      false,
    );
  }

  async decide(id: CharacterId, input: CharacterDecisionInput): Promise<AgentResult<CharacterDecision>> {
    return this.run(
      id,
      () => this.real!.decide(id, input),
      () => this.characters[id].decide(input),
      characterDecisionSchema as SchemaLike<CharacterDecision>,
    );
  }

  async resolve(input: DirectorInput): Promise<AgentResult<ResolvedEvent>> {
    return this.run(
      "director",
      () => this.real!.resolve(input),
      () => this.director.resolve(input),
      directorResolvedEventSchema as SchemaLike<ResolvedEvent>,
    );
  }

  async reflect(
    id: CharacterId,
    input: AgentReflectionInput,
  ): Promise<AgentResult<AgentResultReflection>> {
    if (input.characterId !== id) {
      throw new Error("Reflection input belongs to a different character");
    }
    return this.run(
      id,
      () => {
        if (!this.real?.reflect) throw new Error("App Server reflection adapter is unavailable");
        return this.real.reflect(id, input);
      },
      () => this.reflections[id].reflect(input),
      agentResultReflectionSchemaFor(input) as SchemaLike<AgentResultReflection>,
      () => Promise.resolve(fallbackAgentReflection(input)),
      false,
    );
  }

  private async run<T>(
    _agent: AgentId,
    realCall: () => Promise<{ value: unknown; threadId: string }>,
    mockCall: () => Promise<T>,
    schema: SchemaLike<T>,
    fallbackCall: () => Promise<T> = mockCall,
    disableAppServerOnFailure = true,
  ): Promise<AgentResult<T>> {
    const started = Date.now();
    if (
      this.appServerDisabledReason &&
      this.appServerDisabledAt !== undefined &&
      started - this.appServerDisabledAt >= ResilientAgentCoordinator.RETRY_AFTER_MS
    ) {
      this.appServerDisabledReason = undefined;
      this.appServerDisabledAt = undefined;
    }
    if (this.mode !== "mock" && this.real && !this.appServerDisabledReason) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const output = await this.withTimeout(realCall());
          const parsed = schema.safeParse(output.value);
          if (!parsed.success) throw new Error("App Server returned invalid structured JSON");
          return {
            value: parsed.data,
            runtime: { source: "app_server", threadId: output.threadId, latencyMs: Date.now() - started },
          };
        } catch (error) {
          lastError = error;
        }
      }
      const reason = lastError instanceof Error ? lastError.message : "App Server connection failed";
      if (this.mode === "auto" && disableAppServerOnFailure) {
        this.appServerDisabledReason = reason;
        this.appServerDisabledAt = Date.now();
      }
      return {
        value: await fallbackCall(),
        runtime: { source: "fallback", latencyMs: Date.now() - started, error: reason.slice(0, 180) },
      };
    }

    const value = this.mode === "mock" ? await mockCall() : await fallbackCall();
    return {
      value,
      runtime: {
        source: this.mode === "mock" ? "mock" : "fallback",
        latencyMs: Date.now() - started,
        error: this.mode === "mock" ? undefined : this.appServerDisabledReason ?? "App Server is unavailable",
      },
    };
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`App Server timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async shutdown(): Promise<void> {
    await this.real?.shutdown();
  }

  async resetContext(): Promise<void> {
    await this.real?.resetContext?.();
    this.appServerDisabledReason = undefined;
    this.appServerDisabledAt = undefined;
  }
}
