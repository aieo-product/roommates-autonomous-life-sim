import type {
  CharacterDecision,
  CharacterId,
  EventConversationLine,
  EventDefinition,
  EventStoryBeat,
  GameState,
  ResolvedEvent,
  StatDelta,
} from "@roommates/shared";
import {
  EVENT_CONVERSATION_MAX_LINES,
  EVENT_CONVERSATION_TEXT_MAX_LENGTH,
  EVENT_STORY_BEAT_CONTENT_MAX_LENGTH,
  EVENT_STORY_BEAT_LOCATION_MAX_LENGTH,
  eventStoryBeatsSchema,
  mutableStatKeys,
} from "@roommates/shared";

const phaseOrder = ["morning", "afternoon", "evening", "night"] as const;
const cooperative = new Set(["ACCEPT", "MODIFY", "INITIATE"]);

export type EventPolicyContext = Pick<GameState, "characters" | "shared" | "eventLog">;

export type EventAvailability =
  | { available: true }
  | { available: false; reason: string };

function phaseOrdinal(day: number, phase: GameState["shared"]["phase"]): number {
  return (day - 1) * phaseOrder.length + phaseOrder.indexOf(phase);
}

function everyCharacter(
  context: EventPolicyContext,
  predicate: (state: GameState["characters"]["haru"]["state"]) => boolean,
): boolean {
  return predicate(context.characters.haru.state) && predicate(context.characters.aoi.state);
}

export function evaluateEventAvailability(
  definition: EventDefinition,
  context: EventPolicyContext,
): EventAvailability {
  const { shared, eventLog } = context;
  const preconditions = definition.preconditions;

  if (shared.day < definition.minDay || shared.day > definition.maxDay) {
    return {
      available: false,
      reason: `Day ${definition.minDay}〜${definition.maxDay}に利用できるイベントです`,
    };
  }
  if (!definition.allowedPhases.includes(shared.phase)) {
    return {
      available: false,
      reason: `${definition.title}は${definition.allowedPhases.join("・")}に利用できます`,
    };
  }
  if (
    preconditions.relationshipLabels?.length &&
    !preconditions.relationshipLabels.includes(shared.relationshipLabel)
  ) {
    return { available: false, reason: "現在の関係性ではまだ選べません" };
  }
  if (preconditions.requiresConflict && shared.unresolvedConflicts.length === 0) {
    return { available: false, reason: "向き合う対象のすれ違いがありません" };
  }
  if (preconditions.requiresNoConflicts && shared.unresolvedConflicts.length > 0) {
    return { available: false, reason: "先に残っているすれ違いへ向き合う必要があります" };
  }
  if (
    preconditions.minPositiveMemories !== undefined &&
    shared.sharedMemories.filter(
      (memory) => memory.emotionalImpact > 0 && memory.importance >= 6,
    ).length < preconditions.minPositiveMemories
  ) {
    return { available: false, reason: "大切な共有記憶がまだ足りません" };
  }

  const numericChecks: Array<{
    value: number | undefined;
    valid: (state: GameState["characters"]["haru"]["state"], value: number) => boolean;
    reason: string;
  }> = [
    {
      value: preconditions.minEnergy,
      valid: (state, value) => state.energy >= value,
      reason: "二人の体力が足りないため、もっと軽いきっかけが必要です",
    },
    {
      value: preconditions.maxStress,
      valid: (state, value) => state.stress <= value,
      reason: "ストレスが高いため、まず休息が必要です",
    },
    {
      value: preconditions.minTrust,
      valid: (state, value) => state.trust >= value,
      reason: "この話題には、もう少し信頼が必要です",
    },
    {
      value: preconditions.minAffection,
      valid: (state, value) => state.affection >= value,
      reason: "このきっかけには、もう少し親しさが必要です",
    },
    {
      value: preconditions.minRomanticAwareness,
      valid: (state, value) => state.romanticAwareness >= value,
      reason: "二人が自分の気持ちに気づくまでは選べません",
    },
  ];
  for (const check of numericChecks) {
    const threshold = check.value;
    if (threshold !== undefined && !everyCharacter(context, (state) => check.valid(state, threshold))) {
      return { available: false, reason: check.reason };
    }
  }

  const uses = eventLog.filter((entry) => entry.eventDefinitionId === definition.id);
  const usesToday = uses.filter((entry) => entry.day === shared.day);
  if (usesToday.length >= definition.maxUsesPerDay) {
    return { available: false, reason: "このイベントは今日はすでに利用済みです" };
  }
  if (uses.length >= definition.maxUsesPerRun) {
    return { available: false, reason: "このイベントは今回の共同生活で上限に達しました" };
  }
  const lastUse = uses.at(-1);
  if (lastUse && definition.cooldownPhases > 0) {
    const elapsed =
      phaseOrdinal(shared.day, shared.phase) - phaseOrdinal(lastUse.day, lastUse.phase);
    if (elapsed < definition.cooldownPhases) {
      return {
        available: false,
        reason: `同系統のイベントから${definition.cooldownPhases}フェーズ空ける必要があります`,
      };
    }
  }

  return { available: true };
}

