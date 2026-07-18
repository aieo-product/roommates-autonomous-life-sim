import { describe, expect, it } from "vitest";
import { getGameControlState } from "../src/game-controls.js";

const controls = (
  status: "awaiting_suggestion" | "resolving" | "resolved" | "ended",
  overrides: Partial<Parameters<typeof getGameControlState>[0]> = {},
) => getGameControlState({
  status,
  completed: false,
  loading: false,
  offline: false,
  resolving: false,
  actionBusy: null,
  ...overrides,
});

describe("game controls", () => {
  it("only accepts a cue while the server is awaiting one", () => {
    expect(controls("awaiting_suggestion")).toMatchObject({
      canSubmitCue: true,
      canAdvance: false,
      canFastForward: true,
    });
    expect(controls("resolved")).toMatchObject({
      canSubmitCue: false,
      canAdvance: true,
      canFastForward: true,
    });
  });

  it("blocks every mutation for a persisted resolving state", () => {
    expect(controls("resolving")).toMatchObject({
      canSubmitCue: false,
      canAdvance: false,
      canFastForward: false,
    });
  });

  it("explains why time passage is unavailable before the cue resolves", () => {
    expect(controls("awaiting_suggestion").cueStatusMessage).toContain("指示");
    expect(controls("resolved").cueStatusMessage).toContain("次の時間帯");
  });

  it("blocks controls while any local operation or offline state is active", () => {
    expect(controls("awaiting_suggestion", { actionBusy: "fast" }).canSubmitCue).toBe(false);
    expect(controls("resolved", { resolving: true }).canAdvance).toBe(false);
    expect(controls("resolved", { offline: true }).canFastForward).toBe(false);
  });

  it("blocks every mutation until the persisted game has loaded", () => {
    expect(controls("awaiting_suggestion", { loading: true })).toMatchObject({
      canSubmitCue: false,
      canAdvance: false,
      canFastForward: false,
      cueStatusMessage: expect.stringContaining("読み込んで"),
    });
  });
});
