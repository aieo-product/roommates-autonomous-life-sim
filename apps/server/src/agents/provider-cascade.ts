import type {
  CharacterDecisionInput,
  CharacterId,
  DirectorInput,
  NavigatorInput,
} from "@roommates/shared";
import {
  characterDecisionSchema,
  directorResolvedEventSchema,
  navigatorAgentOutputSchema,
} from "@roommates/shared";
import {
  agentResultReflectionSchemaFor,
  type AgentReflectionInput,
} from "./reflection.js";
import type {
  AppServerAdapter,
  AppServerAdapterResult,
  AppServerAdapterSource,
} from "./coordinator.js";

export type AgentProvider = {
  source: AppServerAdapterSource;
  adapter: AppServerAdapter;
};

type SchemaLike = {
  safeParse(input: unknown):
    | { success: true; data: unknown }
    | { success: false; error: unknown };
};

/**
 * Tries configured providers in order for every operation. Provider failures
 * are deliberately collapsed to provider names so upstream bodies, headers,
 * and credentials can never reach persisted or public runtime diagnostics.
 */
export class ProviderCascadeAdapter implements AppServerAdapter {
  constructor(private readonly providers: readonly AgentProvider[]) {
    if (providers.length === 0) {
      throw new Error("At least one agent provider is required");
    }
  }

  navigate(input: NavigatorInput): Promise<AppServerAdapterResult> {
    return this.invoke(
      async (adapter) => {
        if (!adapter.navigate) throw new Error("operation unavailable");
        return adapter.navigate(input);
      },
      navigatorAgentOutputSchema,
    );
  }

  decide(
    id: CharacterId,
    input: CharacterDecisionInput,
  ): Promise<AppServerAdapterResult> {
    return this.invoke(
      (adapter) => adapter.decide(id, input),
      characterDecisionSchema,
    );
  }

  resolve(input: DirectorInput): Promise<AppServerAdapterResult> {
    return this.invoke(
      (adapter) => adapter.resolve(input),
      directorResolvedEventSchema,
    );
  }

  reflect(
    id: CharacterId,
    input: AgentReflectionInput,
  ): Promise<AppServerAdapterResult> {
    return this.invoke(
      async (adapter) => {
        if (!adapter.reflect) throw new Error("operation unavailable");
        return adapter.reflect(id, input);
      },
      agentResultReflectionSchemaFor(input),
    );
  }

  async resetContext(): Promise<void> {
    await Promise.all(
      this.providers.map(({ adapter }) => adapter.resetContext?.()),
    );
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.providers.map(({ adapter }) => adapter.shutdown()));
  }

  private async invoke(
    call: (adapter: AppServerAdapter) => Promise<AppServerAdapterResult>,
    schema: SchemaLike,
  ): Promise<AppServerAdapterResult> {
    const failedProviders: AppServerAdapterSource[] = [];
    for (const provider of this.providers) {
      try {
        const output = await call(provider.adapter);
        const parsed = schema.safeParse(output.value);
        if (!parsed.success) throw new Error("invalid structured output");
        return { ...output, value: parsed.data, source: provider.source };
      } catch {
        failedProviders.push(provider.source);
      }
    }
    throw new Error(
      `Configured agent providers are unavailable: ${failedProviders.join(", ")}`,
    );
  }
}