function constrainDelta(delta: StatDelta, definition: EventDefinition): StatDelta {
  const constrained: StatDelta = {};
  for (const key of mutableStatKeys) {
    const value = delta[key];
    if (value === undefined) continue;
    const limit = definition.effectBudget[key];
    constrained[key] = Math.max(-limit, Math.min(limit, Math.round(value)));
  }
  return constrained;
}

function zeroRelationshipEffects(delta: StatDelta): StatDelta {
  return {
    energy: delta.energy,
    stress: delta.stress,
    affection: 0,
    trust: 0,
    romanticAwareness: 0,
  };
}

function scaleDelta(delta: StatDelta, factor: number): StatDelta {
  return Object.fromEntries(
    Object.entries(delta).map(([key, value]) => [key, Math.round((value ?? 0) * factor)]),
  ) as StatDelta;
}

function branchKey(
  haruDecision: CharacterDecision,
  aoiDecision: CharacterDecision,
): keyof EventDefinition["branches"] {
  const haruJoins = cooperative.has(haruDecision.decision);
  const aoiJoins = cooperative.has(aoiDecision.decision);
  if (!haruJoins && !aoiJoins) return "bothDecline";
  if (!haruJoins || !aoiJoins) return "oneParticipates";
  if (haruDecision.decision === "MODIFY" || aoiDecision.decision === "MODIFY") return "modified";
  return "bothParticipate";
}

function conversationText(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, EVENT_CONVERSATION_TEXT_MAX_LENGTH).trim();
  return normalized || fallback;
}

function safeConversation(
  event: ResolvedEvent,
  decisions: { haru: CharacterDecision; aoi: CharacterDecision },
): EventConversationLine[] {
  const haruJoins = cooperative.has(decisions.haru.decision);
  const aoiJoins = cooperative.has(decisions.aoi.decision);
  const opening: EventConversationLine[] = [
    {
      speaker: "haru",
      text: conversationText(decisions.haru.dialogue, "今は自分のペースで過ごすね。"),
    },
    {
      speaker: "aoi",
      text: conversationText(decisions.aoi.dialogue, "私も自分のペースで過ごすね。"),
    },
  ];

  // Director prose must never turn a refusal or IGNORE into participation.
  if (!haruJoins || !aoiJoins) {
    const acknowledgement: EventConversationLine = haruJoins
      ? { speaker: "haru", text: "わかった。今日はそれぞれのペースで過ごそう。" }
      : aoiJoins
        ? { speaker: "aoi", text: "わかった。今日はそれぞれのペースで過ごそう。" }
        : { speaker: "haru", text: "うん。今日はそれぞれの時間を大切にしよう。" };
    return [...opening, acknowledgement];
  }

  const continuation = (event.conversation ?? [])
    .slice(2)
    .map((line) => ({
      speaker: line.speaker,
      text: conversationText(line.text, "少しずつ進めよう。"),
    }));
  const conversation = [...opening, ...continuation].slice(
    0,
    EVENT_CONVERSATION_MAX_LINES,
  );
  if (conversation.length < 3) {
    conversation.push({
      speaker: "haru",
      text: "それじゃ、二人のペースで始めよう。",
    });
  }
  return conversation;
}

function locationZone(location: string): string {
  const value = location.trim().toLowerCase();
  const zones: Array<[string, string[]]> = [
    ["kitchen", ["キッチン", "台所", "kitchen"]],
    ["dining", ["ダイニング", "食卓", "dining"]],
    ["living", ["リビング", "ソファ", "living"]],
    ["balcony", ["ベランダ", "バルコニー", "balcony"]],
    ["entry", ["玄関", "entry"]],
    ["bathroom", ["風呂", "浴室", "bathroom"]],
    ["washroom", ["洗面", "washroom"]],
    ["hallway", ["廊下", "hallway"]],
  ];
  return zones.find(([, keywords]) =>
    keywords.some((keyword) => value.includes(keyword))
  )?.[0] ?? value;
}

