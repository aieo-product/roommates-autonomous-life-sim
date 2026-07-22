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

  it("keeps structured and top-level navigator responses on the public event", () => {
    const state = normalizeGameState({
      revision: 1,
      status: "resolved",
      shared: {
        day: 1,
        phase: "morning",
        relationshipLabel: "roommates",
        unresolvedConflicts: [],
        sharedMemories: [],
      },
      navigator: {
        characterId: "navigator",
        characterName: "デコピン",
        eventDefinitionId: "cook-together",
        eventTitle: "ふたりの朝食",
        outcome: "selected",
        message: "朝食づくりのイベントに反映したよ！",
      },
      eventLog: [
        {
          id: "log-navigator",
          day: 1,
          phase: "morning",
          eventTitle: "ふたりの朝食",
          narration: "ふたりは朝食を作った。",
          navigatorResponse: {
            message: "朝食づくりのイベントに反映したよ！",
          },
        },
      ],
      lastEvent: {
        eventTitle: "ふたりの朝食",
        narration: "ふたりは朝食を作った。",
      },
    });

    expect(state.currentEvent?.navigatorMessage).toBe("朝食づくりのイベントに反映したよ！");
    expect(state.eventLog[0]?.navigatorMessage).toBe("朝食づくりのイベントに反映したよ！");
  });

  it("uses the Director conversation instead of independent decision drafts", () => {
    const event = {
      id: "log-conversation",
      day: 1,
      phase: "morning",
      eventTitle: "朝食の相談",
      narration: "二人は朝食について相談した。",
      conversation: [
        { speaker: "aoi", text: "パンとご飯、どちらにする？" },
        { speaker: "haru", text: "今日はパンがいいな。一緒に焼こう。" },
        { speaker: "aoi", text: "うん、私は飲み物を用意するね。" },
      ],
    };
    const state = normalizeGameState({
      revision: 1,
      status: "resolved",
      shared: {
        day: 1,
        phase: "morning",
        relationshipLabel: "roommates",
        unresolvedConflicts: [],
        sharedMemories: [],
      },
      characters: {
        haru: {
          state: { location: "キッチン" },
          lastDecision: {
            decision: "ACCEPT",
            action: "パンを焼く",
            dialogue: "独立推論のHaru台詞",
          },
        },
        aoi: {
          state: { location: "キッチン" },
          lastDecision: {
            decision: "MODIFY",
            action: "飲み物を用意する",
            dialogue: "独立推論のAoi台詞",
          },
        },
      },
      eventLog: [event],
      lastEvent: event,
    });

    expect(state.currentEvent?.conversation).toEqual(event.conversation);
    expect(state.currentEvent?.haruDialogue).toBe("今日はパンがいいな。一緒に焼こう。");
    expect(state.currentEvent?.aoiDialogue).toBe("パンとご飯、どちらにする？");
    expect(state.eventLog[0]?.haruDialogue).not.toContain("独立推論");
    expect(state.eventLog[0]?.aoiDialogue).not.toContain("独立推論");
  });

  it("keeps all ten authored story beats in the current event and event log", () => {
    const conversation = [
      { speaker: "haru", text: "朝ごはんを一緒に作らない？" },
      { speaker: "aoi", text: "いいね。私は飲み物を担当するよ。" },
      { speaker: "haru", text: "じゃあ、まずキッチンへ行こう。" },
      { speaker: "aoi", text: "食卓の準備もあとでしよう。" },
      { speaker: "haru", text: "パンが焼けたよ。" },
      { speaker: "aoi", text: "運んで一緒に食べよう。" },
    ];
    const storyBeats = [
      { kind: "dialogue", actor: "haru", text: conversation[0]!.text },
      { kind: "dialogue", actor: "aoi", text: conversation[1]!.text },
      { kind: "move", actor: "both", location: "キッチンの調理台" },
      { kind: "dialogue", actor: "haru", text: conversation[2]!.text },
      { kind: "dialogue", actor: "aoi", text: conversation[3]!.text },
      { kind: "action", actor: "both", action: "朝食を用意する" },
      { kind: "dialogue", actor: "haru", text: conversation[4]!.text },
      { kind: "move", actor: "both", location: "ダイニングの食卓" },
      { kind: "action", actor: "both", action: "朝食を並べる" },
      { kind: "dialogue", actor: "aoi", text: conversation[5]!.text },
    ];
    const event = {
      id: "log-ten-beats",
      day: 1,
      phase: "morning",
      eventTitle: "二人の朝食",
      narration: "二人は朝食を用意して食卓へ運んだ。",
      conversation,
      storyBeats,
    };
    const state = normalizeGameState({
      revision: 1,
      status: "resolved",
      shared: {
        day: 1,
        phase: "morning",
        relationshipLabel: "roommates",
        unresolvedConflicts: [],
        sharedMemories: [],
      },
      eventLog: [event],
      lastEvent: event,
    });

    expect(state.currentEvent?.storyBeats).toHaveLength(10);
    expect(state.currentEvent?.storyBeats).toEqual(storyBeats);
    expect(state.eventLog[0]?.storyBeats).toHaveLength(10);
    expect(state.eventLog[0]?.storyBeats).toEqual(storyBeats);
  });
});
