import { z } from "zod";
import {
  characterDecisionSchema,
  directorResolvedEventSchema,
  navigatorAgentOutputSchema,
  type CharacterDecisionInput,
  type CharacterId,
  type DirectorInput,
  type NavigatorInput,
} from "@roommates/shared";
import type { AppServerAdapter } from "../coordinator.js";
import {
  agentResultReflectionSchemaFor,
  type AgentReflectionInput,
} from "../reflection.js";
import {
  characterInstructions,
  characterPrompt,
  directorInstructions,
  directorPrompt,
  navigatorInstructions,
  navigatorPrompt,
  reflectionInstructions,
  reflectionPrompt,
} from "../app-server/prompts.js";
import {
  characterOutputSchema,
  directorOutputSchema,
  navigatorOutputSchema,
  reflectionOutputSchema,
} from "../app-server/schemas.js";

export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const DEFAULT_OPENAI_RESPONSES_MODEL = "gpt-5.6-terra";
export const DEFAULT_OPENAI_RESPONSES_TIMEOUT_MS = 30_000;
export const MIN_OPENAI_RESPONSES_TIMEOUT_MS = 1_000;
export const MAX_OPENAI_RESPONSES_TIMEOUT_MS = 120_000;
export const DEFAULT_OPENAI_RESPONSES_MAX_BYTES = 256 * 1024;
export const MAX_OPENAI_RESPONSES_MAX_BYTES = 1024 * 1024;
export const OPENAI_RESPONSES_MAX_OUTPUT_TOKENS = 4_096;

export type OpenAIResponsesClientOptions = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
  /** Initial runtime namespace. Calls remain stateless at the provider. */
  scopeId?: string;
  /** Compatibility alias used by callers that already have a game session id. */
  sessionId?: string;
};

export type OpenAIResponsesEnvelope = {
  value: unknown;
  threadId: string;
  source: "openai_api";
};

type AppServerRole = CharacterId | "navigator" | "director" | `${CharacterId}-reflection`;
type JsonSchema = Record<string, unknown>;
type RoleRequest = {
  role: AppServerRole;
  instructions: string;
  prompt: string;
  formatName: string;
  schema: JsonSchema;
  validate: (value: unknown) => { success: true; data: unknown } | { success: false };
  normalize?: (value: unknown) => unknown;
};

const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RESPONSE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

const responseEnvelopeSchema = z
  .object({
    id: z.string().optional(),
    status: z.string(),
    output: z
      .array(
        z
          .object({
            status: z.string().optional(),
            content: z
              .array(
                z
                  .object({
                    type: z.string(),
                    text: z.unknown().optional(),
                    refusal: z.unknown().optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

// Strict Structured Outputs requires every declared property to be required.
// The game contract makes initiative optional, so the provider emits null and
// the adapter removes it before the existing Zod contract validates the value.
export const characterResponsesOutputSchema: JsonSchema = {
  ...characterOutputSchema,
  properties: {
    ...characterOutputSchema.properties,
    initiative: {
      anyOf: [characterOutputSchema.properties.initiative, { type: "null" }],
    },
  },
  required: [...characterOutputSchema.required, "initiative"],
};

export class OpenAIResponsesClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIResponsesClientError";
  }
}

function positiveIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  message: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new OpenAIResponsesClientError(message);
  }
  return value;
}

function validatedScope(value: string): string {
  const scope = value.trim();
  if (!SCOPE_ID_PATTERN.test(scope)) {
    throw new OpenAIResponsesClientError("OpenAI Responses scope is invalid");
  }
  return scope;
}

function normalizeCharacterOutput(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.initiative !== null) return value;
  const { initiative: _initiative, ...withoutInitiative } = record;
  return withoutInitiative;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Preserve the original sanitized HTTP or size error.
  }
}

async function readLimitedResponse(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      await cancelBody(response);
      throw new OpenAIResponsesClientError("OpenAI Responses response exceeded the size limit");
    }
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new OpenAIResponsesClientError("OpenAI Responses response exceeded the size limit");
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
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new OpenAIResponsesClientError("OpenAI Responses returned malformed JSON");
  }
}