function safeScene(
  event: ResolvedEvent,
  decisions: { haru: CharacterDecision; aoi: CharacterDecision },
  originalLocations?: Partial<Record<CharacterId, string>>,
): ResolvedEvent["scene"] {
  const scene = { ...(event.scene ?? {}) };
  for (const id of ["haru", "aoi"] as const) {
    if (cooperative.has(decisions[id].decision)) {
      if (!scene[id]?.trim() && originalLocations?.[id]?.trim()) {
        scene[id] = originalLocations[id];
      }
      continue;
    }
    const other = id === "haru" ? "aoi" : "haru";
    const original = originalLocations?.[id]?.trim();
    const participatingTarget = cooperative.has(decisions[other].decision)
      ? event.scene?.[other]
      : undefined;
    // A refusal/IGNORE never inherits Director's event placement. Keep the
    // pre-turn location when it is outside the participant's event room;
    // otherwise give the character privacy in their own room.
    scene[id] =
      original &&
      (!participatingTarget || locationZone(original) !== locationZone(participatingTarget))
        ? original
        : "自室";
  }
  for (const id of ["haru", "aoi"] as const) {
    const location = scene[id]?.trim().slice(0, EVENT_STORY_BEAT_LOCATION_MAX_LENGTH).trim();
    if (location) scene[id] = location;
    else delete scene[id];
  }
  return Object.keys(scene).length > 0 ? scene : undefined;
}

function storyText(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, EVENT_STORY_BEAT_CONTENT_MAX_LENGTH).trim();
  return normalized || fallback;
}

function storyLocation(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().slice(0, EVENT_STORY_BEAT_LOCATION_MAX_LENGTH).trim();
  return normalized || fallback;
}

/**
 * Pick a nearby, narratively useful waypoint outside the final room. Keeping
 * this distinct from the committed scene guarantees that even a one-location
 * Director response becomes a visible journey instead of an in-place walk.
 */
function storyStagingLocation(finalLocation: string): string {
  const stagingByZone: Record<string, string> = {
    kitchen: "ダイニングの食卓",
    dining: "キッチンの調理台",
    living: "ダイニングの食卓",
    balcony: "リビングの窓際",
    entry: "廊下",
    bathroom: "洗面所",
    washroom: "廊下",
    hallway: "玄関のドア側",
  };
  return stagingByZone[locationZone(finalLocation)] ?? "廊下";
}

function fallbackStoryBeats(
  event: ResolvedEvent,
  decisions: { haru: CharacterDecision; aoi: CharacterDecision },
  conversation: EventConversationLine[],
  scene: ResolvedEvent["scene"],
): EventStoryBeat[] {
  const haruJoins = cooperative.has(decisions.haru.decision);
  const aoiJoins = cooperative.has(decisions.aoi.decision);
  const haruLocation = storyLocation(scene?.haru, "Haruの自室");
  const aoiLocation = storyLocation(scene?.aoi, "Aoiの自室");
  const sharedDestination = haruJoins && aoiJoins && haruLocation === aoiLocation;
  const story: EventStoryBeat[] = sharedDestination
    ? [
        { kind: "move", actor: "both", location: storyStagingLocation(haruLocation) },
        { kind: "dialogue", actor: conversation[0]!.speaker, text: conversation[0]!.text },
        { kind: "dialogue", actor: conversation[1]!.speaker, text: conversation[1]!.text },
        { kind: "move", actor: "both", location: haruLocation },
      ]
    : [
        { kind: "move", actor: "haru", location: haruLocation },
        { kind: "move", actor: "aoi", location: aoiLocation },
        { kind: "dialogue", actor: conversation[0]!.speaker, text: conversation[0]!.text },
        { kind: "dialogue", actor: conversation[1]!.speaker, text: conversation[1]!.text },
      ];
  const actionActor = haruJoins && aoiJoins
    ? "both"
    : haruJoins
      ? "haru"
      : aoiJoins
        ? "aoi"
        : "haru";
  const actionText = actionActor === "both"
    ? `${decisions.haru.action}。${decisions.aoi.action}`
    : decisions[actionActor].action;
  story.push({
    kind: "action",
    actor: actionActor,
    action: storyText(actionText, storyText(event.narration, "それぞれの時間を過ごす")),
  });
  const remainingSlots = 8 - story.length;
  for (const line of conversation.slice(2, 2 + remainingSlots)) {
    story.push({ kind: "dialogue", actor: line.speaker, text: line.text });
  }
  return story.slice(0, 8);
}

