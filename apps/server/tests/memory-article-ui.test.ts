import { describe, expect, it } from "vitest";
import {
  buildMemoryArticle,
  findEventForMemory,
} from "../../web/src/memory-article.js";
import type { GameEvent, Memory } from "../../web/src/types.js";

const memory = (overrides: Partial<Memory> = {}): Memory => ({
  id: "memory-turn-1",
  day: 2,
  phase: "evening",
  title: "焦げた玉ねぎと笑い声",
  summary: "二人でカレーを作った夜",
  emotionalImpact: 6,
  participants: ["haru", "aoi"],
  importance: 8,
  ...overrides,
});

const event = (overrides: Partial<GameEvent> = {}): GameEvent => ({
  id: "log-turn-1",
  eventDefinitionId: "shared-cooking",
  day: 2,
  phase: "evening",
  eventTitle: "ふたりの即席カレー",
  narration: "二人は役割を分け、少し焦げたカレーを笑って食べた。",
  suggestion: "一緒に夕食を作ってみたら？",
  haruDecision: "ACCEPT",
  aoiDecision: "MODIFY",
  haruAction: "玉ねぎを切る",
  aoiAction: "味付けを担当する",
  haruDialogue: "玉ねぎは任せて。",
  aoiDialogue: "じゃあ、味見はお願いね。",
  haruPublicReason: "一緒なら楽しそうだから",
  aoiPublicReason: "得意な役割なら参加できそうだから",
  scene: { haru: "キッチン", aoi: "キッチン" },
  ...overrides,
});

describe("memory article presentation", () => {
  it("prefers the explicit source event over other events in the same phase", () => {
    const source = event({ id: "log-explicit" });
    const ambiguous = event({ id: "log-other", eventTitle: "別のできごと" });

    expect(
      findEventForMemory(memory({ sourceEventId: source.id }), [ambiguous, source]),
    ).toBe(source);
  });

  it("does not guess another event when an explicit source link is missing", () => {
    const unrelated = event({ id: "log-other" });

    expect(
      findEventForMemory(memory({ sourceEventId: "log-missing" }), [unrelated]),
    ).toBeUndefined();
  });

  it("matches legacy engine IDs without an explicit link", () => {
    expect(findEventForMemory(memory(), [event()])?.id).toBe("log-turn-1");
  });

  it("falls back to the single event at the same day and phase", () => {
    const fallback = event({ id: "external-event" });
    expect(
      findEventForMemory(memory({ id: "external-memory" }), [fallback]),
    ).toBe(fallback);
  });

  it("builds an article from saved actions, dialogue, and the historical scene", () => {
    const article = buildMemoryArticle(
      memory({ sourceEventId: "log-turn-1" }),
      [event()],
    );

    expect(article.captureIsExact).toBe(true);
    expect(article.scene).toEqual({ haru: "キッチン", aoi: "キッチン" });
    expect(article.haru).toMatchObject({
      decision: "ACCEPT",
      action: "玉ねぎを切る",
      dialogue: "玉ねぎは任せて。",
    });
    expect(article.aoi).toMatchObject({
      decision: "MODIFY",
      action: "味付けを担当する",
      dialogue: "じゃあ、味見はお願いね。",
    });
  });

  it("quotes the final Director conversation instead of independent dialogue drafts", () => {
    const article = buildMemoryArticle(
      memory({ sourceEventId: "log-turn-1" }),
      [
        event({
          haruDialogue: "独立推論のHaru台詞",
          aoiDialogue: "独立推論のAoi台詞",
          conversation: [
            { speaker: "aoi", text: "味付けはどうしようか？" },
            { speaker: "haru", text: "少し甘めにして、一緒に味見しよう。" },
            { speaker: "aoi", text: "賛成。じゃあ私が少しずつ足すね。" },
          ],
        }),
      ],
    );

    expect(article.haru.dialogue).toBe("少し甘めにして、一緒に味見しよう。");
    expect(article.aoi.dialogue).toBe("味付けはどうしようか？");
    expect(article.haru.dialogue).not.toContain("独立推論");
    expect(article.aoi.dialogue).not.toContain("独立推論");
  });

  it("does not borrow current dialogue when an old memory has no matching log", () => {
    const article = buildMemoryArticle(
      memory({ id: "external-memory", day: 1, phase: "morning" }),
      [event({ id: "latest", day: 7, phase: "night" })],
    );

    expect(article.event).toBeUndefined();
    expect(article.haru.dialogue).toBeUndefined();
    expect(article.aoi.dialogue).toBeUndefined();
    expect(article.captureIsExact).toBe(false);
  });
});
