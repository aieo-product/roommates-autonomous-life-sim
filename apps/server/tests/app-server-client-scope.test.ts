import { describe, expect, it, vi } from "vitest";
import type { NavigatorInput } from "@roommates/shared";
import {
  AppServerScopeCapacityError,
  CodexAppServerClient,
} from "../src/agents/app-server/client.js";
import { sanitizeSuggestion } from "../src/engine/suggestion.js";

function navigatorInput(): NavigatorInput {
  return {
    turnId: "turn-client-scope",
    rawInput: "二人で話して",
    day: 1,
    phase: "morning",
    resolvedSuggestion: sanitizeSuggestion("二人で話して"),
  };
}

type ClientInternals = {
  start: () => Promise<void>;
  request: (method: string, params: unknown) => Promise<unknown>;
  turn: (threadId: string, text: string, outputSchema: unknown) => Promise<unknown>;
  thread: (
    scope: string,
    role: "navigator" | "haru" | "aoi" | "director" | "haru-reflection" | "aoi-reflection",
  ) => Promise<string>;
};

function stubAppServer(client: CodexAppServerClient) {
  const internals = client as unknown as ClientInternals;
  let nextThread = 0;
  const request = vi.fn(async (method: string, _params: unknown) => {
    if (method === "thread/start") {
      nextThread += 1;
      return { thread: { id: `thread-${nextThread}` } };
    }
    return {};
  });
  internals.start = vi.fn(async () => undefined);
  internals.request = request;
  internals.turn = vi.fn(async () => ({ message: "了解" }));
  return { internals, request };
}

function deletedThreadIds(request: ReturnType<typeof vi.fn>): string[] {
  return request.mock.calls
    .filter(([method]) => method === "thread/delete")
    .map(([, params]) => (params as { threadId: string }).threadId);
}

