import type {
  AgentId,
  CharacterDecision,
  CharacterDecisionInput,
  CharacterId,
  DirectorInput,
  ResolvedEvent,
  RuntimeAgentState,
} from "@roommates/shared";
import { characterDecisionSchema, resolvedEventSchema } from "@roommates/shared";
import type { AgentMode } from "../config.js";
import { MockCharacterAgent } from "./mock/character.js";
import { MockDirectorAgent } from "./mock/director.js";

export type AgentResult<T> = { value: T; runtime: RuntimeAgentState };

export interface AgentCoordinator {
  decide(id: CharacterId, input: CharacterDecisionInput): Promise<AgentResult<CharacterDecision>>;
  resolve(input: DirectorInput): Promise<AgentResult<ResolvedEvent>>;
  shutdown?(): Promise<void>;
}

export interface AppServerAdapter {
  decide(id: CharacterId, input: CharacterDecisionInput): Promise<{ value: unknown; threadId: string }>;
  resolve(input: DirectorInput): Promise<{ value: unknown; threadId: string }>;
  shutdown(): Promise<void>;
}

type SchemaLike<T> = { safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown } };

export class ResilientAgentCoordinator implements AgentCoordinator {
  private readonly characters = {
    haru: new MockCharacterAgent("haru"),
    aoi: new MockCharacterAgent("aoi"),
  };
  private readonly director = new MockDirectorAgent();
  private appServerDisabledReason?: string;

  constructor(
    private readonly mode: AgentMode,
    private readonly timeoutMs: number,
    private readonly real?: AppServerAdapter,
  ) {}

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
      resolvedEventSchema as SchemaLike<ResolvedEvent>,
    );
  }

  private async run<T>(
    _agent: AgentId,
    realCall: () => Promise<{ value: unknown; threadId: string }>,
    mockCall: () => Promise<T>,
    schema: SchemaLike<T>,
  ): Promise<AgentResult<T>> {
    const started = Date.now();
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
      if (this.mode === "auto") this.appServerDisabledReason = reason;
      return {
        value: await mockCall(),
        runtime: { source: "fallback", latencyMs: Date.now() - started, error: reason.slice(0, 180) },
      };
    }

    const value = await mockCall();
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
}
