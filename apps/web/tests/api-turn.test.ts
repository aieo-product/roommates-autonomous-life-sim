import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHARACTER_SETTINGS } from "@roommates/shared";
import { INITIAL_GAME_STATE, normalizeGameState, runTurn } from "../src/api.js";

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

describe("App Server event normalization", () => {
  it("keeps a Director conversation from a nested event payload", () => {
    const normalized = normalizeGameState({
      data: {
        state: {
          status: "resolved",
          day: 2,
          phase: "evening",
          revision: 5,
          directorResult: {
            id: "app-server-event",
            director: {
              eventTitle: "夕食の相談",
              narration: "ふたりはキッチンへ移動した。",
              conversation: [
                { speaker: "haru", text: "今日は何を作ろうか。" },
                { speaker: "aoi", text: "温かいものがいいな。" },
                { speaker: "haru", text: "じゃあ一緒にスープを作ろう。" },
              ],
            },
          },
        },
      },
    }, INITIAL_GAME_STATE);

    expect(normalized.currentEvent?.conversation).toEqual([
      { speaker: "haru", text: "今日は何を作ろうか。" },
      { speaker: "aoi", text: "温かいものがいいな。" },
      { speaker: "haru", text: "じゃあ一緒にスープを作ろう。" },
    ]);
  });

  it("accepts snake-case conversation and legacy line aliases", () => {
    const normalized = normalizeGameState({
      state: {
        status: "resolved",
        eventLog: [{
          id: "snake-event",
          day: 3,
          phase: "night",
          event_title: "夜の会話",
          narration: "静かな会話が続いた。",
          event_conversation: [
            { character: "Aoi", dialogue: " 今日はありがとう。 " },
            { person: "haru", line: "こちらこそ。" },
          ],
        }],
      },
    }, INITIAL_GAME_STATE);

    expect(normalized.eventLog[0]?.conversation).toEqual([
      { speaker: "aoi", text: "今日はありがとう。" },
      { speaker: "haru", text: "こちらこそ。" },
    ]);
  });
});
