import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { CharacterDecisionInput, CharacterId, DirectorInput } from "@roommates/shared";
import type { AppServerAdapter } from "../coordinator.js";
import { extractJson } from "./json.js";
import { characterInstructions, characterPrompt, directorInstructions, directorPrompt } from "./prompts.js";
import { characterOutputSchema, directorOutputSchema } from "./schemas.js";

type RpcResponse = { id: number; result?: unknown; error?: { message?: string; code?: number } };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type TurnWaiter = { texts: string[]; resolve: (value: unknown) => void; reject: (error: Error) => void };

export class CodexAppServerClient implements AppServerAdapter {
  private process?: ChildProcessWithoutNullStreams;
  private startPromise?: Promise<void>;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly turns = new Map<string, TurnWaiter>();
  private readonly threadIds = new Map<CharacterId | "director", string>();
  private stderrTail = "";

  constructor(
    private readonly executable: string,
    private readonly cwd: string,
  ) {}

  async decide(id: CharacterId, input: CharacterDecisionInput): Promise<{ value: unknown; threadId: string }> {
    const threadId = await this.thread(id);
    const value = await this.turn(threadId, characterPrompt(input), characterOutputSchema);
    return { value, threadId };
  }

  async resolve(input: DirectorInput): Promise<{ value: unknown; threadId: string }> {
    const threadId = await this.thread("director");
    const value = await this.turn(threadId, directorPrompt(input), directorOutputSchema);
    return { value, threadId };
  }

  private async start(): Promise<void> {
    if (this.process) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.doStart();
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    const child = spawn(this.executable, ["app-server", "--stdio"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    this.process = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-2_000);
    });
    child.on("error", (error) => this.failAll(error));
    child.on("exit", (code) => {
      if (code !== 0) this.failAll(new Error(`Codex App Server exited (${code ?? "signal"}): ${this.stderrTail.trim()}`));
      this.process = undefined;
      this.startPromise = undefined;
    });

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.onLine(line));
    await this.request("initialize", {
      clientInfo: { name: "roommates-runtime", title: "ROOMMATES Game Runtime", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify("initialized");
  }

  private onLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      const response = message as RpcResponse;
      if (response.error) pending.reject(new Error(response.error.message ?? `App Server RPC error ${response.error.code ?? ""}`));
      else pending.resolve(response.result);
      return;
    }
    const method = typeof message.method === "string" ? message.method : "";
    const params = (message.params ?? {}) as Record<string, unknown>;
    const turnId = typeof params.turnId === "string" ? params.turnId : undefined;
    if (method === "item/completed" && turnId) {
      const item = params.item as { type?: string; text?: string } | undefined;
      if (item?.type === "agentMessage" && item.text) this.turns.get(turnId)?.texts.push(item.text);
    } else if (method === "item/agentMessage/delta" && turnId) {
      const delta = typeof params.delta === "string" ? params.delta : "";
      const waiter = this.turns.get(turnId);
      if (waiter && waiter.texts.length === 0 && delta) waiter.texts.push(delta);
      else if (waiter && delta) waiter.texts[waiter.texts.length - 1] += delta;
    } else if (method === "turn/completed") {
      const turn = params.turn as { id?: string; status?: string; error?: { message?: string }; items?: Array<{ type?: string; text?: string }> } | undefined;
      const id = turn?.id ?? turnId;
      if (!id) return;
      const waiter = this.turns.get(id);
      if (!waiter) return;
      this.turns.delete(id);
      if (turn?.status === "failed") waiter.reject(new Error(turn.error?.message ?? "App Server turn failed"));
      else {
        const itemText = turn?.items?.filter((item) => item.type === "agentMessage").at(-1)?.text;
        const text = itemText ?? waiter.texts.at(-1);
        if (!text) waiter.reject(new Error("App Server completed without an agent message"));
        else {
          try {
            waiter.resolve(extractJson(text));
          } catch (error) {
            waiter.reject(error instanceof Error ? error : new Error("Invalid App Server JSON"));
          }
        }
      }
    } else if (method === "error" && turnId) {
      const waiter = this.turns.get(turnId);
      if (waiter) {
        this.turns.delete(turnId);
        waiter.reject(new Error(String(params.message ?? "App Server error")));
      }
    }
  }

  private async thread(role: CharacterId | "director"): Promise<string> {
    await this.start();
    const existing = this.threadIds.get(role);
    if (existing) return existing;
    const result = (await this.request("thread/start", {
      cwd: this.cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: false,
      baseInstructions: role === "director" ? directorInstructions : characterInstructions(role),
      experimentalRawEvents: false,
    })) as { thread?: { id?: string } };
    const id = result.thread?.id;
    if (!id) throw new Error("App Server did not return a thread ID");
    this.threadIds.set(role, id);
    void this.request("thread/name/set", { threadId: id, name: `ROOMMATES · ${role === "director" ? "Director" : role === "haru" ? "Haru" : "Aoi"}` }).catch(() => undefined);
    return id;
  }

  private async turn(threadId: string, text: string, outputSchema: unknown): Promise<unknown> {
    const response = (await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text, text_elements: [] }],
      outputSchema,
      approvalPolicy: "never",
    })) as { turn?: { id?: string } };
    const turnId = response.turn?.id;
    if (!turnId) throw new Error("App Server did not return a turn ID");
    return new Promise((resolve, reject) => this.turns.set(turnId, { texts: [], resolve, reject }));
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private notify(method: string): void {
    this.write({ method });
  }

  private write(message: unknown): void {
    if (!this.process?.stdin.writable) throw new Error("Codex App Server is not running");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    for (const turn of this.turns.values()) turn.reject(error);
    this.pending.clear();
    this.turns.clear();
  }

  async shutdown(): Promise<void> {
    this.process?.kill("SIGTERM");
    this.process = undefined;
    this.startPromise = undefined;
  }
}
