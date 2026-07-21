import { describe, expect, it } from "vitest";
import {
  EVENT_CONVERSATION_TEXT_MAX_LENGTH,
  EVENT_STORY_BEAT_CONTENT_MAX_LENGTH,
  EVENT_STORY_BEAT_LOCATION_MAX_LENGTH,
  characterDecisionSchema,
  navigatorResponseSchema,
  resolvedEventSchema,
  type CharacterDecision,
  type CharacterRoster,
  type NavigatorResponse,
  type ResolvedEvent,
} from "@roommates/shared";
import {
  INITIATIVE_PUBLIC_INTENT_MAX_LENGTH,
  NAVIGATOR_MESSAGE_MAX_LENGTH,
  PUBLIC_PROSE_MAX_LENGTH,
  normalizeCharacterNamesInText,
  normalizeDecisionCharacterNames,
  normalizeNavigatorResponseCharacterNames,
  normalizeResolvedEventCharacterNames,
} from "../src/engine/character-presentation.js";

const roster: CharacterRoster = {
  haru: { id: "haru", displayName: "春", role: "male" },
  aoi: { id: "aoi", displayName: "葵子", role: "female" },
};

describe("server character presentation boundary", () => {
  it("replaces legacy public names without rewriting stable room IDs", () => {
    expect(normalizeCharacterNamesInText(
      "HaruとAoi。ハルはアオイを待ち、haru_roomからaoi_roomへ向かった。",
      roster,
    )).toBe("春と葵子。春は葵子を待ち、haru_roomからaoi_roomへ向かった。");
  });

  it("is idempotent when a configured name contains a legacy name", () => {
    const aliasRoster: CharacterRoster = {
      haru: { id: "haru", displayName: "Haru-kun", role: "male" },
      aoi: { id: "aoi", displayName: "ハルカ", role: "female" },
    };
    const once = normalizeCharacterNamesInText("HaruとAoiとハルとアオイ", aliasRoster);
    expect(normalizeCharacterNamesInText(once, aliasRoster)).toBe(once);
  });

  it("normalizes event prose while preserving conversation speakers and story actors", () => {
    const event: ResolvedEvent = {
      eventTitle: "HaruとAoiの会話",
      narration: "ハルがアオイへ声をかけた。",
      haruDialogue: "Aoi、話そう。",
      aoiDialogue: "うん、Haru。",
      conversation: [
        { speaker: "haru", text: "Aoi、話そう。" },
        { speaker: "aoi", text: "うん、Haru。" },
        { speaker: "haru", text: "ゆっくりでいいよ。" },
      ],
      storyBeats: [
        { kind: "move", actor: "both", location: "Haruの自室" },
        { kind: "dialogue", actor: "haru", text: "Aoi、話そう。" },
        { kind: "dialogue", actor: "aoi", text: "うん、聞かせて。" },
        { kind: "action", actor: "aoi", action: "アオイがお茶を置く" },
        { kind: "dialogue", actor: "aoi", text: "うん、Haru。" },
      ],
      effects: { haru: {}, aoi: {} },
      memory: {
        title: "HaruとAoiの会話",
        summary: "ハルとアオイが話した",
        emotionalImpact: 1,
        importance: 2,
      },
      scene: { haru: "haru_room", aoi: "Aoiの自室" },
    };

    const normalized = normalizeResolvedEventCharacterNames(event, roster);
    expect(normalized.characterRoster).toEqual(roster);
    expect(JSON.stringify(normalized)).not.toMatch(/Haru|Aoi|ハル|アオイ/u);
    expect(normalized.conversation?.map(({ speaker }) => speaker)).toEqual([
      "haru",
      "aoi",
      "haru",
    ]);
    expect(normalized.storyBeats?.map(({ actor }) => actor)).toEqual([
      "both",
      "haru",
      "aoi",
      "aoi",
      "aoi",
    ]);
    expect(normalized.scene?.haru).toBe("haru_room");
  });

  it("clips expanded replacement names to every persisted prose limit", () => {
    const maxRoster: CharacterRoster = {
      haru: { id: "haru", displayName: "春".repeat(20), role: "male" },
      aoi: { id: "aoi", displayName: "葵".repeat(20), role: "female" },
    };
    const legacyText = (maxLength: number): string =>
      "ハル".repeat(Math.floor(maxLength / 2));

    expect(normalizeCharacterNamesInText(
      legacyText(EVENT_CONVERSATION_TEXT_MAX_LENGTH),
      maxRoster,
      EVENT_CONVERSATION_TEXT_MAX_LENGTH,
    )).toHaveLength(EVENT_CONVERSATION_TEXT_MAX_LENGTH);

    const decision: CharacterDecision = {
      decision: "INITIATE",
      action: legacyText(PUBLIC_PROSE_MAX_LENGTH),
      dialogue: legacyText(PUBLIC_PROSE_MAX_LENGTH),
      publicReason: legacyText(PUBLIC_PROSE_MAX_LENGTH),
      internalSummary: "検証用",
      expectedEffects: {},
      initiative: {
        candidateId: "max-name-regression",
        invitation: "open",
        publicIntent: legacyText(INITIATIVE_PUBLIC_INTENT_MAX_LENGTH),
      },
    };
    const normalizedDecision = normalizeDecisionCharacterNames(decision, maxRoster);
    expect(() => characterDecisionSchema.parse(normalizedDecision)).not.toThrow();
    expect(normalizedDecision.action).toHaveLength(PUBLIC_PROSE_MAX_LENGTH);
    expect(normalizedDecision.dialogue).toHaveLength(PUBLIC_PROSE_MAX_LENGTH);
    expect(normalizedDecision.publicReason).toHaveLength(PUBLIC_PROSE_MAX_LENGTH);
    expect(normalizedDecision.initiative?.publicIntent)
      .toHaveLength(INITIATIVE_PUBLIC_INTENT_MAX_LENGTH);

    const navigator: NavigatorResponse = {
      characterId: "navigator",
      characterName: "デコピン",
      message: legacyText(NAVIGATOR_MESSAGE_MAX_LENGTH),
      eventDefinitionId: "shared-cooking",
      eventTitle: legacyText(PUBLIC_PROSE_MAX_LENGTH),
      outcome: "selected",
    };
    const normalizedNavigator = normalizeNavigatorResponseCharacterNames(
      navigator,
      maxRoster,
    );
    expect(() => navigatorResponseSchema.parse(normalizedNavigator)).not.toThrow();
    expect(normalizedNavigator.message).toHaveLength(NAVIGATOR_MESSAGE_MAX_LENGTH);

    const exactConflictId = "HaruとAoiの未解決な約束";
    const event: ResolvedEvent = {
      eventTitle: legacyText(PUBLIC_PROSE_MAX_LENGTH),
      narration: legacyText(PUBLIC_PROSE_MAX_LENGTH),
      navigatorMessage: legacyText(NAVIGATOR_MESSAGE_MAX_LENGTH),
      haruDialogue: legacyText(PUBLIC_PROSE_MAX_LENGTH),
      aoiDialogue: legacyText(PUBLIC_PROSE_MAX_LENGTH),
      conversation: [
        { speaker: "haru", text: legacyText(EVENT_CONVERSATION_TEXT_MAX_LENGTH) },
        { speaker: "aoi", text: legacyText(EVENT_CONVERSATION_TEXT_MAX_LENGTH) },
        { speaker: "haru", text: legacyText(EVENT_CONVERSATION_TEXT_MAX_LENGTH) },
      ],
      storyBeats: [
        { kind: "move", actor: "both", location: legacyText(EVENT_STORY_BEAT_LOCATION_MAX_LENGTH) },
        { kind: "dialogue", actor: "haru", text: legacyText(EVENT_STORY_BEAT_CONTENT_MAX_LENGTH) },
        { kind: "dialogue", actor: "aoi", text: legacyText(EVENT_STORY_BEAT_CONTENT_MAX_LENGTH) },
        { kind: "action", actor: "both", action: legacyText(EVENT_STORY_BEAT_CONTENT_MAX_LENGTH) },
        { kind: "dialogue", actor: "haru", text: legacyText(EVENT_STORY_BEAT_CONTENT_MAX_LENGTH) },
      ],
      effects: { haru: {}, aoi: {} },
      memory: {
        title: legacyText(PUBLIC_PROSE_MAX_LENGTH),
        summary: legacyText(PUBLIC_PROSE_MAX_LENGTH),
        emotionalImpact: 1,
        importance: 1,
      },
      scene: {
        haru: legacyText(EVENT_STORY_BEAT_LOCATION_MAX_LENGTH),
        aoi: legacyText(EVENT_STORY_BEAT_LOCATION_MAX_LENGTH),
      },
      conflictUpdate: {
        add: [legacyText(PUBLIC_PROSE_MAX_LENGTH)],
        resolve: [exactConflictId],
      },
    };
    const normalizedEvent = normalizeResolvedEventCharacterNames(event, maxRoster);
    expect(() => resolvedEventSchema.parse(normalizedEvent)).not.toThrow();
    expect(normalizedEvent.navigatorMessage).toHaveLength(NAVIGATOR_MESSAGE_MAX_LENGTH);
    expect(normalizedEvent.conversation?.every(
      ({ text }) => text.length <= EVENT_CONVERSATION_TEXT_MAX_LENGTH,
    )).toBe(true);
    expect(normalizedEvent.storyBeats?.every((beat) =>
      beat.kind === "move"
        ? beat.location.length <= EVENT_STORY_BEAT_LOCATION_MAX_LENGTH
        : (beat.kind === "dialogue" ? beat.text : beat.action).length <=
          EVENT_STORY_BEAT_CONTENT_MAX_LENGTH,
    )).toBe(true);
    const finalMove = normalizedEvent.storyBeats?.find(
      (beat) => beat.kind === "move" && beat.actor === "both",
    );
    expect(finalMove?.kind === "move" ? finalMove.location : undefined)
      .toBe(normalizedEvent.scene?.haru);
    expect(normalizedEvent.scene?.aoi).toBe(normalizedEvent.scene?.haru);
    expect(normalizedEvent.conflictUpdate?.resolve).toEqual([exactConflictId]);
  });
});
