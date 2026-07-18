import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHARACTER_SETTINGS } from "@roommates/shared";
import { runTurn } from "../src/api.js";

const originalFetch = globalThis.fetch;

const sseResponse = (body: string): Response => new Response(body, {
  status: 200,
  headers: { "Content-Type": "text/event-stream; charset=utf-8" },
});

const chunkedSseResponse = (chunks: string[]): Response => {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("runTurn SSE handling", () => {
  it("rejects a public SSE error instead of silently clearing the submitted cue", async () => {
    globalThis.fetch = vi.fn(async () => sseResponse(
      "event: turn.started\r\ndata: {\"type\":\"turn.started\",\"message\":\"開始\"}\r\n\r\n" +
      "event: error\r\ndata: {\"type\":\"error\",\"message\":\"ターンの処理に失敗しました\"}\r\n\r\n",
    ));
    const events: string[] = [];

    await expect(runTurn(
      "一緒に朝食を作ってみたら？",
      0,
      DEFAULT_CHARACTER_SETTINGS,
      (message) => events.push(message.event),
    )).rejects.toThrow("ターンの処理に失敗しました");

    expect(events).toEqual(["turn.started", "error"]);
  });

  it("resolves after a successful completed event", async () => {
    globalThis.fetch = vi.fn(async () => chunkedSseResponse([
      "event: turn.completed\r",
      "\ndata: {\"type\":\"turn.completed\",\"data\":{\"status\":\"resolved\"}}\r\n\r",
      "\n",
    ]));
    const events: string[] = [];

    await expect(runTurn(
      "何も提案せず見守る",
      1,
      DEFAULT_CHARACTER_SETTINGS,
      (message) => events.push(message.event),
    )).resolves.toBeUndefined();

    expect(events).toEqual(["turn.completed"]);
  });
});
