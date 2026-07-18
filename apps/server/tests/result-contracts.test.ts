import {
  createInitialGameState,
  eventLogEntrySchema,
  gameResultSchema,
  gameStateSchema,
} from "@roommates/shared";
import { describe, expect, it } from "vitest";

const characterState = (mood: string) => ({
  energy: 68,
  stress: 24,
  affection: 42,
  trust: 48,
  romanticAwareness: 30,
  mood,
  location: "リビング",
  currentGoal: "相手のペースを尊重して話す",
});

const publicDecision = {
  decision: "MODIFY" as const,
  action: "短い時間だけ話す",
  dialogue: "少しだけなら、話してみたい。",
  publicReason: "自分のペースを守りたいから",
};

const snapshot = {
  characters: {
    haru: characterState("穏やか"),
    aoi: characterState("安心"),
  },
  shared: {
    relationshipLabel: "friends" as const,
    unresolvedConflicts: [],
    memoryIds: ["memory-day1-morning"],
  },
};

const navigatorResponse = {
  characterId: "navigator" as const,
  characterName: "デコピン" as const,
  message: "朝の短い会話として二人へ届けるね。",
  eventDefinitionId: "gentle-talk",
  eventTitle: "朝の短い会話",
  outcome: "selected" as const,
};

const structuredEvent = {
  id: "log-day1-morning",
  turnId: "turn-day1-morning",
  day: 1,
  phase: "morning" as const,
  eventDefinitionId: "gentle-talk",
  eventCategory: "talk" as const,
  intimacyTier: 1 as const,
  cueSafetyFlags: [],
  suggestion: "朝、短い会話の時間を作る",
  haruReaction: "MODIFY: 短い時間だけ話す",
  aoiReaction: "ACCEPT: 隣で話を聞く",
  haruDecision: "MODIFY" as const,
  aoiDecision: "ACCEPT" as const,
  haruAction: publicDecision.action,
  aoiAction: "隣で話を聞く",
  haruDialogue: publicDecision.dialogue,
  aoiDialogue: "うん、ゆっくりで大丈夫。",
  haruPublicReason: publicDecision.publicReason,
  aoiPublicReason: "相手の歩幅に合わせたいから",
  scene: { haru: "ソファ", aoi: "ソファの隣" },
  memoryId: "memory-day1-morning",
  cue: {
    kind: "proposal" as const,
    text: "朝、短い会話の時間を作る",
    category: "talk" as const,
    tags: ["talk" as const],
    safetyFlags: [],
    transformed: false,
  },
  inputMethod: "candidate" as const,
  requestedEventId: "gentle-talk",
  alternativesShown: [
    { id: "gentle-talk", title: "朝の短い会話", category: "talk" as const, intimacyTier: 1 as const },
  ],
  cueOutcome: "selected" as const,
  navigatorMessage: navigatorResponse.message,
  navigatorResponse,
  decisions: {
    haru: publicDecision,
    aoi: {
      decision: "ACCEPT" as const,
      action: "隣で話を聞く",
      dialogue: "うん、ゆっくりで大丈夫。",
      publicReason: "相手の歩幅に合わせたいから",
    },
  },
  resolutionBranch: "modified" as const,
  before: snapshot,
  after: {
    ...snapshot,
    characters: {
      haru: { ...snapshot.characters.haru, trust: 51 },
      aoi: { ...snapshot.characters.aoi, trust: 51 },
    },
  },
  appliedEffects: { haru: { trust: 3 }, aoi: { trust: 3 } },
  memory: {
    id: "memory-day1-morning",
    sourceEventId: "log-day1-morning",
    day: 1,
    phase: "morning",
    title: "朝の短い会話",
    summary: "二人は互いの歩幅を確かめながら話した。",
    emotionalImpact: 4,
    participants: ["haru", "aoi"],
    importance: 7,
  },
  conflictUpdate: { add: [], resolve: [] },
  runtimeSources: {
    haru: "app_server" as const,
    aoi: "app_server" as const,
    navigator: "app_server" as const,
    director: "app_server" as const,
  },
  eventTitle: "朝の短い会話",
  narration: "二人は無理のない長さを選び、静かに言葉を交わした。",
  relationshipBefore: "roommates" as const,
  relationshipAfter: "friends" as const,
  createdAt: "2026-07-18T00:00:00.000Z",
};

