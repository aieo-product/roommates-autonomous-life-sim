import type {
  ResultDecisionKind,
  ResultEventLogEntry,
  ResultPhase,
  ResultScreenGame,
} from "./types";

const PHASES: ResultPhase[] = ["morning", "afternoon", "evening", "night"];
const PHASE_COPY: Record<ResultPhase, { title: string; suggestion: string }> = {
  morning: { title: "同じ家の朝", suggestion: "朝の時間を、二人のペースで始めてみたら？" },
  afternoon: { title: "それぞれの午後", suggestion: "無理に合わせず、気が向いたら声をかけてみて" },
  evening: { title: "食卓を囲むまで", suggestion: "今夜のごはんを一緒に考えてみたら？" },
  night: { title: "灯りを落とす前に", suggestion: "今日あったことを少しだけ話してみて" },
};

const SCENE_BY_PHASE: Record<ResultPhase, { haru: string; aoi: string }> = {
  morning: { haru: "キッチン", aoi: "ダイニング" },
  afternoon: { haru: "Haruの自室", aoi: "Aoiの自室" },
  evening: { haru: "ダイニング", aoi: "ダイニング" },
  night: { haru: "リビング", aoi: "リビング" },
};

const eventId = (day: number, phase: ResultPhase) => `preview-${day}-${phase}`;
const relationshipFor = (day: number) =>
  day <= 2 ? "roommates" as const : day <= 4 ? "friends" as const : day <= 6 ? "close_friends" as const : "romantic_tension" as const;

const specialEvents: Record<string, Partial<ResultEventLogEntry>> = {
  [eventId(1, "evening")]: {
    eventTitle: "少し不格好な共同料理",
    narration: "慣れない台所で役割を分け、焦げた玉ねぎまで笑い話に変わった。",
    suggestion: "最初の夕食を一緒に作ってみたら？",
    haruDecision: "ACCEPT",
    aoiDecision: "MODIFY",
    haruAction: "玉ねぎを切り、片付けまで引き受ける",
    aoiAction: "得意な味付けを担当する",
    haruDialogue: "切るほうは任せて。味見、お願いしていい？",
    aoiDialogue: "うん。ちょっと焦げても、最初の記念ってことで。",
    scene: { haru: "キッチン", aoi: "キッチン" },
    memory: { id: "memory-first-dinner", title: "最初の共同料理", summary: "失敗ごと楽しめた最初の夕食", emotionalImpact: 6, importance: 8 },
  },
  [eventId(3, "night")]: {
    eventTitle: "大切にされた「今日は休みたい」",
    narration: "Haruの断りをAoiは急かさず受け止め、同じ家で別々の静かな夜を選んだ。",
    suggestion: "夜更かしして映画を見てみたら？",
    haruDecision: "DECLINE",
    aoiDecision: "MODIFY",
    haruAction: "自室で早めに休む",
    aoiAction: "誘いを取り下げ、リビングで静かに過ごす",
    haruDialogue: "ごめん、今日は少し休みたい。",
    aoiDialogue: "もちろん。また見たい日に一緒に見よう。",
    haruPublicReason: "疲れを無視したくなかったから",
    aoiPublicReason: "断れる関係のほうが安心できるから",
    scene: { haru: "Haruの自室", aoi: "リビング" },
    resolutionBranch: "one_participated",
    memory: { id: "memory-respected-no", title: "大切にされたNO", summary: "断ることが距離ではなく信頼になった夜", emotionalImpact: 7, importance: 9 },
  },
  [eventId(5, "evening")]: {
    eventTitle: "すれ違いのあとで",
    narration: "言葉の足りなかった昨日を振り返り、二人は責めずに次の約束を決めた。",
    suggestion: "昨日のすれ違いについて話してみたら？",
    haruDecision: "INITIATE",
    aoiDecision: "ACCEPT",
    haruAction: "自分から謝り、次は先に相談すると伝える",
    aoiAction: "困っていた理由を話し、謝罪を受け取る",
    haruDialogue: "昨日は決めつけてごめん。次は先に聞くよ。",
    aoiDialogue: "私も黙りすぎた。話してくれてありがとう。",
    haruPublicReason: "このまま曖昧にしたくなかったから",
    aoiPublicReason: "関係を直す話なら向き合いたかったから",
    scene: { haru: "リビング", aoi: "リビング" },
    resolutionBranch: "self_initiated",
    conflictUpdate: { resolve: ["言葉の足りないすれ違い"] },
    memory: { id: "memory-repair", title: "ほどけた結び目", summary: "互いの言葉で小さな対立を解いた", emotionalImpact: 8, importance: 9 },
  },
  [eventId(7, "night")]: {
    eventTitle: "二人から始まった告白",
    narration: "Producerに急かされることなく、二人はそれぞれの意志でこれからも隣にいたいと伝えた。",
    suggestion: "今夜は何も提案せず、二人を見守る",
    haruDecision: "INITIATE",
    aoiDecision: "INITIATE",
    haruAction: "自分の言葉で、一緒にいたい気持ちを伝える",
    aoiAction: "自分から手を取り、同じ気持ちだと返す",
    haruDialogue: "この一週間だけじゃなくて、これからも隣にいてほしい。",
    aoiDialogue: "私も。次の朝も、その先も一緒がいい。",
    haruPublicReason: "自分で選んだ気持ちを伝えたかったから",
    aoiPublicReason: "待つのではなく、自分から応えたかったから",
    scene: { haru: "リビング", aoi: "リビング" },
    resolutionBranch: "self_initiated",
    relationshipBefore: "romantic_tension",
    relationshipAfter: "couple",
    memory: { id: "memory-confession", title: "二人が選んだこれから", summary: "それぞれの意志が同じ未来を選んだ", emotionalImpact: 10, importance: 10 },
  },
};

