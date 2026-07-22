import type {
  CharacterDecisionInput,
  CharacterId,
  DirectorInput,
  NavigatorInput,
} from "@roommates/shared";
import {
  characterDecisionSchema,
  directorResolvedEventDraftSchema,
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
import {
  OpenAIResponsesClientError,
  type OpenAIProviderFailureCategory,
} from "./openai/responses-client.js";

export type AgentProvider = {
  source: AppServerAdapterSource;
  adapter: AppServerAdapter;
};

export type ProviderFailureDiagnostic = {
  source: AppServerAdapterSource;
  kind: "provider_error" | "invalid_structured_output";
  httpStatus?: number;
  failureCategory?: OpenAIProviderFailureCategory;
};

export type ProviderFailureObserver = (
  diagnostic: ProviderFailureDiagnostic,
) => void;

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
  constructor(
    private readonly providers: readonly AgentProvider[],
    private readonly onProviderFailure?: ProviderFailureObserver,
  ) {
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
      directorResolvedEventDraftSchema,
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
        if (!parsed.success) {
          failedProviders.push(provider.source);
          this.reportFailure({
            source: provider.source,
            kind: "invalid_structured_output",
          });
          continue;
        }
        return { ...output, value: parsed.data, source: provider.source };
      } catch (error) {
        failedProviders.push(provider.source);
        const httpStatus =
          provider.source === "openai_api" &&
          error instanceof OpenAIResponsesClientError &&
          Number.isInteger(error.httpStatus) &&
          error.httpStatus !== undefined &&
          error.httpStatus >= 100 &&
          error.httpStatus <= 599
            ? error.httpStatus
            : undefined;
        this.reportFailure({
          source: provider.source,
          kind: "provider_error",
          ...(httpStatus === undefined ? {} : { httpStatus }),
          ...(provider.source === "openai_api" &&
          error instanceof OpenAIResponsesClientError &&
          error.failureCategory !== undefined
            ? { failureCategory: error.failureCategory }
            : {}),
        });
      }
    }
    throw new Error(
      `Configured agent providers are unavailable: ${failedProviders.join(", ")}`,
    );
  }

  private reportFailure(diagnostic: ProviderFailureDiagnostic): void {
    try {
      this.onProviderFailure?.(diagnostic);
    } catch {
      // Observability must never interrupt the provider cascade or fallback.
    }
  }
}
