import type {
  AutonomousActionCandidate,
  AutonomousInvitation,
  CharacterDecision,
  CharacterId,
  EventConversationLine,
  EventDefinition,
  EventStoryBeat,
  GameSnapshot,
  ResolvedEvent,
  SafeSuggestion,
  StatDelta,
} from "@roommates/shared";
import { mutableStatKeys } from "@roommates/shared";

const CHARACTER_IDS = ["haru", "aoi"] as const satisfies readonly CharacterId[];
const CHARACTER_CHOICES = ["ACCEPT", "MODIFY", "DECLINE", "IGNORE", "INITIATE"] as const;

export type AutonomousEventMode = "single" | "shared" | "parallel";

export type ValidatedAutonomousSelection = {
  characterId: CharacterId;
  candidate: AutonomousActionCandidate;
  invitation: AutonomousInvitation;
  dialogue: string;
};

export type AutonomousEventPlan = {
  mode: AutonomousEventMode;
  selections: ValidatedAutonomousSelection[];
  definition: EventDefinition;
  suggestion: SafeSuggestion;
  scene: Partial<Record<CharacterId, string>>;
};

export type ComposeAutonomousEventInput = {
  baseSuggestion: SafeSuggestion;
  snapshot: GameSnapshot;
  decisions: Record<CharacterId, CharacterDecision>;
  offeredCandidates: Record<CharacterId, readonly AutonomousActionCandidate[]>;
};

export function isGenuineObserveSuggestion(suggestion: SafeSuggestion): boolean {
  return (
    suggestion.kind === "observe" &&
    suggestion.allowsAutonomy === true &&
    suggestion.eventDefinitionId === "observe-rest" &&
    suggestion.cue.transformed === false &&
    suggestion.lock === undefined
  );
}

function validParticipantChoice(
  candidate: AutonomousActionCandidate,
  invitation: AutonomousInvitation,
): boolean {
  if (!candidate.invitationOptions.includes(invitation)) return false;
  if (candidate.participantMode === "solo") return invitation === "solo";
  if (candidate.participantMode === "shared_opt_in") return invitation === "open";
  return true;
}

function validateSelection(
  characterId: CharacterId,
  input: ComposeAutonomousEventInput,
): ValidatedAutonomousSelection | undefined {
  const decision = input.decisions[characterId];
  const initiative = decision.initiative;
  if (decision.decision !== "INITIATE" || !initiative) return undefined;

  const matching = input.offeredCandidates[characterId].filter(
    (candidate) => candidate.id === initiative.candidateId,
  );
  if (matching.length !== 1) return undefined;
  const candidate = matching[0]!;
  const self = input.snapshot.characters[characterId];
  if (!candidate.id.startsWith(`autonomous:${characterId}:`)) return undefined;
  if (initiative.publicIntent !== candidate.publicIntent) return undefined;
  if (!validParticipantChoice(candidate, initiative.invitation)) return undefined;
  if (!candidate.allowedPhases.includes(input.snapshot.shared.phase)) return undefined;
  if (self.energy < candidate.minEnergy || self.energy < candidate.energyCost) return undefined;
  if (self.stress > candidate.maxStress) return undefined;
  if (candidate.category === "confession" || candidate.intimacyTier > 2) return undefined;
  if (
    !candidate.consent.allowPass ||
    !candidate.consent.allowModify ||
    candidate.consent.physicalContact !== "none" ||
    candidate.consent.secrets !== "forbidden" ||
    candidate.consent.coercion !== "forbidden"
  ) {
    return undefined;
  }

  return {
    characterId,
    candidate,
    invitation: initiative.invitation,
    dialogue: decision.dialogue,
  };
}