const decisionFor = (day: number, phaseIndex: number): ResultDecisionKind => {
  const choices: ResultDecisionKind[] = ["ACCEPT", "MODIFY", "IGNORE", "ACCEPT", "INITIATE"];
  return choices[(day + phaseIndex) % choices.length]!;
};

const events: ResultEventLogEntry[] = Array.from({ length: 7 }, (_, dayIndex) => dayIndex + 1)
  .flatMap((day) => PHASES.map((phase, phaseIndex) => {
    const id = eventId(day, phase);
    const baseDecision = decisionFor(day, phaseIndex);
    const beforeRelationship = relationshipFor(day);
    const afterRelationship = day === 7 && phase === "night" ? "couple" : beforeRelationship;
    const base: ResultEventLogEntry = {
      id,
      day,
      phase,
      eventTitle: PHASE_COPY[phase].title,
      narration: `Day ${day}の${PHASE_COPY[phase].title}。二人は提案を命令ではなく、選べるきっかけとして受け取った。`,
      suggestion: PHASE_COPY[phase].suggestion,
      haruDecision: baseDecision,
      aoiDecision: phaseIndex % 2 === 0 ? "MODIFY" : baseDecision,
      haruAction: phase === "morning" ? "コーヒーを淹れて、自分から声をかける" : "自分のペースを伝えながら時間を共有する",
      aoiAction: phase === "evening" ? "食卓を整え、できる役割を選ぶ" : "無理のない形を提案する",
      haruDialogue: day % 2 === 0 ? "今日はどんなふうに過ごしたい？" : "無理のないところから、一緒にやろうか。",
      aoiDialogue: day % 2 === 0 ? "聞いてくれてうれしい。少しだけ一緒にいよう。" : "うん、そのくらいなら楽しめそう。",
      haruPublicReason: "相手の気持ちを確認してから動きたかったから",
      aoiPublicReason: "自分の余力に合う形なら選べたから",
      scene: SCENE_BY_PHASE[phase],
      resolutionBranch: baseDecision === "INITIATE" ? "self_initiated" : baseDecision === "MODIFY" ? "modified" : "both_participated",
      relationshipBefore: beforeRelationship,
      relationshipAfter: afterRelationship,
      appliedEffects: {
        haru: { energy: phase === "night" ? -3 : -1, stress: -2, affection: 2, trust: 2, romanticAwareness: day > 4 ? 1 : 0 },
        aoi: { energy: phase === "night" ? -2 : -1, stress: -2, affection: 2, trust: 2, romanticAwareness: day > 4 ? 1 : 0 },
      },
      cueResolution: {
        cue: { text: PHASE_COPY[phase].suggestion, safetyFlags: [], transformed: false },
        selectedEvent: { id: `event-${day}-${phase}`, title: PHASE_COPY[phase].title },
        outcome: "selected",
      },
      before: {
        characters: {
          haru: { energy: 76 - day * 2, stress: 24 - day, affection: 18 + day * 8, trust: 25 + day * 8, romanticAwareness: 4 + day * 6 },
          aoi: { energy: 72 - day, stress: 28 - day * 2, affection: 20 + day * 8, trust: 27 + day * 8, romanticAwareness: 5 + day * 6 },
        },
        shared: { relationshipLabel: beforeRelationship },
      },
      after: {
        characters: {
          haru: { energy: 74 - day * 2, stress: 22 - day, affection: 21 + day * 8, trust: 28 + day * 8, romanticAwareness: 5 + day * 6 },
          aoi: { energy: 70 - day, stress: 26 - day * 2, affection: 23 + day * 8, trust: 30 + day * 8, romanticAwareness: 6 + day * 6 },
        },
        shared: { relationshipLabel: afterRelationship },
      },
      ...specialEvents[id],
    };
    return {
      ...base,
      cueResolution: {
        ...base.cueResolution,
        cue: {
          ...base.cueResolution?.cue,
          text: base.suggestion,
        },
        selectedEvent: {
          ...base.cueResolution?.selectedEvent,
          title: base.eventTitle,
        },
        outcome: base.cueResolution?.outcome ?? "selected",
      },
    };
  }));