/**
 * AppServer output is intentionally tolerant for compatibility. If a model
 * returns only one destination, retain its dialogue/action but introduce a
 * staging waypoint and a second move immediately before the action.
 */
function ensureCooperativeJourney(
  beats: EventStoryBeat[],
  finalLocation: string,
): EventStoryBeat[] | undefined {
  if (hasNarrativeJourney(beats)) return beats;
  // A malformed multi-move draft is safer to replace than to guess which
  // destination should own each existing action or line.
  if (beats.filter((beat) => beat.kind === "move").length !== 1) return undefined;
  if (beats.length >= 8) return undefined;

  const actionIndex = beats.findIndex((beat) => beat.kind === "action");
  if (actionIndex < 0) return undefined;
  const preActionMoves = beats
    .map((beat, index) => beat.kind === "move" && index < actionIndex ? index : -1)
    .filter((index) => index >= 0);
  if (preActionMoves.length === 0) return undefined;

  const stagingLocation = storyStagingLocation(finalLocation);
  if (stagingLocation === finalLocation) return undefined;
  const staged = beats.map((beat, index): EventStoryBeat =>
    preActionMoves.includes(index) && beat.kind === "move"
      ? { ...beat, location: stagingLocation }
      : beat,
  );
  const stagedJourney: EventStoryBeat[] = [
    ...staged.slice(0, actionIndex),
    { kind: "move", actor: "both", location: finalLocation },
    ...staged.slice(actionIndex),
  ];
  return hasNarrativeJourney(stagedJourney) ? stagedJourney : undefined;
}

/**
 * Consecutive per-character moves form one movement stage. A complete journey
 * needs two distinct stages, with dialogue or action at every destination.
 */
function hasNarrativeJourney(beats: EventStoryBeat[]): boolean {
  const stages: Array<{ start: number; end: number; locations: string[] }> = [];
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index];
    if (beat?.kind !== "move") continue;
    const previous = stages.at(-1);
    if (previous && previous.end === index - 1) {
      previous.end = index;
      previous.locations.push(beat.location);
    } else {
      stages.push({ start: index, end: index, locations: [beat.location] });
    }
  }
  if (stages.length < 2) return false;
  if (new Set(stages.flatMap((stage) => stage.locations)).size < 2) return false;
  return stages.every((stage, index) => {
    const nextStart = stages[index + 1]?.start ?? beats.length;
    return beats.slice(stage.end + 1, nextStart).some((beat) => beat.kind !== "move");
  });
}

function lastMoveIndexFor(beats: EventStoryBeat[], id: CharacterId): number {
  for (let index = beats.length - 1; index >= 0; index -= 1) {
    const beat = beats[index];
    if (beat?.kind === "move" && (beat.actor === id || beat.actor === "both")) return index;
  }
  return -1;
}

function safeStoryBeats(
  event: ResolvedEvent,
  decisions: { haru: CharacterDecision; aoi: CharacterDecision },
  conversation: EventConversationLine[],
  scene: ResolvedEvent["scene"],
): EventStoryBeat[] {
  const haruJoins = cooperative.has(decisions.haru.decision);
  const aoiJoins = cooperative.has(decisions.aoi.decision);
  const bothJoin = haruJoins && aoiJoins;
  let dialogueIndex = 0;
  const authored = (event.storyBeats ?? []).flatMap((beat): EventStoryBeat[] => {
    if (beat.kind === "move") {
      if (beat.actor === "both" && !bothJoin) return [];
      const actor = beat.actor;
      const safeTarget = actor !== "both" && !cooperative.has(decisions[actor].decision)
        ? scene?.[actor]
        : beat.location;
      return [{
        kind: "move",
        actor: beat.actor,
        location: storyLocation(safeTarget, beat.actor === "aoi" ? "Aoiの自室" : "Haruの自室"),
      }];
    }
    if (beat.kind === "dialogue") {
      const line = conversation[dialogueIndex];
      dialogueIndex += 1;
      return line ? [{ kind: "dialogue", actor: line.speaker, text: line.text }] : [];
    }
    if (beat.actor === "both" && !bothJoin) return [];
    const action = beat.actor !== "both" && !cooperative.has(decisions[beat.actor].decision)
      ? decisions[beat.actor].action
      : beat.action;
    return [{
      kind: "action",
      actor: beat.actor,
      action: storyText(action, "自分のペースで時間を過ごす"),
    }];
  });

  if (dialogueIndex < 3) {
    return fallbackStoryBeats(event, decisions, conversation, scene);
  }

  const haruMove = lastMoveIndexFor(authored, "haru");
  const aoiMove = lastMoveIndexFor(authored, "aoi");
  if (haruMove < 0 || aoiMove < 0) {
    return fallbackStoryBeats(event, decisions, conversation, scene);
  }
  const haruFinal = storyLocation(scene?.haru, "Haruの自室");
  const aoiFinal = storyLocation(scene?.aoi, "Aoiの自室");
  const haruBeat = authored[haruMove];
  const aoiBeat = authored[aoiMove];
  if (haruBeat?.kind !== "move" || aoiBeat?.kind !== "move") {
    return fallbackStoryBeats(event, decisions, conversation, scene);
  }
  if ((haruBeat.actor === "both" || aoiBeat.actor === "both") && haruFinal !== aoiFinal) {
    return fallbackStoryBeats(event, decisions, conversation, scene);
  }
  haruBeat.location = haruFinal;
  aoiBeat.location = aoiFinal;

  const normalized = bothJoin && haruFinal === aoiFinal
    ? ensureCooperativeJourney(authored, haruFinal)
    : authored;
  if (!normalized) {
    return fallbackStoryBeats(event, decisions, conversation, scene);
  }
  const parsed = eventStoryBeatsSchema.safeParse(normalized);
  return parsed.success
    ? parsed.data
    : fallbackStoryBeats(event, decisions, conversation, scene);
}