const evidence = {
  id: "evidence-agency-1",
  ruleId: "AG-02",
  points: 2,
  message: "変更提案を尊重しました",
  eventLogIds: [structuredEvent.id],
  day: 1,
  phase: "morning" as const,
};

const producerResult = {
  overallScore: 75,
  rank: "A" as const,
  producerStyle: "space_maker" as const,
  scoringVersion: "producer-v1",
  axes: [
    { id: "agency" as const, label: "主体性", score: 20, maxScore: 25, summary: "選択を尊重した", evidence: [evidence] },
    { id: "wellbeing" as const, label: "心理安全", score: 20, maxScore: 25, summary: "無理をさせなかった", evidence: [] },
    { id: "care" as const, label: "関係へのケア", score: 15, maxScore: 20, summary: "関係を育てた", evidence: [] },
    { id: "pacing" as const, label: "ペーシング", score: 10, maxScore: 15, summary: "間を整えた", evidence: [] },
    { id: "story" as const, label: "物語", score: 10, maxScore: 15, summary: "転機を残した", evidence: [] },
  ],
  topStrengths: [evidence],
  improvements: [],
  highlights: [
    {
      id: "highlight-day1-morning",
      kind: "relationship_turn" as const,
      headline: "歩幅がそろった朝",
      reason: "変更提案を尊重したことで信頼が育った",
      eventLogIds: [structuredEvent.id],
      memoryId: "memory-day1-morning",
    },
  ],
  keyMemoryIds: ["memory-day1-morning"],
  turningPointEventLogIds: [structuredEvent.id],
  statJourney: { start: snapshot, end: structuredEvent.after },
  coverage: { ratio: 1, completeTurns: 28, expectedTurns: 28, missing: [] },
  warnings: [],
};

const ending = {
  kind: "close_friends" as const,
  title: "続いていく共同生活",
  narration: "二人は互いの歩幅を大切にして暮らし続ける。",
};

const reflection = (characterId: "haru" | "aoi") => ({
  characterId,
  seasonImpression: "自分たちのペースを守れた七日間だった。",
  notableEventComments: [
    { eventLogId: structuredEvent.id, comment: "短い会話を選べたことが心に残った。" },
  ],
  bestMomentEventLogId: structuredEvent.id,
  turningPointEventLogId: structuredEvent.id,
  messageToProducer: "急がずに見守ってくれてありがとう。",
  reflectionVersion: "reflection-v1",
  runtime: { source: "app_server" as const, latencyMs: 120 },
});

const readyResult = {
  generationKey: "result-seed-28",
  endingRevision: 28,
  scoringVersion: "producer-v1",
  narrativeVersion: "narrative-v1",
  reflectionVersion: "reflection-v1",
  status: "ready" as const,
  ending,
  producer: producerResult,
  narrative: {
    headline: "歩幅を合わせた七日間",
    lead: [{ text: "二人は小さな選択を重ねた。", sourceEventLogIds: [structuredEvent.id] }],
    daySections: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      title: `Day ${index + 1}`,
      paragraphs: [{ text: `${index + 1}日目の出来事を振り返る。`, sourceEventLogIds: [structuredEvent.id] }],
      featuredEventLogId: index === 0 ? structuredEvent.id : undefined,
    })),
    closing: [{ text: "共同生活はこれからも続いていく。", sourceEventLogIds: [structuredEvent.id] }],
    narrativeVersion: "narrative-v1",
  },
  reflections: { haru: reflection("haru"), aoi: reflection("aoi") },
  generatedAt: "2026-07-18T00:01:00.000Z",
  dataQuality: "complete" as const,
};

