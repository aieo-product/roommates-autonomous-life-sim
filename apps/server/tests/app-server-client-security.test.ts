import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: spawnMock };
});

import { CodexAppServerClient } from "../src/agents/app-server/client.js";

const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "hooks",
  "multi_agent",
  "remote_plugin",
  "shell_snapshot",
  "memories",
  "goals",
  "personality",
  "plugins",
  "plugin_sharing",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "image_generation",
  "in_app_browser",
  "auth_elicitation",
  "skill_mcp_dependency_install",
  "tool_suggest",
  "workspace_dependencies",
] as const;

type RpcMessage = { id?: number; method?: string; params?: Record<string, unknown> };

class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => {
    this.killed = true;
    return true;
  });
}

type ClientInternals = {
  request: (
    method: string,
    params: unknown,
    options?: { fatalOnFailure?: boolean },
  ) => Promise<unknown>;
  turn: (threadId: string, text: string, outputSchema: unknown) => Promise<unknown>;
  thread: (scope: string, role: "navigator") => Promise<string>;
  pending: Map<number, unknown>;
  turns: Map<string, unknown>;
};

function observeRequests(
  child: FakeChildProcess,
  responder: (message: RpcMessage) => unknown | undefined,
): RpcMessage[] {
  const messages: RpcMessage[] = [];
  let buffer = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as RpcMessage;
      messages.push(message);
      const result = responder(message);
      if (message.id !== undefined && result !== undefined) {
        child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
      }
    }
  });
  return messages;
}