function semanticCandidateId(candidate: AutonomousActionCandidate): string {
  return candidate.id.replace(/^autonomous:(?:haru|aoi):/u, "");
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function planMode(selections: readonly ValidatedAutonomousSelection[]): AutonomousEventMode {
  if (selections.length === 1) return "single";
  return (
    semanticCandidateId(selections[0]!.candidate) ===
      semanticCandidateId(selections[1]!.candidate) &&
    selections.every(
      (selection) =>
        selection.invitation === "open" &&
        selection.candidate.participantMode !== "solo",
    )
  )
    ? "shared"
    : "parallel";
}

function executableSelections(
  selections: readonly ValidatedAutonomousSelection[],
): ValidatedAutonomousSelection[] {
  const sameOpenChoice =
    selections.length === 2 &&
    semanticCandidateId(selections[0]!.candidate) ===
      semanticCandidateId(selections[1]!.candidate) &&
    selections.every((selection) => selection.invitation === "open");
  return selections.filter(
    (selection) =>
      selection.candidate.participantMode !== "shared_opt_in" || sameOpenChoice,
  );
}

function planIdentity(
  mode: AutonomousEventMode,
  selections: readonly ValidatedAutonomousSelection[],
): string {
  if (mode === "single") return selections[0]!.candidate.id;
  if (mode === "shared") {
    return `autonomous:shared:${semanticCandidateId(selections[0]!.candidate)}`.slice(0, 200);
  }
  const keys = selections.map(({ candidate }) => semanticCandidateId(candidate)).sort();
  return `autonomous:parallel:${stableHash(keys.join("|"))}`;
}

function planTitle(
  mode: AutonomousEventMode,
  selections: readonly ValidatedAutonomousSelection[],
): string {
  if (mode === "single") return selections[0]!.candidate.title;
  if (mode === "shared") {
    return `二人で選んだ「${selections[0]!.candidate.title}」`.slice(0, 2_000);
  }
  const byId = Object.fromEntries(
    selections.map((selection) => [selection.characterId, selection.candidate.title]),
  ) as Partial<Record<CharacterId, string>>;
  return `Haruの「${byId.haru ?? "自由時間"}」／Aoiの「${byId.aoi ?? "自由時間"}」`.slice(
    0,
    2_000,
  );
}

function planText(
  mode: AutonomousEventMode,
  selections: readonly ValidatedAutonomousSelection[],
): string {
  if (mode === "single") return selections[0]!.candidate.publicIntent;
  if (mode === "shared") {
    return `二人がそれぞれ「${selections[0]!.candidate.title}」を選び、自分たちのペースで始める。`.slice(
      0,
      240,
    );
  }
  const byId = Object.fromEntries(
    selections.map((selection) => [selection.characterId, selection.candidate.title]),
  ) as Partial<Record<CharacterId, string>>;
  return `Haruは「${byId.haru ?? "自由時間"}」、Aoiは「${byId.aoi ?? "自由時間"}」をそれぞれ選ぶ。`.slice(
    0,
    240,
  );
}

function effectBudget(
  mode: AutonomousEventMode,
  selections: readonly ValidatedAutonomousSelection[],
): EventDefinition["effectBudget"] {
  const budgets = selections.map(({ candidate }) => candidate.effectBudget);
  const maximum = (key: keyof EventDefinition["effectBudget"]) =>
    Math.max(...budgets.map((budget) => budget[key]));
  if (mode !== "parallel") {
    return {
      energy: maximum("energy"),
      stress: maximum("stress"),
      affection: maximum("affection"),
      trust: maximum("trust"),
      romanticAwareness: maximum("romanticAwareness"),
    };
  }
  return {
    energy: maximum("energy"),
    stress: maximum("stress"),
    affection: Math.min(2, maximum("affection")),
    trust: Math.min(2, maximum("trust")),
    romanticAwareness: Math.min(1, maximum("romanticAwareness")),
  };
}

function buildDefinition(
  mode: AutonomousEventMode,
  selections: readonly ValidatedAutonomousSelection[],
  snapshot: GameSnapshot,
): EventDefinition {
  const first = selections[0]!.candidate;
  const title = planTitle(mode, selections);
  const invitation = selections[0]!.invitation;
  const participantRange =
    mode === "single"
      ? invitation === "solo"
        ? { min: 1, max: 1 }
        : { min: 1, max: 2 }
      : { min: 2, max: 2 };
  const locations = [...new Set(selections.map(({ candidate }) => candidate.location))];

  return {
    id: planIdentity(mode, selections),
    title,
    category: mode === "parallel" ? "rest" : first.category,
    intimacyTier: mode === "parallel" ? 0 : first.intimacyTier,
    allowedPhases: [snapshot.shared.phase],
    minDay: 1,
    maxDay: 7,
    participantRange,
    location: locations.join("／").slice(0, 2_000),
    durationMinutes: Math.max(
      ...selections.map(({ candidate }) => candidate.durationMinutes),
    ),
    preconditions: {
      minEnergy: Math.max(...selections.map(({ candidate }) => candidate.minEnergy)),
      maxStress: Math.min(...selections.map(({ candidate }) => candidate.maxStress)),
    },
    producerControls: [],
    characterChoices: [...CHARACTER_CHOICES],
    effectBudget: effectBudget(mode, selections),
    cooldownPhases: 2,
    maxUsesPerDay: 1,
    maxUsesPerRun: 7,
    consent: {
      allowPass: true,
      allowModify: true,
      physicalContact: "none",
      secrets: "forbidden",
    },
    branches: {
      bothParticipate:
        mode === "parallel"
          ? "二人は互いの選択を邪魔せず、それぞれが選んだ行動を別々に始める。"
          : "参加する二人が各自の意思で同じ行動を選び、途中退出も自由なまま始める。",
      oneParticipates:
        "始めたい側だけが選んだ行動を実行し、相手には参加や反応を求めない。",
      bothDecline: "どちらも実行せず、それぞれの自由時間へ戻る。",
      modified: "時間、場所、同席の有無を許可された範囲で軽くして実行する。",
    },
    fallbackEventId: "observe-rest",
    sourceNotes: [
      `Server-authored autonomous candidate: ${selections
        .map(({ candidate }) => candidate.id)
        .join(", ")}`,
    ],
    safetyNotes: [
      "候補に含まれない場所、効果、秘密、身体接触を追加しない。",
      "不参加や途中退出を拒絶または関係悪化として扱わない。",
    ],
  };
}

export function composeAutonomousEvent(
  input: ComposeAutonomousEventInput,
): AutonomousEventPlan | undefined {
  if (!isGenuineObserveSuggestion(input.baseSuggestion)) return undefined;
  const validatedSelections = CHARACTER_IDS.map((characterId) =>
    validateSelection(characterId, input),
  ).filter((selection): selection is ValidatedAutonomousSelection => selection !== undefined);
  const selections = executableSelections(validatedSelections);
  if (selections.length === 0) return undefined;

  const mode = planMode(selections);
  const definition = buildDefinition(mode, selections, input.snapshot);
  const text = planText(mode, selections);
  const suggestion: SafeSuggestion = {
    kind: "proposal",
    allowsAutonomy: false,
    text,
    tags: [definition.category],
    cue: {
      kind: "proposal",
      text,
      category: definition.category,
      tags: [definition.category],
      safetyFlags: [],
      transformed: false,
    },
    eventDefinitionId: definition.id,
    eventTitle: definition.title,
    intimacyTier: definition.intimacyTier,
    alternatives: [],
  };
  const scene = Object.fromEntries(
    selections.map(({ characterId, candidate }) => [characterId, candidate.location]),
  ) as Partial<Record<CharacterId, string>>;

  return { mode, selections, definition, suggestion, scene };
}

function constrainSelectionDelta(
  delta: StatDelta,
  candidate: AutonomousActionCandidate,
  applyEnergyCost = false,
): StatDelta {
  const constrained: StatDelta = {};
  for (const key of mutableStatKeys) {
    const value = delta[key];
    if (value === undefined) continue;
    const limit = candidate.effectBudget[key];
    constrained[key] = Math.max(-limit, Math.min(limit, Math.round(value)));
  }
  if (applyEnergyCost) {
    const energyLimit = candidate.effectBudget.energy;
    const energyAfterCost = Math.max(
      -energyLimit,
      Math.min(energyLimit, Math.round(delta.energy ?? 0) - candidate.energyCost),
    );
    constrained.energy =
      candidate.category === "rest"
        ? energyAfterCost
        : Math.min(-candidate.energyCost, energyAfterCost);
  }
  return constrained;
}

/**
 * Applies the per-character candidate bounds before the common event policy.
 * This matters for parallel plans, where the two candidates can have different
 * budgets even though Director resolves one combined scene.
 */
export function constrainAutonomousEventDraft(
  plan: AutonomousEventPlan,
  event: ResolvedEvent,
): ResolvedEvent {
  const effects = { ...event.effects };
  for (const selection of plan.selections) {
    effects[selection.characterId] = constrainSelectionDelta(
      event.effects[selection.characterId],
      selection.candidate,
    );
  }
  const emotionalImpactLimit =
    plan.mode === "parallel" ? 2 : Math.min(6, 3 + plan.definition.intimacyTier);
  const importanceLimit =
    plan.mode === "parallel" ? 4 : Math.min(7, 4 + plan.definition.intimacyTier);
  const requestedResolution =
    plan.mode === "shared" && plan.definition.category === "apology"
      ? event.conflictUpdate?.resolve?.slice(0, 1)
      : undefined;
  return {
    ...event,
    eventTitle: plan.definition.title,
    scene: { ...event.scene, ...plan.scene },
    effects,
    memory: {
      ...event.memory,
      title: plan.definition.title,
      emotionalImpact: Math.max(
        -emotionalImpactLimit,
        Math.min(emotionalImpactLimit, Math.round(event.memory.emotionalImpact)),
      ),
      importance: Math.max(
        0,
        Math.min(importanceLimit, Math.round(event.memory.importance)),
      ),
    },
    conflictUpdate:
      requestedResolution?.length ? { resolve: requestedResolution } : undefined,
  };
}

/** Reapplies participant-specific mechanics after common branch scaling. */
export function finalizeAutonomousResolvedEvent(
  plan: AutonomousEventPlan,
  event: ResolvedEvent,
): ResolvedEvent {
  const effects: ResolvedEvent["effects"] = { haru: {}, aoi: {} };
  for (const characterId of CHARACTER_IDS) {
    const selection = plan.selections.find((item) => item.characterId === characterId);
    effects[characterId] = selection
      ? constrainSelectionDelta(
          event.effects[characterId],
          selection.candidate,
          true,
        )
      : {
          energy: 0,
          stress: 0,
          affection: 0,
          trust: 0,
          romanticAwareness: 0,
        };
  }
  const parallel =
    plan.mode === "parallel" ? buildParallelPresentation(plan) : undefined;
  return {
    ...event,
    effects,
    ...(parallel
      ? {
          narration: parallel.narration,
          haruDialogue: parallel.haruDialogue,
          aoiDialogue: parallel.aoiDialogue,
          conversation: parallel.conversation,
          storyBeats: parallel.storyBeats,
          memory: {
            ...event.memory,
            summary: parallel.narration,
          },
        }
      : {}),
  };
}

function boundedStoryText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().slice(0, 160).trim();
  return normalized || fallback;
}

