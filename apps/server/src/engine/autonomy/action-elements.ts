import type {
  AutonomousActionCandidate,
  AutonomousInvitation,
  AutonomousParticipantMode,
  CharacterId,
  EventCategory,
  GameState,
  MutableStatKey,
  Phase,
} from "@roommates/shared";
import { phases } from "@roommates/shared";

export const AUTONOMOUS_ACTION_MAX_CANDIDATES = 6;

type EffectBudget = Record<MutableStatKey, number>;

export type ActionPlaceElement = {
  id: string;
  label: string;
  location: string;
  publicHint: string;
  allowedPhases: readonly Phase[];
};

export const ACTION_PLACE_ELEMENTS = [
  {
    id: "living-room",
    label: "リビング",
    location: "リビング",
    publicHint: "共有のリビングで行う。",
    allowedPhases: ["morning", "afternoon", "evening", "night"],
  },
  {
    id: "dining-table",
    label: "ダイニングテーブル",
    location: "ダイニング",
    publicHint: "空いているダイニングテーブルを使う。",
    allowedPhases: ["morning", "afternoon", "evening", "night"],
  },
  {
    id: "kitchen-counter",
    label: "キッチンカウンター",
    location: "キッチン",
    publicHint: "いつものキッチン用品だけを使う。",
    allowedPhases: ["morning", "afternoon", "evening", "night"],
  },
  {
    id: "window-seat",
    label: "窓辺",
    location: "リビングの窓辺",
    publicHint: "室内の静かな窓辺を選ぶ。",
    allowedPhases: ["morning", "afternoon", "evening"],
  },
  {
    id: "work-desk",
    label: "作業机",
    location: "作業机",
    publicHint: "自分が普段使う机の範囲で行う。",
    allowedPhases: ["morning", "afternoon", "evening", "night"],
  },
  {
    id: "laundry-corner",
    label: "洗濯スペース",
    location: "洗濯スペース",
    publicHint: "共有のタオルだけを扱う。",
    allowedPhases: ["morning", "afternoon", "evening"],
  },
] as const satisfies readonly ActionPlaceElement[];

type ActionPlaceId = (typeof ACTION_PLACE_ELEMENTS)[number]["id"];

export type ActionPaceElement = {
  id: string;
  label: string;
  durationMinutes: number;
  energyCost: number;
  additionalMinEnergy: number;
  effectScale: number;
  lightweight: boolean;
  publicHint: string;
};

export const ACTION_PACE_ELEMENTS = [
  {
    id: "micro",
    label: "ほんの少し",
    durationMinutes: 5,
    energyCost: 0,
    additionalMinEnergy: 0,
    effectScale: 0.5,
    lightweight: true,
    publicHint: "5分で区切り、途中でやめてもよい。",
  },
  {
    id: "short",
    label: "短め",
    durationMinutes: 10,
    energyCost: 2,
    additionalMinEnergy: 2,
    effectScale: 0.75,
    lightweight: true,
    publicHint: "10分を目安に短く行う。",
  },
  {
    id: "steady",
    label: "いつものペース",
    durationMinutes: 20,
    energyCost: 5,
    additionalMinEnergy: 8,
    effectScale: 1,
    lightweight: false,
    publicHint: "20分を上限に、普段のペースで行う。",
  },
  {
    id: "unhurried",
    label: "ゆったり",
    durationMinutes: 30,
    energyCost: 7,
    additionalMinEnergy: 12,
    effectScale: 1,
    lightweight: false,
    publicHint: "余裕がある間だけ、ゆったり行う。",
  },
] as const satisfies readonly ActionPaceElement[];

type ActionPaceId = (typeof ACTION_PACE_ELEMENTS)[number]["id"];

export type ActionInvitationElement = {
  id: string;
  label: string;
  participantModes: readonly AutonomousParticipantMode[];
  invitationOptions: readonly AutonomousInvitation[];
  publicHint: string;
};