describe("CodexAppServerClient session scopes", () => {
  it("reuses role history within one game session and isolates other sessions", async () => {
    const client = new CodexAppServerClient("codex", "/tmp");
    const { request } = stubAppServer(client);
    const sessionA = client.scope("session-a");
    const sessionB = client.scope("session-b");
    const explicitlyNamedDefault = client.scope("default");

    const firstA = await sessionA.navigate!(navigatorInput());
    await sessionA.resetContext?.();
    await sessionA.shutdown();
    const secondA = await sessionA.navigate!(navigatorInput());
    const firstB = await sessionB.navigate!(navigatorInput());
    const legacy = await client.navigate(navigatorInput());
    const scopedDefault = await explicitlyNamedDefault.navigate!(navigatorInput());

    expect(firstA.threadId).toBe("thread-1");
    expect(secondA.threadId).toBe(firstA.threadId);
    expect(firstB.threadId).toBe("thread-2");
    expect(legacy.threadId).toBe("thread-3");
    expect(scopedDefault.threadId).toBe("thread-4");
    expect(request.mock.calls.filter(([method]) => method === "thread/start")).toHaveLength(4);
  });

  it("retires inactive session threads after their TTL without background timers", async () => {
    let now = 0;
    const client = new CodexAppServerClient("codex", "/tmp", {
      sessionScopeTtlMs: 100,
      maxSessionScopes: 3,
      now: () => now,
    });
    const { internals, request } = stubAppServer(client);
    const sessionA = client.scope("session-a");
    const sessionB = client.scope("session-b");

    const firstA = await sessionA.navigate!(navigatorInput());
    const secondRoleA = await internals.thread("session:session-a", "haru");
    now = 100;
    const firstB = await sessionB.navigate!(navigatorInput());
    const secondA = await sessionA.navigate!(navigatorInput());

    expect(firstA.threadId).toBe("thread-1");
    expect(secondRoleA).toBe("thread-2");
    expect(firstB.threadId).toBe("thread-3");
    expect(secondA.threadId).toBe("thread-4");
    expect(deletedThreadIds(request)).toEqual(["thread-1", "thread-2"]);
  });

  it("uses inactive-session LRU order when the scope limit is reached", async () => {
    let now = 0;
    const client = new CodexAppServerClient("codex", "/tmp", {
      sessionScopeTtlMs: 10_000,
      maxSessionScopes: 2,
      now: () => now,
    });
    const { request } = stubAppServer(client);
    const sessionA = client.scope("session-a");
    const sessionB = client.scope("session-b");
    const sessionC = client.scope("session-c");

    const firstA = await sessionA.navigate!(navigatorInput());
    now = 1;
    const firstB = await sessionB.navigate!(navigatorInput());
    now = 2;
    const touchedA = await sessionA.navigate!(navigatorInput());
    now = 3;
    const firstC = await sessionC.navigate!(navigatorInput());
    const stillCachedA = await sessionA.navigate!(navigatorInput());

    expect(touchedA.threadId).toBe(firstA.threadId);
    expect(stillCachedA.threadId).toBe(firstA.threadId);
    expect(firstB.threadId).toBe("thread-2");
    expect(firstC.threadId).toBe("thread-3");
    expect(deletedThreadIds(request)).toEqual([firstB.threadId]);
  });

  it("never retires active scopes, while the legacy default scope remains available", async () => {
    const client = new CodexAppServerClient("codex", "/tmp", {
      sessionScopeTtlMs: 10_000,
      maxSessionScopes: 1,
      now: () => 0,
    });
    const { internals, request } = stubAppServer(client);
    let releaseActive!: () => void;
    let reportActive!: () => void;
    const active = new Promise<void>((resolve) => {
      reportActive = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    internals.turn = vi.fn(async (threadId: string) => {
      if (threadId === "thread-1") {
        reportActive();
        await release;
      }
      return { message: "了解" };
    });
    const sessionA = client.scope("session-a");
    const sessionB = client.scope("session-b");

    const firstA = sessionA.navigate!(navigatorInput());
    await active;
    await expect(sessionB.navigate!(navigatorInput())).rejects.toBeInstanceOf(
      AppServerScopeCapacityError,
    );
    await expect(client.resetContext()).rejects.toThrow("operations are active");
    expect(deletedThreadIds(request)).toEqual([]);

    const legacy = await client.navigate(navigatorInput());
    expect(legacy.threadId).toBe("thread-2");
    releaseActive();
    await firstA;

    const firstB = await sessionB.navigate!(navigatorInput());
    const legacyAgain = await client.navigate(navigatorInput());
    expect(firstB.threadId).toBe("thread-3");
    expect(legacyAgain.threadId).toBe(legacy.threadId);
    expect(deletedThreadIds(request)).toEqual(["thread-1"]);
  });

  it("deletes every cached role on owner reset and starts fresh contexts", async () => {
    const client = new CodexAppServerClient("codex", "/tmp");
    const { request } = stubAppServer(client);
    const session = client.scope("session-a");

    const scopedBefore = await session.navigate!(navigatorInput());
    const defaultBefore = await client.navigate(navigatorInput());
    await client.resetContext();
    const scopedAfter = await session.navigate!(navigatorInput());
    const defaultAfter = await client.navigate(navigatorInput());

    expect(deletedThreadIds(request)).toEqual(
      expect.arrayContaining([scopedBefore.threadId, defaultBefore.threadId]),
    );
    expect(deletedThreadIds(request)).toHaveLength(2);
    expect(scopedAfter.threadId).toBe("thread-3");
    expect(defaultAfter.threadId).toBe("thread-4");
  });

  it("rejects unsafe or unbounded session namespaces", () => {
    const client = new CodexAppServerClient("codex", "/tmp");

    for (const namespace of ["", "has space", "has/slash", "日本語", "a".repeat(129)]) {
      expect(() => client.scope(namespace)).toThrow("scope namespace");
    }
    expect(() => client.scope(`a${"-".repeat(127)}`)).not.toThrow();
  });

  it("validates session resource options", () => {
    expect(
      () => new CodexAppServerClient("codex", "/tmp", { maxSessionScopes: 0 }),
    ).toThrow("maxSessionScopes");
    expect(
      () => new CodexAppServerClient("codex", "/tmp", { maxSessionScopes: 1.5 }),
    ).toThrow("maxSessionScopes");
    expect(
      () => new CodexAppServerClient("codex", "/tmp", { sessionScopeTtlMs: 0 }),
    ).toThrow("sessionScopeTtlMs");
  });

  it("applies fast and deliberate model settings to every corresponding role", async () => {
    const client = new CodexAppServerClient("codex", "/tmp", {
      modelPolicy: {
        model: "gpt-5.6-terra",
        fastReasoningEffort: "low",
        deliberateReasoningEffort: "medium",
      },
    });
    const { internals, request } = stubAppServer(client);

    for (const role of ["navigator", "haru", "aoi"] as const) {
      await internals.thread("default", role);
    }
    for (const role of ["director", "haru-reflection", "aoi-reflection"] as const) {
      await internals.thread("default", role);
    }

    const starts = request.mock.calls.filter(([method]) => method === "thread/start");
    expect(starts).toHaveLength(6);
    for (const [, params] of starts.slice(0, 3)) {
      expect(params).toMatchObject({
        model: "gpt-5.6-terra",
        config: { model_reasoning_effort: "low" },
      });
    }
    for (const [, params] of starts.slice(3)) {
      expect(params).toMatchObject({
        model: "gpt-5.6-terra",
        config: { model_reasoning_effort: "medium" },
      });
    }
  });

  it("omits model settings when no model policy is configured", async () => {
    const client = new CodexAppServerClient("codex", "/tmp");
    const { internals, request } = stubAppServer(client);

    await internals.thread("default", "navigator");

    const [, params] = request.mock.calls.find(([method]) => method === "thread/start")!;
    expect(params).not.toHaveProperty("model");
    expect(params).not.toHaveProperty("config.model_reasoning_effort");
  });

  it("validates configured model policies", () => {
    const policy = {
      model: "gpt-5.6-terra",
      fastReasoningEffort: "low" as const,
      deliberateReasoningEffort: "medium" as const,
    };

    expect(
      () => new CodexAppServerClient("codex", "/tmp", { modelPolicy: { ...policy, model: " " } }),
    ).toThrow("modelPolicy.model");
    expect(
      () =>
        new CodexAppServerClient("codex", "/tmp", {
          modelPolicy: { ...policy, model: "m".repeat(129) },
        }),
    ).toThrow("modelPolicy.model");
    expect(
      () =>
        new CodexAppServerClient("codex", "/tmp", {
          modelPolicy: { ...policy, fastReasoningEffort: "turbo" as "low" },
        }),
    ).toThrow("modelPolicy.fastReasoningEffort");
    expect(
      () =>
        new CodexAppServerClient("codex", "/tmp", {
          modelPolicy: { ...policy, deliberateReasoningEffort: "turbo" as "medium" },
        }),
    ).toThrow("modelPolicy.deliberateReasoningEffort");
    expect(
      () =>
        new CodexAppServerClient("codex", "/tmp", {
          modelPolicy: { ...policy, model: ` ${"m".repeat(128)} ` },
        }),
    ).not.toThrow();
  });

  it("exposes readiness and clears cached thread IDs when the owner shuts down", async () => {
    const client = new CodexAppServerClient("codex", "/tmp");
    const { internals, request } = stubAppServer(client);
    const session = client.scope("session-a");

    await client.ready();
    expect(internals.start).toHaveBeenCalledOnce();

    const beforeShutdown = await session.navigate!(navigatorInput());
    await client.shutdown();
    const afterShutdown = await session.navigate!(navigatorInput());

    expect(beforeShutdown.threadId).toBe("thread-1");
    expect(afterShutdown.threadId).toBe("thread-2");
    expect(request.mock.calls.filter(([method]) => method === "thread/start")).toHaveLength(2);
  });
});
