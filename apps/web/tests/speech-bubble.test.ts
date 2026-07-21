import { describe, expect, it } from "vitest";
import { resolveSpeechBubblePlacement } from "../src/speech-bubble.js";

describe("resolveSpeechBubblePlacement", () => {
  it("places simultaneous bubbles outside a resident pair", () => {
    expect(resolveSpeechBubblePlacement(
      { x: 590, y: 600 },
      { x: 700, y: 620 },
      "right",
    )).toMatchObject({ side: "left", x: -220 });

    expect(resolveSpeechBubblePlacement(
      { x: 700, y: 620 },
      { x: 590, y: 600 },
      "left",
    )).toMatchObject({ side: "right", x: 12 });
  });

  it("overrides the preferred side to stay inside the stage", () => {
    expect(resolveSpeechBubblePlacement(
      { x: 180, y: 300 },
      undefined,
      "left",
    ).side).toBe("right");

    expect(resolveSpeechBubblePlacement(
      { x: 1120, y: 300 },
      undefined,
      "right",
    ).side).toBe("left");
  });

  it("uses the resident fallback when the pair is vertically aligned", () => {
    expect(resolveSpeechBubblePlacement(
      { x: 640, y: 360 },
      { x: 650, y: 440 },
      "left",
    ).side).toBe("left");
  });
});
