import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEKOPIN_NAME,
  getDekopinPresentation,
} from "../../web/src/dekopin.js";

const base = {
  resolving: false,
  offline: false,
  draft: "",
  streamMessage: "",
};

describe("Dekopin web presentation", () => {
  it("guides the player from idle through draft and resolution", () => {
    expect(getDekopinPresentation(base)).toMatchObject({
      mood: "idle",
      statusLabel: "受付中",
    });

    expect(getDekopinPresentation({ ...base, draft: "一緒に夕食を作って" })).toMatchObject({
      mood: "ready",
      message: expect.stringContaining("一緒に夕食を作って"),
    });

    expect(getDekopinPresentation({
      ...base,
      resolving: true,
      streamMessage: "ふたりの返事を待っているよ…",
    })).toEqual({
      mood: "working",
      statusLabel: "反映中",
      message: "ふたりの返事を待っているよ…",
    });
  });

  it("shows the persisted navigator response after the event", () => {
    expect(getDekopinPresentation({
      ...base,
      event: {
        eventTitle: "ふたりの夕食",
        narration: "ふたりは夕食を作った。",
        navigatorMessage: "夕食のイベントに反映したよ！",
      },
    })).toEqual({
      mood: "complete",
      statusLabel: "反映完了",
      message: "夕食のイベントに反映したよ！",
    });
  });

  it("makes an offline connection state explicit", () => {
    expect(getDekopinPresentation({ ...base, offline: true })).toMatchObject({
      mood: "offline",
      statusLabel: "接続待ち",
    });
  });

  it("bundles the navigator sprite and consumes navigator SSE as デコピン", () => {
    const app = readFileSync(new URL("../../web/src/App.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../web/src/styles.css", import.meta.url), "utf8");

    expect(DEKOPIN_NAME).toBe("デコピン");
    expect(app).toContain('from "../../../assets/characters/navigator/walk-cycle.png"');
    expect(app).toContain("navigatorCharacterAssets");
    expect(app).toContain("navigatorCharacterAssets.portraitUrl");
    expect(app).toContain('className="brand-mark" aria-hidden="true"');
    expect(app).toContain('className="event-announcement-mini-avatar"');
    expect(app).toContain('normalizedType === "navigator.completed"');
    expect(app).toContain("デコピンが反映したイベント");
    expect(css).toContain("image-rendering: pixelated");
  });

  it("shows character execution state without a decision badge in speech bubbles", () => {
    const app = readFileSync(new URL("../../web/src/App.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../web/src/styles.css", import.meta.url), "utf8");
    const sceneStart = app.indexOf("function SceneCharacter");
    const sceneEnd = app.indexOf("function ApartmentStage", sceneStart);
    const scene = app.slice(sceneStart, sceneEnd);

    expect(scene).toContain("character-thinking-progress");
    expect(scene).toContain("thinking-progress-track");
    expect(scene).toContain("thinking-progress-fill");
    expect(scene).toContain("、判断中。選択");
    expect(scene).toContain("aria-busy={thinking ? true : undefined}");
    expect(scene).toContain('transform="translate(0 -106)" aria-hidden="true"');
    expect(scene).toContain(">判断中</text>");
    expect(scene).not.toContain("DECISION_LABELS[decision.decision]");
    expect(css).toContain("@keyframes characterThinkingProgress");
    expect(css).toMatch(/\.thinking-progress-fill\s*\{[\s\S]*?animation:\s*characterThinkingProgress/);
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.thinking-progress-fill[\s\S]*?animation:\s*none !important/);
    expect(app.match(/setStages\(\{ navigator: "active", haru: "active", aoi: "active", director: "waiting" \}\)/g))
      .toHaveLength(2);
    expect(css).not.toContain(".scene-speech span");
  });
});
