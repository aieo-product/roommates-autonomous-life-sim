import type {
  ResultCharacterId,
  ResultDecisionKind,
  ResultEventLogEntry,
  ResultMetricKey,
  ResultPhase,
  ResultProducer,
  ResultRelationshipLabel,
} from "./types";

export const CHARACTER_NAMES: Record<ResultCharacterId, string> = {
  haru: "Haru",
  aoi: "Aoi",
};

export const PHASE_LABELS: Record<ResultPhase, string> = {
  morning: "朝",
  afternoon: "昼",
  evening: "夕方",
  night: "夜",
};

export const DECISION_LABELS: Record<ResultDecisionKind, string> = {
  ACCEPT: "受け入れた",
  DECLINE: "断った",
  MODIFY: "形を変えた",
  IGNORE: "別のことを選んだ",
  INITIATE: "自分から動いた",
};

export const RELATIONSHIP_LABELS: Record<ResultRelationshipLabel, string> = {
  strangers: "まだ他人",
  roommates: "ルームメイト",
  friends: "友だち",
  close_friends: "親しい友だち",
  romantic_tension: "恋の予感",
  couple: "恋人",
  broken: "それぞれの道",
};

export const AXIS_LABELS: Record<ResultProducer["axes"][number]["id"], string> = {
  agency: "主体性の尊重",
  wellbeing: "心理安全・コンディション",
  care: "関係へのケア",
  pacing: "ペーシング",
  story: "物語の豊かさ",
};

export const STYLE_LABELS: Record<string, string> = {
  space_maker: "余白をつくる人",
  condition_reader: "コンディションを読む人",
  relationship_mender: "関係を繕う人",
  pace_designer: "歩幅を整える人",
  turning_point_editor: "転機を編む人",
};

export const METRIC_LABELS: Record<ResultMetricKey, string> = {
  energy: "元気",
  stress: "ストレス",
  affection: "親しさ",
  trust: "信頼",
  romanticAwareness: "恋愛意識",
};

const safeAnchorPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, "-");

export const eventAnchorId = (eventId: string): string =>
  `result-event-${safeAnchorPart(eventId)}`;

export const formatEventLocation = (event: Pick<ResultEventLogEntry, "day" | "phase">): string =>
  `Day ${event.day}・${PHASE_LABELS[event.phase]}`;

export const decisionFor = (event: ResultEventLogEntry, person: ResultCharacterId) => {
  const structured = event.decisions?.[person];
  if (structured) return structured;

  const title = person === "haru" ? "haru" : "aoi";
  const decision = event[`${title}Decision`];
  if (!decision) return undefined;

  return {
    decision,
    action: event[`${title}Action`] ?? "行動の記録なし",
    dialogue: event[`${title}Dialogue`],
    publicReason: event[`${title}PublicReason`],
  };
};

export const safetyFlagsFor = (event: ResultEventLogEntry): string[] =>
  event.cueResolution?.cue?.safetyFlags ?? event.cueSafetyFlags ?? [];

export const suggestionFor = (event: ResultEventLogEntry): string =>
  event.cueResolution?.cue?.text ?? event.suggestion ?? "見守る選択";

export const selectedEventTitleFor = (event: ResultEventLogEntry): string =>
  event.cueResolution?.selectedEvent?.title ?? event.eventTitle;

export const metricDeltaLabel = (value: number): string =>
  value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;

export const clampPercent = (value: number, max: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
};