function extractOutputText(value: unknown): { responseId?: string; text: string } {
  const parsed = responseEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new OpenAIResponsesClientError("OpenAI Responses returned an invalid response envelope");
  }
  if (parsed.data.status === "incomplete") {
    throw new OpenAIResponsesClientError("OpenAI Responses returned an incomplete response");
  }
  if (parsed.data.status !== "completed") {
    throw new OpenAIResponsesClientError("OpenAI Responses did not complete");
  }

  const texts: string[] = [];
  for (const item of parsed.data.output ?? []) {
    if (item.status === "incomplete") {
      throw new OpenAIResponsesClientError("OpenAI Responses returned an incomplete response");
    }
    for (const part of item.content ?? []) {
      if (part.type === "refusal") {
        throw new OpenAIResponsesClientError("OpenAI Responses refused the request");
      }
      if (part.type === "output_text") {
        if (typeof part.text !== "string") {
          throw new OpenAIResponsesClientError("OpenAI Responses returned invalid output text");
        }
        texts.push(part.text);
      }
    }
  }
  if (texts.length === 0) {
    throw new OpenAIResponsesClientError("OpenAI Responses returned no output text");
  }
  return { responseId: parsed.data.id, text: texts.join("") };
}

function responseThreadId(scopeToken: string, role: AppServerRole, responseId: string | undefined): string {
  const safeResponseId = responseId && RESPONSE_ID_PATTERN.test(responseId)
    ? responseId
    : crypto.randomUUID().replaceAll("-", "");
  return `openai:${scopeToken}:${role}:${safeResponseId}`;
}

