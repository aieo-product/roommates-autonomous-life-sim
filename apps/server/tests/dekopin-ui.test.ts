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

  it("bundles and animates the navigator sprite as Dekopin", () => {
    const app = readFileSync(new URL("../../web/src/App.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../web/src/styles.css", import.meta.url), "utf8");

    expect(DEKOPIN_NAME).toBe("デコピン");
    expect(app).toContain('from "../../../assets/characters/navigator/walk-cycle.png"');
    expect(app).toContain('normalizedType === "navigator.completed"');
    expect(app).toContain("デコピンが反映したイベント");
    expect(css).toContain("image-rendering: pixelated");
    expect(css).toContain("@keyframes dekopinHover");
    expect(css).toContain("dekopinHover 680ms");
    expect(css).toContain("translateX(-66.6667%)");
  });
});