export const ACTION_INVITATION_ELEMENTS = [
  {
    id: "self-start",
    label: "自分から始める",
    participantModes: ["solo", "optional_companion"],
    invitationOptions: ["solo"],
    publicHint: "まず自分だけで始める。",
  },
  {
    id: "open-invite",
    label: "一度だけ声をかける",
    participantModes: ["optional_companion", "shared_opt_in"],
    invitationOptions: ["open"],
    publicHint: "参加しなくてもよいと添えて、一度だけ声をかける。",
  },
  {
    id: "parallel-invite",
    label: "別々でも一緒でもよい",
    participantModes: ["optional_companion", "shared_opt_in"],
    invitationOptions: ["solo", "open"],
    publicHint: "同じことでも別のことでもよい形で声をかける。",
  },
  {
    id: "choice-first",
    label: "相手が選べる形にする",
    participantModes: ["shared_opt_in"],
    invitationOptions: ["open"],
    publicHint: "内容と時間を相手が変えられる形で声をかける。",
  },
  {
    id: "quiet-company",
    label: "会話なしでもよい",
    participantModes: ["optional_companion", "shared_opt_in"],
    invitationOptions: ["solo", "open"],
    publicHint: "会話せず同じ場所にいるだけでもよいと伝える。",
  },
] as const satisfies readonly ActionInvitationElement[];

type ActivityRequirements = {
  minEnergy: number;
  maxStress: number;
  minTrust?: number;
  requiresSharedMemory?: boolean;
  requiresConflict?: boolean;
};

export type AutonomousActivityElement = {
  id: string;
  title: string;
  eventDefinitionId: string;
  category: EventCategory;
  intimacyTier: 0 | 1 | 2 | 3;
  publicIntent: string;
  participantMode: AutonomousParticipantMode;
  allowedPhases: readonly Phase[];
  placeIds: readonly ActionPlaceId[];
  paceIds: readonly ActionPaceId[];
  requirements: ActivityRequirements;
  effectBudget: EffectBudget;
};

function effectBudget(
  energy: number,
  stress: number,
  affection: number,
  trust: number,
  romanticAwareness: number,
): EffectBudget {
  return { energy, stress, affection, trust, romanticAwareness };
}

const ALL_PHASES = ["morning", "afternoon", "evening", "night"] as const;
const DAYTIME = ["morning", "afternoon", "evening"] as const;
const LATER = ["afternoon", "evening", "night"] as const;

/**
 * Server-authored building blocks only. They contain no free text supplied by
 * an agent and deliberately stay within ordinary, low-cost household actions.
 */