describe("GameState v2 persistence contracts", () => {
  it("migrates a persisted v1 state and removes private decision summaries", () => {
    const initial = createInitialGameState("legacy-save");
    const legacySave = {
      ...initial,
      version: 1,
      characters: {
        haru: {
          state: initial.characters.haru.state,
          internalSummary: "HARU_RECORD_PRIVATE_MARKER",
          lastDecision: {
            ...publicDecision,
            internalSummary: "HARU_DECISION_PRIVATE_MARKER",
            expectedEffects: { trust: 3 },
          },
        },
        aoi: {
          state: initial.characters.aoi.state,
          internalSummary: "AOI_RECORD_PRIVATE_MARKER",
          lastDecision: {
            decision: "ACCEPT",
            action: "隣で話を聞く",
            dialogue: "ゆっくりで大丈夫。",
            publicReason: "相手のペースを大切にしたいから",
            internalSummary: "AOI_DECISION_PRIVATE_MARKER",
            expectedEffects: { trust: 3 },
          },
        },
      },
    };

    const migrated = gameStateSchema.parse(JSON.parse(JSON.stringify(legacySave)));
    const persistedAgain = JSON.stringify(migrated);

    expect(migrated.version).toBe(2);
    expect(migrated.characters.haru.lastDecision).toEqual(publicDecision);
    for (const privateMarker of [
      "HARU_RECORD_PRIVATE_MARKER",
      "HARU_DECISION_PRIVATE_MARKER",
      "AOI_RECORD_PRIVATE_MARKER",
      "AOI_DECISION_PRIVATE_MARKER",
      "internalSummary",
      "expectedEffects",
    ]) {
      expect(persistedAgain).not.toContain(privateMarker);
    }
  });

  it("accepts the complete structured event log contract and rejects private decision data", () => {
    const parsed = eventLogEntrySchema.parse(structuredEvent);

    expect(parsed).toMatchObject({
      turnId: "turn-day1-morning",
      cueOutcome: "selected",
      resolutionBranch: "modified",
      decisions: { haru: publicDecision },
      before: { shared: { relationshipLabel: "friends" } },
      after: { characters: { haru: { trust: 51 } } },
      appliedEffects: { haru: { trust: 3 }, aoi: { trust: 3 } },
      navigatorMessage: navigatorResponse.message,
      navigatorResponse,
      runtimeSources: {
        haru: "app_server",
        aoi: "app_server",
        navigator: "app_server",
        director: "app_server",
      },
    });

    const unsafeEvent = structuredClone(structuredEvent) as typeof structuredEvent & {
      decisions: typeof structuredEvent.decisions & {
        haru: typeof publicDecision & { internalSummary: string };
      };
    };
    unsafeEvent.decisions.haru.internalSummary = "DO_NOT_PERSIST";

    expect(eventLogEntrySchema.safeParse(unsafeEvent).success).toBe(false);
  });

  it("round-trips a ready GameResult with article, highlights, and both reflections", () => {
    const parsedResult = gameResultSchema.parse(readyResult);
    const initial = createInitialGameState("result-save");
    const parsedState = gameStateSchema.parse({
      ...initial,
      revision: 28,
      status: "ended",
      shared: { ...initial.shared, day: 7, phase: "night" },
      navigator: navigatorResponse,
      eventLog: [structuredEvent],
      ending,
      result: parsedResult,
    });

    expect(parsedResult.status).toBe("ready");
    if (parsedResult.status !== "ready") throw new Error("expected ready result");
    expect(parsedResult.narrative.daySections).toHaveLength(7);
    expect(parsedResult.producer.highlights[0]?.eventLogIds).toEqual([structuredEvent.id]);
    expect(parsedResult.reflections.haru.notableEventComments[0]?.eventLogId).toBe(structuredEvent.id);
    expect(parsedResult.reflections.aoi.characterId).toBe("aoi");
    expect(parsedState.result).toEqual(parsedResult);
    expect(parsedState.navigator).toEqual(navigatorResponse);
    expect(parsedState.eventLog[0]?.navigatorResponse).toEqual(navigatorResponse);
    expect(parsedState.eventLog[0]?.runtimeSources?.navigator).toBe("app_server");
    expect(JSON.stringify(parsedState)).not.toContain("internalSummary");
  });

  it("keeps GameResult status variants strict", () => {
    const missingReflections = structuredClone(readyResult) as Omit<typeof readyResult, "reflections"> & {
      reflections?: typeof readyResult.reflections;
    };
    delete missingReflections.reflections;

    expect(gameResultSchema.safeParse(missingReflections).success).toBe(false);
    expect(
      gameResultSchema.safeParse({
        ...readyResult,
        status: "generating",
        startedAt: "2026-07-18T00:00:30.000Z",
      }).success,
    ).toBe(false);
  });
});