export class OpenAIResponsesClient implements AppServerAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;
  private readonly initialScope: string;
  private readonly scopeTokens = new Map<string, string>();

  constructor(options: OpenAIResponsesClientOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey || apiKey.length > 2_048 || /[\u0000-\u0020\u007f]/.test(apiKey)) {
      throw new OpenAIResponsesClientError("OpenAI API key is invalid");
    }
    const model = (options.model ?? DEFAULT_OPENAI_RESPONSES_MODEL).trim();
    if (!MODEL_PATTERN.test(model)) {
      throw new OpenAIResponsesClientError("OpenAI Responses model is invalid");
    }
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = positiveIntegerInRange(
      options.timeoutMs ?? DEFAULT_OPENAI_RESPONSES_TIMEOUT_MS,
      MIN_OPENAI_RESPONSES_TIMEOUT_MS,
      MAX_OPENAI_RESPONSES_TIMEOUT_MS,
      "OpenAI Responses timeout is invalid",
    );
    this.maxResponseBytes = positiveIntegerInRange(
      options.maxResponseBytes ?? DEFAULT_OPENAI_RESPONSES_MAX_BYTES,
      1,
      MAX_OPENAI_RESPONSES_MAX_BYTES,
      "OpenAI Responses size limit is invalid",
    );
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new OpenAIResponsesClientError("Fetch is unavailable for OpenAI Responses");
    }
    this.initialScope = validatedScope(options.scopeId ?? options.sessionId ?? "default");
  }

  async navigate(input: NavigatorInput): Promise<OpenAIResponsesEnvelope> {
    return this.navigateInScope(this.initialScope, input);
  }

  async decide(
    id: CharacterId,
    input: CharacterDecisionInput,
  ): Promise<OpenAIResponsesEnvelope> {
    return this.decideInScope(this.initialScope, id, input);
  }

  async resolve(input: DirectorInput): Promise<OpenAIResponsesEnvelope> {
    return this.resolveInScope(this.initialScope, input);
  }

  async reflect(
    id: CharacterId,
    input: AgentReflectionInput,
  ): Promise<OpenAIResponsesEnvelope> {
    return this.reflectInScope(this.initialScope, id, input);
  }

  scope(namespace: string): AppServerAdapter {
    const scope = validatedScope(namespace);
    return {
      navigate: (input) => this.navigateInScope(scope, input),
      decide: (id, input) => this.decideInScope(scope, id, input),
      resolve: (input) => this.resolveInScope(scope, input),
      reflect: (id, input) => this.reflectInScope(scope, id, input),
      resetContext: async () => undefined,
      shutdown: async () => undefined,
    };
  }

  async resetContext(): Promise<void> {
    this.scopeTokens.clear();
  }

  async shutdown(): Promise<void> {
    // The HTTPS API has no client-owned process or persistent session.
  }

  private navigateInScope(scope: string, input: NavigatorInput): Promise<OpenAIResponsesEnvelope> {
    return this.invoke(scope, {
      role: "navigator",
      instructions: navigatorInstructions,
      prompt: navigatorPrompt(input),
      formatName: "navigator_output",
      schema: navigatorOutputSchema,
      validate: (value) => navigatorAgentOutputSchema.safeParse(value),
    });
  }

  private decideInScope(
    scope: string,
    id: CharacterId,
    input: CharacterDecisionInput,
  ): Promise<OpenAIResponsesEnvelope> {
    return this.invoke(scope, {
      role: id,
      instructions: characterInstructions(id),
      prompt: characterPrompt(input),
      formatName: "character_output",
      schema: characterResponsesOutputSchema,
      normalize: normalizeCharacterOutput,
      validate: (value) => characterDecisionSchema.safeParse(value),
    });
  }

  private resolveInScope(scope: string, input: DirectorInput): Promise<OpenAIResponsesEnvelope> {
    return this.invoke(scope, {
      role: "director",
      instructions: directorInstructions,
      prompt: directorPrompt(input),
      formatName: "director_output",
      schema: directorOutputSchema,
      validate: (value) => directorResolvedEventSchema.safeParse(value),
    });
  }

  private reflectInScope(
    scope: string,
    id: CharacterId,
    input: AgentReflectionInput,
  ): Promise<OpenAIResponsesEnvelope> {
    if (input.characterId !== id) {
      throw new OpenAIResponsesClientError(
        "OpenAI Responses reflection input belongs to a different character",
      );
    }
    return this.invoke(scope, {
      role: `${id}-reflection`,
      instructions: reflectionInstructions(id),
      prompt: reflectionPrompt(input),
      formatName: "reflection_output",
      schema: reflectionOutputSchema,
      validate: (value) => agentResultReflectionSchemaFor(input).safeParse(value),
    });
  }

  private scopeToken(scope: string): string {
    const existing = this.scopeTokens.get(scope);
    if (existing) return existing;
    const token = crypto.randomUUID().replaceAll("-", "");
    this.scopeTokens.set(scope, token);
    return token;
  }

  private async invoke(scope: string, request: RoleRequest): Promise<OpenAIResponsesEnvelope> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeoutFailure = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(
          new OpenAIResponsesClientError(
            `OpenAI Responses request timed out after ${this.timeoutMs}ms`,
          ),
        );
      }, this.timeoutMs);
    });

    const operation = this.performRequest(controller.signal, request);
    try {
      const { responseId, value } = await Promise.race([operation, timeoutFailure]);
      return {
        value,
        threadId: responseThreadId(this.scopeToken(scope), request.role, responseId),
        source: "openai_api",
      };
    } catch (error) {
      if (error instanceof OpenAIResponsesClientError) throw error;
      if (timedOut) {
        throw new OpenAIResponsesClientError(
          `OpenAI Responses request timed out after ${this.timeoutMs}ms`,
        );
      }
      throw new OpenAIResponsesClientError("OpenAI Responses request failed");
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async performRequest(
    signal: AbortSignal,
    request: RoleRequest,
  ): Promise<{ responseId?: string; value: unknown }> {
    let response: Response;
    try {
      response = await this.fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          instructions: request.instructions,
          input: request.prompt,
          reasoning: { effort: "none" },
          store: false,
          max_output_tokens: OPENAI_RESPONSES_MAX_OUTPUT_TOKENS,
          text: {
            format: {
              type: "json_schema",
              name: request.formatName,
              strict: true,
              schema: request.schema,
            },
          },
        }),
        signal,
      });
    } catch {
      if (signal.aborted) {
        throw new OpenAIResponsesClientError(
          `OpenAI Responses request timed out after ${this.timeoutMs}ms`,
        );
      }
      throw new OpenAIResponsesClientError("OpenAI Responses request failed");
    }

    if (!response.ok) {
      await cancelBody(response);
      throw new OpenAIResponsesClientError(
        `OpenAI Responses request failed with status ${response.status}`,
      );
    }

    const responseText = await readLimitedResponse(response, this.maxResponseBytes);
    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      throw new OpenAIResponsesClientError("OpenAI Responses returned malformed JSON");
    }
    const extracted = extractOutputText(responseJson);

    let outputJson: unknown;
    try {
      outputJson = JSON.parse(extracted.text);
    } catch {
      throw new OpenAIResponsesClientError("OpenAI Responses returned invalid structured JSON");
    }
    const normalized = request.normalize?.(outputJson) ?? outputJson;
    const validated = request.validate(normalized);
    if (!validated.success) {
      throw new OpenAIResponsesClientError("OpenAI Responses returned invalid structured JSON");
    }
    return { responseId: extracted.responseId, value: validated.data };
  }
}