export const AUTONOMOUS_ACTIVITY_ELEMENTS = [
  {
    id: "reset-breath",
    title: "ひと息つく",
    eventDefinitionId: "observe-rest",
    category: "rest",
    intimacyTier: 0,
    publicIntent: "姿勢を整えて、短くひと息つく。",
    participantMode: "solo",
    allowedPhases: ALL_PHASES,
    placeIds: ["living-room", "window-seat", "work-desk"],
    paceIds: ["micro", "short"],
    requirements: { minEnergy: 0, maxStress: 100 },
    effectBudget: effectBudget(5, 5, 0, 0, 0),
  },
  {
    id: "quiet-reading",
    title: "静かに読む",
    eventDefinitionId: "observe-rest",
    category: "rest",
    intimacyTier: 0,
    publicIntent: "手元にある読み物を静かに読む。",
    participantMode: "solo",
    allowedPhases: ALL_PHASES,
    placeIds: ["living-room", "window-seat", "work-desk"],
    paceIds: ["micro", "short", "steady"],
    requirements: { minEnergy: 0, maxStress: 100 },
    effectBudget: effectBudget(4, 5, 0, 0, 0),
  },
  {
    id: "water-refill",
    title: "飲み物を補充する",
    eventDefinitionId: "observe-rest",
    category: "rest",
    intimacyTier: 0,
    publicIntent: "水やいつもの飲み物を用意する。",
    participantMode: "optional_companion",
    allowedPhases: ALL_PHASES,
    placeIds: ["kitchen-counter", "dining-table"],
    paceIds: ["micro", "short"],
    requirements: { minEnergy: 0, maxStress: 100 },
    effectBudget: effectBudget(4, 3, 1, 1, 0),
  },
  {
    id: "one-song-break",
    title: "一曲だけ聴く",
    eventDefinitionId: "movie-night",
    category: "movie",
    intimacyTier: 0,
    publicIntent: "手元の音楽から一曲だけ選んで聴く。",
    participantMode: "optional_companion",
    allowedPhases: ALL_PHASES,
    placeIds: ["living-room", "work-desk"],
    paceIds: ["micro", "short"],
    requirements: { minEnergy: 0, maxStress: 100 },
    effectBudget: effectBudget(3, 5, 2, 1, 0),
  },
  {
    id: "warm-drink",
    title: "温かい飲み物を作る",
    eventDefinitionId: "shared-cooking",
    category: "cook",
    intimacyTier: 0,
    publicIntent: "家にある材料で温かい飲み物を一杯作る。",
    participantMode: "optional_companion",
    allowedPhases: ALL_PHASES,
    placeIds: ["kitchen-counter", "dining-table"],
    paceIds: ["micro", "short"],
    requirements: { minEnergy: 5, maxStress: 95 },
    effectBudget: effectBudget(4, 5, 2, 2, 0),
  },
  {
    id: "wipe-table",
    title: "テーブルをひと区画整える",
    eventDefinitionId: "shared-cleaning",
    category: "clean",
    intimacyTier: 0,
    publicIntent: "共有テーブルの見えている一区画だけを整える。",
    participantMode: "optional_companion",
    allowedPhases: DAYTIME,
    placeIds: ["dining-table", "living-room"],
    paceIds: ["micro", "short"],
    requirements: { minEnergy: 5, maxStress: 95 },
    effectBudget: effectBudget(3, 4, 1, 3, 0),
  },
  {
    id: "fold-towels",
    title: "共有タオルをたたむ",
    eventDefinitionId: "shared-cleaning",
    category: "clean",
    intimacyTier: 0,
    publicIntent: "洗い上がった共有タオルだけをたたむ。",
    participantMode: "optional_companion",
    allowedPhases: DAYTIME,
    placeIds: ["laundry-corner", "living-room"],
    paceIds: ["short", "steady"],
    requirements: { minEnergy: 8, maxStress: 92 },
    effectBudget: effectBudget(4, 4, 2, 4, 0),
  },
  {
    id: "plant-care",
    title: "植物の様子を見る",
    eventDefinitionId: "shared-cleaning",
    category: "clean",
    intimacyTier: 0,
    publicIntent: "共有スペースの植物を見て、必要なら少量の水を足す。",
    participantMode: "optional_companion",
    allowedPhases: DAYTIME,
    placeIds: ["window-seat", "living-room"],
    paceIds: ["micro", "short"],
    requirements: { minEnergy: 5, maxStress: 95 },
    effectBudget: effectBudget(3, 4, 2, 3, 0),
  },
  {
    id: "kind-note",
    title: "小さなメモを残す",
    eventDefinitionId: "small-gift",
    category: "gift",
    intimacyTier: 1,
    publicIntent: "日常への短いお礼をメモにして共有場所へ置く。",
    participantMode: "optional_companion",
    allowedPhases: ALL_PHASES,
    placeIds: ["dining-table", "work-desk"],
    paceIds: ["micro", "short"],
    requirements: { minEnergy: 5, maxStress: 95 },
    effectBudget: effectBudget(1, 2, 4, 4, 1),
  },
  {
    id: "simple-snack",
    title: "簡単なおやつを選ぶ",
    eventDefinitionId: "shared-cooking",
    category: "cook",
    intimacyTier: 1,
    publicIntent: "家にあるものから簡単なおやつを選ぶ。",
    participantMode: "shared_opt_in",
    allowedPhases: DAYTIME,
    placeIds: ["kitchen-counter", "dining-table"],
    paceIds: ["short", "steady"],
    requirements: { minEnergy: 12, maxStress: 90 },
    effectBudget: effectBudget(3, 4, 5, 4, 2),
  },
  {
    id: "ingredient-sort",
    title: "食材を一つ整理する",
    eventDefinitionId: "shared-cooking",
    category: "cook",
    intimacyTier: 0,
    publicIntent: "次に使いやすいよう、共有の食材を一種類だけ整理する。",
    participantMode: "optional_companion",
    allowedPhases: DAYTIME,
    placeIds: ["kitchen-counter"],
    paceIds: ["micro", "short"],
    requirements: { minEnergy: 7, maxStress: 92 },
    effectBudget: effectBudget(2, 3, 2, 4, 0),
  },
  {
    id: "mini-screening",
    title: "短い作品を見る",
    eventDefinitionId: "movie-night",
    category: "movie",
    intimacyTier: 1,
    publicIntent: "お互いに避けたい題材を確認して、短い作品を見る。",
    participantMode: "shared_opt_in",
    allowedPhases: LATER,
    placeIds: ["living-room"],
    paceIds: ["short", "steady"],
    requirements: { minEnergy: 10, maxStress: 90 },
    effectBudget: effectBudget(3, 6, 5, 4, 3),
  },
  {
    id: "puzzle-round",
    title: "パズルを一問だけ解く",
    eventDefinitionId: "movie-night",
    category: "movie",
    intimacyTier: 1,
    publicIntent: "手元にあるパズルを一問だけ試す。",
    participantMode: "optional_companion",
    allowedPhases: ["afternoon", "evening"],
    placeIds: ["dining-table", "living-room"],
    paceIds: ["short", "steady"],
    requirements: { minEnergy: 12, maxStress: 88 },
    effectBudget: effectBudget(2, 4, 4, 4, 1),
  },
  {
    id: "parallel-sketch",
    title: "同じ場所で自由に描く",
    eventDefinitionId: "gentle-conversation",
    category: "talk",
    intimacyTier: 1,
    publicIntent: "見せ合うかは後で決め、各自が自由に小さく描く。",
    participantMode: "optional_companion",
    allowedPhases: ["afternoon", "evening"],
    placeIds: ["dining-table", "work-desk"],
    paceIds: ["short", "steady", "unhurried"],
    requirements: { minEnergy: 10, maxStress: 90 },
    effectBudget: effectBudget(2, 5, 4, 4, 2),
  },
  {
    id: "hobby-share",
    title: "最近の趣味を一つ紹介する",
    eventDefinitionId: "gentle-conversation",
    category: "talk",
    intimacyTier: 1,
    publicIntent: "最近楽しんだ趣味について、話せる範囲を一つ紹介する。",
    participantMode: "shared_opt_in",
    allowedPhases: ["afternoon", "evening"],
    placeIds: ["living-room", "dining-table"],
    paceIds: ["short", "steady"],
    requirements: { minEnergy: 15, maxStress: 85 },
    effectBudget: effectBudget(2, 4, 5, 5, 2),
  },
  {
    id: "day-check-in",
    title: "今日の調子を短く伝える",
    eventDefinitionId: "gentle-conversation",
    category: "talk",
    intimacyTier: 1,
    publicIntent: "今日の調子を一言ずつ、話せる範囲で伝える。",
    participantMode: "shared_opt_in",
    allowedPhases: ["evening", "night"],
    placeIds: ["living-room", "dining-table"],
    paceIds: ["micro", "short"],
    requirements: { minEnergy: 8, maxStress: 92 },
    effectBudget: effectBudget(2, 5, 4, 5, 1),
  },
  {
    id: "playlist-exchange",
    title: "一曲ずつ選ぶ",
    eventDefinitionId: "movie-night",
    category: "movie",
    intimacyTier: 1,
    publicIntent: "今聴きたい曲を一曲ずつ選び、感想は任意にする。",
    participantMode: "shared_opt_in",
    allowedPhases: LATER,
    placeIds: ["living-room"],
    paceIds: ["short", "steady"],
    requirements: { minEnergy: 10, maxStress: 90 },
    effectBudget: effectBudget(2, 5, 5, 4, 2),
  },
  {
    id: "shared-space-reset",
    title: "共有スペースを少し整える",
    eventDefinitionId: "shared-cleaning",
    category: "clean",
    intimacyTier: 1,
    publicIntent: "触れてよい共有物を確認し、一か所だけ一緒に整える。",
    participantMode: "shared_opt_in",
    allowedPhases: DAYTIME,
    placeIds: ["living-room", "dining-table"],
    paceIds: ["short", "steady"],
    requirements: { minEnergy: 15, maxStress: 85 },
    effectBudget: effectBudget(2, 4, 4, 6, 1),
  },
  {
    id: "one-point-repair",
    title: "すれ違いを一つだけ確認する",
    eventDefinitionId: "targeted-apology",
    category: "apology",
    intimacyTier: 1,
    publicIntent: "残っているすれ違いを一つだけ選び、今後の希望を短く確認する。",
    participantMode: "shared_opt_in",
    allowedPhases: ["evening", "night"],
    placeIds: ["living-room", "dining-table"],
    paceIds: ["short"],
    requirements: { minEnergy: 12, maxStress: 80, requiresConflict: true },
    effectBudget: effectBudget(2, 5, 4, 7, 1),
  },
  {
    id: "memory-caption",
    title: "共有の思い出に一言つける",
    eventDefinitionId: "gentle-conversation",
    category: "talk",
    intimacyTier: 2,
    publicIntent: "二人がすでに共有している思い出を一つ選び、短い感想を添える。",
    participantMode: "shared_opt_in",
    allowedPhases: ["evening", "night"],
    placeIds: ["living-room", "dining-table"],
    paceIds: ["short", "steady"],
    requirements: { minEnergy: 15, maxStress: 80, minTrust: 45, requiresSharedMemory: true },
    effectBudget: effectBudget(2, 4, 6, 6, 4),
  },
  {
    id: "plan-tomorrow",
    title: "明日の小さな予定を合わせる",
    eventDefinitionId: "gentle-conversation",
    category: "talk",
    intimacyTier: 1,
    publicIntent: "明日の共同生活で合わせたいことを一つだけ相談する。",
    participantMode: "optional_companion",
    allowedPhases: ["evening", "night"],
    placeIds: ["living-room", "dining-table"],
    paceIds: ["micro", "short"],
    requirements: { minEnergy: 8, maxStress: 90 },
    effectBudget: effectBudget(1, 3, 3, 5, 1),
  },
] as const satisfies readonly AutonomousActivityElement[];

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pickStable<T>(values: readonly T[], key: string): T | undefined {
  if (values.length === 0) return undefined;
  return values[stableHash(key) % values.length];
}

