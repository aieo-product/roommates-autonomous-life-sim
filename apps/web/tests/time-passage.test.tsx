import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  TimePassageOverlay,
  nextTimeSlot,
  shouldShowIdleEventDialogue,
  type TimePassageTransition,
} from "../src/App.js";

const renderTransition = (transition: TimePassageTransition): string =>
  renderToStaticMarkup(<TimePassageOverlay transition={transition} />);

describe("time passage transition", () => {
  it("advances through phases and rolls night into the next morning", () => {
    expect(nextTimeSlot(3, "morning")).toEqual({ day: 3, phase: "afternoon" });
    expect(nextTimeSlot(3, "afternoon")).toEqual({ day: 3, phase: "evening" });
    expect(nextTimeSlot(3, "evening")).toEqual({ day: 3, phase: "night" });
    expect(nextTimeSlot(3, "night")).toEqual({ day: 4, phase: "morning" });
    expect(nextTimeSlot(7, "night")).toEqual({ day: 7, phase: "morning" });
  });

  it("announces the target day and phase while time is passing", () => {
    const markup = renderTransition({
      from: { day: 3, phase: "night" },
      to: { day: 4, phase: "morning" },
      stage: "passing",
    });

    expect(markup).toContain('class="time-passage-overlay is-passing"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="assertive"');
    expect(markup).toContain("DAY 3 NIGHTからDAY 4 MORNINGへ");
    expect(markup).toContain("TIME IS PASSING...");
    expect(markup).toContain("MORNING");
    expect(markup).toContain("朝 · 07:00");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="68"');
  });

  it("exposes a completed progress state before revealing the new room", () => {
    const markup = renderTransition({
      from: { day: 4, phase: "morning" },
      to: { day: 4, phase: "afternoon" },
      stage: "reveal",
    });

    expect(markup).toContain('class="time-passage-overlay is-reveal"');
    expect(markup).toContain("DAY 4 AFTERNOON、昼になりました");
    expect(markup).toContain("NEW TIME SLOT");
    expect(markup).toContain("新しい時間帯がはじまります");
    expect(markup).toContain('aria-valuenow="100"');
  });

  it("does not carry the previous phase's dialogue into a new idle scene", () => {
    const previousEvent = { day: 3, phase: "morning" as const };

    expect(shouldShowIdleEventDialogue("awaiting_suggestion", 3, "afternoon", previousEvent)).toBe(false);
    expect(shouldShowIdleEventDialogue("awaiting_suggestion", 3, "morning", previousEvent)).toBe(false);
    expect(shouldShowIdleEventDialogue("resolved", 3, "afternoon", previousEvent)).toBe(false);
    expect(shouldShowIdleEventDialogue("resolved", 3, "morning", previousEvent)).toBe(true);
  });
});