export function constrainResolvedEvent(
  definition: EventDefinition,
  event: ResolvedEvent,
  decisions: { haru: CharacterDecision; aoi: CharacterDecision },
  unresolvedConflicts: string[],
  options: {
    suppressRelationshipEffects?: boolean;
    originalLocations?: Partial<Record<CharacterId, string>>;
  } = {},
): ResolvedEvent {
  const branch = branchKey(decisions.haru, decisions.aoi);
  const haruJoins = cooperative.has(decisions.haru.decision);
  const aoiJoins = cooperative.has(decisions.aoi.decision);
  let haruEffects = constrainDelta(event.effects.haru, definition);
  let aoiEffects = constrainDelta(event.effects.aoi, definition);

  if (!haruJoins) haruEffects = zeroRelationshipEffects(haruEffects);
  if (!aoiJoins) aoiEffects = zeroRelationshipEffects(aoiEffects);
  if (haruJoins !== aoiJoins) {
    if (haruJoins) haruEffects = scaleDelta(haruEffects, 0.4);
    if (aoiJoins) aoiEffects = scaleDelta(aoiEffects, 0.4);
  }
  if (!haruJoins && !aoiJoins) {
    haruEffects = zeroRelationshipEffects(haruEffects);
    aoiEffects = zeroRelationshipEffects(aoiEffects);
  }
  if (options.suppressRelationshipEffects) {
    haruEffects = zeroRelationshipEffects(haruEffects);
    aoiEffects = zeroRelationshipEffects(aoiEffects);
  }

  const requestedResolutions = event.conflictUpdate?.resolve ?? [];
  const firstExistingResolution = requestedResolutions.find((value) =>
    unresolvedConflicts.includes(value),
  );
  const resolve =
    definition.category === "apology" && haruJoins && aoiJoins && unresolvedConflicts.length > 0
      ? [firstExistingResolution ?? unresolvedConflicts[0]!]
      : undefined;
  const add = [...new Set(event.conflictUpdate?.add ?? [])]
    .filter((value) => value.trim() && !unresolvedConflicts.includes(value))
    .slice(0, 1);

  const narration =
    branch === "bothParticipate"
      ? event.narration
      : `${definition.branches[branch]} ${event.narration}`.trim();
  const conversation = safeConversation(event, decisions);
  const scene = safeScene(event, decisions, options.originalLocations);

  return {
    ...event,
    narration,
    haruDialogue: decisions.haru.dialogue,
    aoiDialogue: decisions.aoi.dialogue,
    conversation,
    storyBeats: safeStoryBeats(event, decisions, conversation, scene),
    scene,
    effects: { haru: haruEffects, aoi: aoiEffects },
    memory: {
      ...event.memory,
      emotionalImpact:
        branch === "bothDecline" ? 0 : event.memory.emotionalImpact,
      importance:
        branch === "bothDecline" ? Math.min(event.memory.importance, 3) : event.memory.importance,
    },
    conflictUpdate:
      resolve?.length || add.length
        ? { ...(resolve?.length ? { resolve } : {}), ...(add.length ? { add } : {}) }
        : undefined,
  };
}
