import { describe, expect, it } from "vitest";
import { normalizeGameState } from "../../web/src/api.js";

describe("web game-state normalization", () => {
  it("keeps the last event at its historical phase after the game advances", () => {
    const state = normalizeGameState({
      revision: 2,
      status: "awaiting_suggestion",
      shared: {
        day: 1,
        phase: "afternoon",
        relationshipLabel: "roommates",
        unresolvedConflicts: [],
        sharedMemories: [],
      },
      characters: {
        haru: {
          state: { location: "リビング" },
          lastDecision: {
            decision: "ACCEPT",
            action: "お茶を淹れる",
            dialogue: "温かいうちにどうぞ。",
            publicReason: "一緒に休みたかったから",
          },
        },
        aoi: {
          state: { location: "リビング" },
          lastDecision: {
            decision: "MODIFY",
            action: "カップを並べる",
            dialogue: "窓辺で飲もうか。",
            publicReason: "静かに話せそうだから",
          },
        },
      },
      eventLog: [
        {
          id: "log-old",
          day: 1,
          phase: "morning",
          eventTitle: "朝のお茶",
          narration: "二人は朝の光の中でお茶を飲んだ。",
          haruReaction: "ACCEPT: お茶を淹れる",
          aoiReaction: "MODIFY: カップを並べる",
        },
      ],
      lastEvent: {
        eventTitle: "朝のお茶",
        narration: "二人は朝の光の中でお茶を飲んだ。",
        haruDialogue: "温かいうちにどうぞ。",
        aoiDialogue: "窓辺で飲もうか。",
        scene: { haru: "キッチン", aoi: "ダイニング" },
      },
    });

    expect(state.currentEvent).toMatchObject({ day: 1, phase: "morning" });
    expect(state.eventLog[0]).toMatchObject({
      haruDecision: "ACCEPT",
      aoiDecision: "MODIFY",
      haruAction: "お茶を淹れる",
      aoiAction: "カップを並べる",
      haruDialogue: "温かいうちにどうぞ。",
      aoiDialogue: "窓辺で飲もうか。",
      haruPublicReason: "一緒に休みたかったから",
      aoiPublicReason: "静かに話せそうだから",
      scene: { haru: "キッチン", aoi: "ダイニング" },
    });
  });
});