function expectArgumentPair(args: string[], flag: string, value: string): void {
  expect(args.some((argument, index) => argument === flag && args[index + 1] === value)).toBe(true);
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("CodexAppServerClient security boundary", () => {
  it("starts Codex with tools disabled, an environment allowlist, and restricted thread config", async () => {
    vi.stubEnv("CODEX_HOME", "/tmp/codex-home");
    vi.stubEnv("CODEX_ACCESS_TOKEN", "codex-access-token");
    vi.stubEnv("AGENT_WORKER_TOKEN", "gateway-secret-must-not-leak");
    vi.stubEnv("ROOMMATES_PRIVATE_VALUE", "must-not-leak");
    vi.stubEnv("NO_COLOR", "0");
    const child = new FakeChildProcess();
    const messages = observeRequests(child, (message) => {
      if (message.method === "initialize") return {};
      if (message.method === "thread/start") return { thread: { id: "thread-navigator" } };
      if (message.method === "thread/name/set") return {};
      return undefined;
    });
    spawnMock.mockReturnValue(child);
    const client = new CodexAppServerClient("codex", "/game");

    await client.ready();
    const internals = client as unknown as ClientInternals;
    await internals.thread("session:game-a", "navigator");

    expect(spawnMock).toHaveBeenCalledOnce();
    const [, args, options] = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(args.slice(-2)).toEqual(["app-server", "--stdio"]);
    for (const feature of DISABLED_FEATURES) expectArgumentPair(args, "--disable", feature);
    expectArgumentPair(args, "-c", "web_search='disabled'");
    expectArgumentPair(args, "-c", "shell_environment_policy.inherit='none'");
    expectArgumentPair(args, "-c", "shell_environment_policy.include_only=[]");
    expectArgumentPair(args, "-c", "mcp_servers={}");

    expect(options.env).toMatchObject({
      CODEX_HOME: "/tmp/codex-home",
      CODEX_ACCESS_TOKEN: "codex-access-token",
      NO_COLOR: "1",
    });
    expect(options.env).not.toHaveProperty("AGENT_WORKER_TOKEN");
    expect(options.env).not.toHaveProperty("ROOMMATES_PRIVATE_VALUE");
    expect(Object.keys(options.env)).toEqual(
      expect.arrayContaining(["CODEX_HOME", "CODEX_ACCESS_TOKEN", "NO_COLOR"]),
    );
    expect(
      Object.keys(options.env).every((key) =>
        [
          "HOME",
          "PATH",
          "CODEX_HOME",
          "CODEX_ACCESS_TOKEN",
          "OPENAI_API_KEY",
          "OPENAI_BASE_URL",
          "SSL_CERT_FILE",
          "SSL_CERT_DIR",
          "HTTPS_PROXY",
          "HTTP_PROXY",
          "NO_PROXY",
          "NO_COLOR",
        ].includes(key),
      ),
    ).toBe(true);

    const threadStart = messages.find((message) => message.method === "thread/start");
    expect(threadStart?.params).toMatchObject({
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      config: {
        web_search: "disabled",
        shell_environment_policy: { inherit: "none", include_only: [] },
        mcp_servers: {},
      },
    });
    const features = (threadStart?.params?.config as { features?: Record<string, unknown> }).features;
    expect(features).toEqual(Object.fromEntries(DISABLED_FEATURES.map((feature) => [feature, false])));
    await client.shutdown();
  });

  it("times out an unanswered RPC and removes its pending deadline", async () => {
    vi.useFakeTimers();
    const unresponsive = new FakeChildProcess();
    observeRequests(unresponsive, (message) => (message.method === "initialize" ? {} : undefined));
    const recovered = new FakeChildProcess();
    observeRequests(recovered, (message) => (message.method === "initialize" ? {} : undefined));
    spawnMock.mockReturnValueOnce(unresponsive).mockReturnValueOnce(recovered);
    const client = new CodexAppServerClient("codex", "/game", {
      requestTimeoutMs: 25,
      turnTimeoutMs: 50,
    });
    await client.ready();
    const internals = client as unknown as ClientInternals;

    const pending = internals.request("test/no-response", {});
    const rejection = expect(pending).rejects.toThrow("RPC test/no-response timed out after 25ms");
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(internals.pending.size).toBe(0);
    expect(unresponsive.kill).toHaveBeenCalledWith("SIGTERM");
    await client.ready();
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await client.shutdown();
  });

  it("treats retired-thread deletion as best effort and clears its deadline", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    const messages = observeRequests(child, (message) => {
      if (message.method === "initialize") return {};
      if (message.method === "thread/start") return { thread: { id: "thread-retired" } };
      if (message.method === "thread/name/set") return {};
      return undefined;
    });
    spawnMock.mockReturnValue(child);
    const client = new CodexAppServerClient("codex", "/game", {
      requestTimeoutMs: 25,
      turnTimeoutMs: 50,
    });
    await client.ready();
    const internals = client as unknown as ClientInternals;
    await internals.thread("default", "navigator");

    const reset = client.resetContext();
    expect(messages).toContainEqual(
      expect.objectContaining({
        method: "thread/delete",
        params: { threadId: "thread-retired" },
      }),
    );
    await vi.advanceTimersByTimeAsync(25);
    await reset;

    expect(child.kill).not.toHaveBeenCalled();
    expect(internals.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await client.ready();
    expect(spawnMock).toHaveBeenCalledOnce();
    await client.shutdown();
  });

  it("interrupts and rejects a turn that exceeds its deadline", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    const messages = observeRequests(child, (message) => {
      if (message.method === "initialize") return {};
      if (message.method === "turn/start") return { turn: { id: "turn-timeout" } };
      if (message.method === "turn/interrupt") return {};
      return undefined;
    });
    spawnMock.mockReturnValue(child);
    const client = new CodexAppServerClient("codex", "/game", {
      requestTimeoutMs: 25,
      turnTimeoutMs: 50,
    });
    await client.ready();
    const internals = client as unknown as ClientInternals;

    const turn = internals.turn("thread-a", "respond", {});
    const rejection = expect(turn).rejects.toThrow("turn timed out after 50ms");
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(messages).toContainEqual(
      expect.objectContaining({
        method: "turn/interrupt",
        params: { threadId: "thread-a", turnId: "turn-timeout" },
      }),
    );
    expect(internals.turns.size).toBe(0);
    expect(internals.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await client.shutdown();
  });

  it("resets Codex when the timed-out turn cannot be interrupted", async () => {
    vi.useFakeTimers();
    const unresponsive = new FakeChildProcess();
    const messages = observeRequests(unresponsive, (message) => {
      if (message.method === "initialize") return {};
      if (message.method === "turn/start") return { turn: { id: "turn-stuck" } };
      return undefined;
    });
    const recovered = new FakeChildProcess();
    observeRequests(recovered, (message) => (message.method === "initialize" ? {} : undefined));
    spawnMock.mockReturnValueOnce(unresponsive).mockReturnValueOnce(recovered);
    const client = new CodexAppServerClient("codex", "/game", {
      requestTimeoutMs: 25,
      turnTimeoutMs: 50,
    });
    await client.ready();
    const internals = client as unknown as ClientInternals;

    const turn = internals.turn("thread-a", "respond", {});
    const turnRejection = expect(turn).rejects.toThrow("turn timed out after 50ms");
    await vi.advanceTimersByTimeAsync(50);
    await turnRejection;
    expect(messages.some((message) => message.method === "turn/interrupt")).toBe(true);

    const otherPending = internals.request("test/also-pending", {});
    const pendingRejection = expect(otherPending).rejects.toThrow(
      "RPC turn/interrupt timed out after 25ms",
    );
    await vi.advanceTimersByTimeAsync(25);
    await pendingRejection;

    expect(unresponsive.kill).toHaveBeenCalledWith("SIGTERM");
    expect(internals.pending.size).toBe(0);
    await client.ready();
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await client.shutdown();
  });

  it("kills and resets a child whose initialize request times out", async () => {
    vi.useFakeTimers();
    const unavailable = new FakeChildProcess();
    observeRequests(unavailable, () => undefined);
    const recovered = new FakeChildProcess();
    observeRequests(recovered, (message) => (message.method === "initialize" ? {} : undefined));
    spawnMock.mockReturnValueOnce(unavailable).mockReturnValueOnce(recovered);
    const client = new CodexAppServerClient("codex", "/game", {
      requestTimeoutMs: 20,
      turnTimeoutMs: 50,
    });

    const firstReady = client.ready();
    const rejection = expect(firstReady).rejects.toThrow("RPC initialize timed out after 20ms");
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(unavailable.kill).toHaveBeenCalledWith("SIGTERM");

    await client.ready();
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await client.shutdown();
  });

  it("rejects pending work even when the child exits with code zero", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    observeRequests(child, (message) => (message.method === "initialize" ? {} : undefined));
    spawnMock.mockReturnValue(child);
    const client = new CodexAppServerClient("codex", "/game", {
      requestTimeoutMs: 100,
      turnTimeoutMs: 200,
    });
    await client.ready();
    const internals = client as unknown as ClientInternals;

    const pending = internals.request("test/pending", {});
    const rejection = expect(pending).rejects.toThrow("App Server exited (0)");
    child.emit("exit", 0);

    await rejection;
    expect(internals.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