function stateKey(state: GameState, characterId: CharacterId): string {
  const self = state.characters[characterId].state;
  return [
    state.seed,
    state.revision,
    state.shared.day,
    state.shared.phase,
    state.shared.relationshipLabel,
    state.shared.unresolvedConflicts.length,
    state.shared.sharedMemories.length,
    characterId,
    self.energy,
    self.stress,
    self.affection,
    self.trust,
    self.romanticAwareness,
    self.mood,
    self.location,
    self.currentGoal,
  ].join("|");
}

function activityAvailable(
  activity: AutonomousActivityElement,
  state: GameState,
  characterId: CharacterId,
): boolean {
  const self = state.characters[characterId].state;
  const requirements = activity.requirements;
  const uses = state.eventLog.filter((entry) => {
    const candidateId = entry.decisions?.[characterId].initiative?.candidateId;
    return candidateId?.split(":")[2] === activity.id;
  });
  const lastUse = uses.at(-1);
  const phaseIndex = (phase: Phase) => phases.indexOf(phase);
  const currentOrdinal = (state.shared.day - 1) * phases.length + phaseIndex(state.shared.phase);
  const lastUseOrdinal = lastUse
    ? (lastUse.day - 1) * phases.length + phaseIndex(lastUse.phase)
    : undefined;
  return (
    activity.allowedPhases.includes(state.shared.phase) &&
    self.energy >= requirements.minEnergy &&
    self.stress <= requirements.maxStress &&
    self.trust >= (requirements.minTrust ?? 0) &&
    (!requirements.requiresSharedMemory || state.shared.sharedMemories.length > 0) &&
    (!requirements.requiresConflict || state.shared.unresolvedConflicts.length > 0) &&
    !uses.some((entry) => entry.day === state.shared.day) &&
    uses.length < 7 &&
    (lastUseOrdinal === undefined || currentOrdinal - lastUseOrdinal >= 2)
  );
}