const narrativeDays = [
  ["違う歩幅で始まった朝", "緊張を抱えたまま始まった共同生活。最初の夕食で、失敗を笑える空気が生まれた。", eventId(1, "evening")],
  ["一緒にいない時間も、共同生活", "予定を合わせるだけでなく、それぞれの集中を邪魔しない距離を覚えていった。", eventId(2, "afternoon")],
  ["断っても消えなかった灯り", "疲れた夜のNOを尊重したことで、二人の間に安心して本音を言える余白ができた。", eventId(3, "night")],
  ["習慣になっていく気づかい", "コーヒーの好みや帰宅の音。小さな観察が、言葉より先に相手を支え始めた。", eventId(4, "morning")],
  ["すれ違いを物語の途中にする", "うまくいかなかった出来事を終わりにせず、自分から話し直す選択が関係を前へ進めた。", eventId(5, "evening")],
  ["提案がなくても生まれる時間", "二人から誘いや相談が増え、Producerはきっかけを置かず見守る場面が増えていった。", eventId(6, "night")],
  ["二人が選んだ、次の朝", "最後の夜、二人は誰かに言わされたのではない言葉で、同じ未来を選んだ。", eventId(7, "night")],
] as const;

export const RESULT_PREVIEW_GAME: ResultScreenGame = {
  status: "ended",
  shared: { relationshipLabel: "couple" },
  ending: {
    kind: "couple",
    title: "ふたりは、次の朝も一緒にいる。",
    narration: "近づく日も、一人で休む日も大切にした七日間。その積み重ねを経て、HaruとAoiは自分たちの意志で恋人になることを選びました。",
  },
  eventLog: events,
  result: {
    status: "ready",
    ending: {
      kind: "couple",
      title: "ふたりは、次の朝も一緒にいる。",
      narration: "近づく日も、一人で休む日も大切にした七日間。その積み重ねを経て、HaruとAoiは自分たちの意志で恋人になることを選びました。",
    },
    producer: {
      overallScore: 84,
      rank: "A",
      producerStyle: "space_maker",
      scoringVersion: "producer-score-v1",
      axes: [
        { id: "agency", score: 23, maxScore: 25, summary: "二人が断る・変える・自分から動く余地を守りました。" },
        { id: "wellbeing", score: 18, maxScore: 20, summary: "疲れやストレスを無視せず、休める選択を残しました。" },
        { id: "care", score: 17, maxScore: 20, summary: "対立のあとに修復のきっかけを置けました。" },
        { id: "pacing", score: 14, maxScore: 15, summary: "急な親密化を避け、七日間の歩幅を整えました。" },
        { id: "story", score: 12, maxScore: 20, summary: "静かな時間と転機の両方が残る物語になりました。" },
      ],
      topStrengths: [
        { id: "evidence-no", ruleId: "respect-no", points: 8, message: "Day 3のNOを尊重し、心理的な安全を守りました。", eventLogIds: [eventId(3, "night")] },
        { id: "evidence-repair", ruleId: "repair", points: 7, message: "すれ違いを強制せず、話し直せるきっかけを作りました。", eventLogIds: [eventId(5, "evening")] },
      ],
      improvements: [
        { id: "evidence-variety", ruleId: "variety", points: -3, message: "食事に関する提案が少し多めでした。次は二人の自発的な予定をさらに見守れます。", eventLogIds: [eventId(2, "evening"), eventId(4, "evening")] },
      ],
      highlights: [
        { id: "highlight-dinner", kind: "important_memory", headline: "失敗を笑えた最初の食卓", reason: "二人が初めて役割を相談し、共同生活の手応えを得た出来事です。", eventLogIds: [eventId(1, "evening")], memoryId: "memory-first-dinner" },
        { id: "highlight-no", kind: "respected_no", headline: "断っても近くにいられた夜", reason: "親密さよりも本人のコンディションを優先し、信頼へつながりました。", eventLogIds: [eventId(3, "night")], memoryId: "memory-respected-no" },
        { id: "highlight-repair", kind: "conflict_repaired", headline: "二人の言葉でほどいた結び目", reason: "Producerの指示どおりではなく、それぞれの言葉で関係を修復しました。", eventLogIds: [eventId(5, "evening")], memoryId: "memory-repair" },
        { id: "highlight-ending", kind: "self_initiated", headline: "誰にも急かされなかった告白", reason: "最後の選択は二人から始まり、互いの主体性が同じ未来を向きました。", eventLogIds: [eventId(7, "night")], memoryId: "memory-confession" },
      ],
      keyMemoryIds: ["memory-first-dinner", "memory-respected-no", "memory-repair", "memory-confession"],
      turningPointEventLogIds: [eventId(3, "night"), eventId(5, "evening"), eventId(7, "night")],
      statJourney: {
        start: { characters: { haru: { energy: 70, stress: 25, affection: 20, trust: 30, romanticAwareness: 5 }, aoi: { energy: 65, stress: 30, affection: 20, trust: 30, romanticAwareness: 5 } } },
        end: { characters: { haru: { energy: 58, stress: 9, affection: 88, trust: 92, romanticAwareness: 76 }, aoi: { energy: 61, stress: 8, affection: 91, trust: 94, romanticAwareness: 81 } } },
      },
      coverage: { ratio: 1, completeTurns: 28, expectedTurns: 28, missing: [] },
      warnings: [],
    },
    narrative: {
      headline: "余白が、ふたりの距離を近づけた",
      lead: [{ text: "Producerがしたのは、二人を動かすことではなく、選べるきっかけを置くことでした。断る自由と話し直す時間が、七日間を二人自身の物語に変えていきます。", sourceEventLogIds: [eventId(1, "evening"), eventId(3, "night"), eventId(5, "evening")] }],
      daySections: narrativeDays.map(([title, text, source], index) => ({ day: index + 1, title, paragraphs: [{ text, sourceEventLogIds: [source] }], featuredEventLogId: source })),
      closing: [{ text: "恋人という結末はスコアのご褒美ではありません。二人が自分の意志を何度も確かめた先に、自然に選ばれた次の一歩でした。", sourceEventLogIds: [eventId(7, "night")] }],
      narrativeVersion: "result-narrative-v1",
    },
    reflections: {
      haru: {
        characterId: "haru",
        seasonImpression: "何かを一緒にするより、断っても大丈夫だと思えた夜から、Aoiの隣が落ち着く場所になった気がする。",
        notableEventComments: [
          { eventLogId: eventId(1, "evening"), comment: "焦げた玉ねぎまで一緒に笑えたとき、この家で肩の力を抜いてもいいんだと思えた。" },
          { eventLogId: eventId(3, "night"), comment: "休みたいと言えたことと、それを普通に受け止めてもらえたことが一番うれしかった。" },
          { eventLogId: eventId(5, "evening"), comment: "謝るのは怖かったけれど、Aoiが理由を話してくれて、ちゃんと向き合えていると感じた。" },
          { eventLogId: eventId(7, "night"), comment: "最後は自分から言いたかった。待たずに伝えられてよかった。" },
        ],
        bestMomentEventLogId: eventId(7, "night"),
        turningPointEventLogId: eventId(3, "night"),
        messageToProducer: "答えを決めずに、話すきっかけだけをくれてありがとう。",
        reflectionVersion: "reflection-v1",
      },
      aoi: {
        characterId: "aoi",
        seasonImpression: "二人でいることと、自分のペースを守ることが両立するって分かった一週間だった。",
        notableEventComments: [
          { eventLogId: eventId(1, "evening"), comment: "得意なことを分け合ったら、失敗した夕食まで二人らしい思い出になった。" },
          { eventLogId: eventId(3, "night"), comment: "Haruが休みたいと言ってくれたから、断っても大丈夫な家にしたいって素直に思えた。" },
          { eventLogId: eventId(5, "evening"), comment: "きれいに仲直りするより、本当の理由を話せたことが大切だった。" },
          { eventLogId: eventId(7, "night"), comment: "あの言葉は、提案されたからじゃなくて私が言いたかったから言った。" },
        ],
        bestMomentEventLogId: eventId(1, "evening"),
        turningPointEventLogId: eventId(5, "evening"),
        messageToProducer: "静かに見守ってくれた時間が、いちばん効いていたと思う。",
        reflectionVersion: "reflection-v1",
      },
    },
    generatedAt: "2026-07-18T07:00:00.000Z",
    dataQuality: "complete",
  },
};