function boundedEventText(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 2_000).trim();
  return normalized || fallback;
}

function boundedStoryLocation(value: string): string {
  return value.trim().slice(0, 48).trim();
}

/**
 * A parallel plan represents two independent initiatives, even when both
 * characters happen to choose the same activity or room. Rebuild its public
 * presentation from the validated selections after the common event policy so
 * Director prose cannot turn it back into a shared action or add a new place.
 */
function buildParallelPresentation(
  plan: AutonomousEventPlan,
): {
  narration: string;
  haruDialogue: string;
  aoiDialogue: string;
  conversation: EventConversationLine[];
  storyBeats: EventStoryBeat[];
} {
  const haru = plan.selections.find(
    (selection) => selection.characterId === "haru",
  )!;
  const aoi = plan.selections.find(
    (selection) => selection.characterId === "aoi",
  )!;
  const openings = {
    haru: boundedStoryText(haru.dialogue, "自分のペースで始めよう。"),
    aoi: boundedStoryText(aoi.dialogue, "私も自分のペースでやってみよう。"),
  };
  const followUps = {
    haru: "こちらはこのまま自分のペースで続けよう。",
    aoi: "私もこちらを自分のペースで続けよう。",
  };
  const conversation: EventConversationLine[] = [
    { speaker: "haru", text: openings.haru },
    { speaker: "aoi", text: openings.aoi },
    { speaker: "haru", text: followUps.haru },
    { speaker: "aoi", text: followUps.aoi },
  ];
  const beats: EventStoryBeat[] = [];
  for (const characterId of CHARACTER_IDS) {
    const selection = plan.selections.find(
      (item) => item.characterId === characterId,
    );
    if (!selection) continue;

    beats.push(
      {
        kind: "move",
        actor: characterId,
        location: boundedStoryLocation(selection.candidate.location),
      },
      { kind: "dialogue", actor: characterId, text: openings[characterId] },
      {
        kind: "action",
        actor: characterId,
        action: boundedStoryText(
          selection.candidate.publicIntent,
          selection.candidate.title,
        ),
      },
      { kind: "dialogue", actor: characterId, text: followUps[characterId] },
    );
  }
  const narration = boundedEventText(
    "Haruは「" +
      haru.candidate.title +
      "」を選び、" +
      haru.candidate.publicIntent +
      " 一方、Aoiは「" +
      aoi.candidate.title +
      "」を選び、" +
      aoi.candidate.publicIntent +
      " 二人は相手の選択を邪魔せず、それぞれのペースで別々に過ごした。",
    "二人は相手の選択を邪魔せず、それぞれのペースで別々に過ごした。",
  );
  return {
    narration,
    haruDialogue: openings.haru,
    aoiDialogue: openings.aoi,
    conversation,
    storyBeats: beats,
  };
}