function scaledBudget(budget: EffectBudget, scale: number): EffectBudget {
  return {
    energy: Math.ceil(budget.energy * scale),
    stress: Math.ceil(budget.stress * scale),
    affection: Math.ceil(budget.affection * scale),
    trust: Math.ceil(budget.trust * scale),
    romanticAwareness: Math.ceil(budget.romanticAwareness * scale),
  };
}

function makeCandidate(
  activity: AutonomousActivityElement,
  state: GameState,
  characterId: CharacterId,
  key: string,
): AutonomousActionCandidate | undefined {
  const self = state.characters[characterId].state;
  const lowCapacity = self.energy < 25 || self.stress > 75;
  const places = ACTION_PLACE_ELEMENTS.filter(
    (place) =>
      activity.placeIds.includes(place.id) &&
      (place.allowedPhases as readonly Phase[]).includes(state.shared.phase),
  );
  const paces = ACTION_PACE_ELEMENTS.filter(
    (pace) =>
      activity.paceIds.includes(pace.id) &&
      (!lowCapacity || pace.lightweight) &&
      self.energy >= activity.requirements.minEnergy + pace.additionalMinEnergy,
  );
  const invitations = ACTION_INVITATION_ELEMENTS.filter((invitation) =>
    (invitation.participantModes as readonly AutonomousParticipantMode[]).includes(
      activity.participantMode,
    ),
  );
  const place = pickStable(places, `${key}|${activity.id}|place`);
  const pace = pickStable(paces, `${key}|${activity.id}|pace`);
  const invitation = pickStable(invitations, `${key}|${activity.id}|invite`);
  if (!place || !pace || !invitation) return undefined;

  const allowedPhases = activity.allowedPhases.filter((phase) =>
    (place.allowedPhases as readonly Phase[]).includes(phase),
  );
  const minEnergy = activity.requirements.minEnergy + pace.additionalMinEnergy;
  const invitationOptions: AutonomousInvitation[] =
    activity.participantMode === "solo"
      ? ["solo"]
      : activity.participantMode === "shared_opt_in"
        ? ["open"]
        : [...invitation.invitationOptions];
  const candidateEffectBudget = scaledBudget(activity.effectBudget, pace.effectScale);
  candidateEffectBudget.energy = Math.max(candidateEffectBudget.energy, pace.energyCost);

  return {
    id: `autonomous:${characterId}:${activity.id}:${place.id}:${pace.id}:${invitation.id}`,
    eventDefinitionId: activity.eventDefinitionId,
    title: activity.title,
    category: activity.category,
    intimacyTier: activity.intimacyTier,
    location: place.location,
    publicIntent: `${activity.publicIntent} ${place.publicHint} ${pace.publicHint} ${invitation.publicHint}`,
    invitationOptions,
    durationMinutes: pace.durationMinutes,
    energyCost: pace.energyCost,
    minEnergy,
    maxStress: activity.requirements.maxStress,
    participantMode: activity.participantMode,
    effectBudget: candidateEffectBudget,
    allowedPhases: [...allowedPhases],
    consent: {
      allowPass: true,
      allowModify: true,
      physicalContact: "none",
      secrets: "forbidden",
      coercion: "forbidden",
    },
  };
}

/**
 * Produces at most six server-authored action ideas. Selection and every
 * component choice are deterministic for the same seed and public game state.
 */
export function buildAutonomousActionCandidates(
  state: GameState,
  characterId: CharacterId,
  limit = AUTONOMOUS_ACTION_MAX_CANDIDATES,
): AutonomousActionCandidate[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(AUTONOMOUS_ACTION_MAX_CANDIDATES, Math.floor(limit)))
    : AUTONOMOUS_ACTION_MAX_CANDIDATES;
  if (safeLimit === 0) return [];

  const key = stateKey(state, characterId);
  return AUTONOMOUS_ACTIVITY_ELEMENTS.filter((activity) =>
    activityAvailable(activity, state, characterId),
  )
    .map((activity) => makeCandidate(activity, state, characterId, key))
    .filter((candidate): candidate is AutonomousActionCandidate => candidate !== undefined)
    .sort((left, right) => {
      const rank = stableHash(`${key}|${left.id}`) - stableHash(`${key}|${right.id}`);
      return rank || left.id.localeCompare(right.id);
    })
    .slice(0, safeLimit);
}
