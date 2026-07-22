import { roomForEvent, type RoomId } from "./room-layout.js";
import { conversationForEvent } from "./after-scene.js";
import type { DecisionType, GameEvent, Memory, Phase } from "./types.js";

const PHASES: Phase[] = ["morning", "afternoon", "evening", "night"];

const SHARED_ROOM_LOCATIONS: Omit<Record<RoomId, string>, "male_room" | "female_room"> = {
  entry: "玄関",
  washroom: "洗面室",
  hallway: "廊下",
  bathroom: "浴室",
  kitchen: "キッチン",
  dining: "ダイニング",
  living: "リビング",
  balcony: "ベランダ",
};

export type MemoryArticleCharacter = {
  action?: string;
  dialogue?: string;
  publicReason?: string;
  decision?: DecisionType;
  location: string;
};

export type MemoryArticle = {
  memory: Memory;
  event?: GameEvent;
  phase: Phase;
  scene: {
    haru: string;
    aoi: string;
  };
  captureIsExact: boolean;
  haru: MemoryArticleCharacter;
  aoi: MemoryArticleCharacter;
};

const normalizePhase = (value: string): Phase => {
  const normalized = value.toLowerCase() as Phase;
  return PHASES.includes(normalized) ? normalized : "morning";
};

export function findEventForMemory(
  memory: Memory,
  events: GameEvent[],
): GameEvent | undefined {
  if (memory.sourceEventId) {
    return events.find((event) => event.id === memory.sourceEventId);
  }

  const reverseLinked = events.find((event) => event.memoryId === memory.id);
  if (reverseLinked) return reverseLinked;

  const legacyEventId = memory.id.startsWith("memory-")
    ? `log-${memory.id.slice("memory-".length)}`
    : undefined;
  if (legacyEventId) {
    const legacyLinked = events.find((event) => event.id === legacyEventId);
    if (legacyLinked) return legacyLinked;
  }

  const sameMoment = events.filter(
    (event) => event.day === memory.day && event.phase === normalizePhase(memory.phase),
  );
  if (sameMoment.length === 1) return sameMoment[0];
  if (sameMoment.length > 1) {
    return sameMoment.find(
      (event) => event.eventTitle === memory.title || event.narration.includes(memory.title),
    );
  }

  return events.find(
    (event) =>
      event.day === memory.day &&
      (event.eventTitle === memory.title || event.narration.includes(memory.title)),
  );
}

export function buildMemoryArticle(
  memory: Memory,
  events: GameEvent[],
  characterNames: Record<"haru" | "aoi", string> = { haru: "住人1", aoi: "住人2" },
): MemoryArticle {
  const event = findEventForMemory(memory, events);
  const inferredRoom = event ? roomForEvent(event) : undefined;
  const inferredLocation = inferredRoom === "male_room"
    ? `${characterNames.haru}の自室`
    : inferredRoom === "female_room"
      ? `${characterNames.aoi}の自室`
      : inferredRoom
        ? SHARED_ROOM_LOCATIONS[inferredRoom]
        : "リビング";
  const haruLocation = event?.scene?.haru ?? inferredLocation;
  const aoiLocation = event?.scene?.aoi ?? inferredLocation;
  const conversation = event ? conversationForEvent(event) : [];
  const haruDialogue = conversation.find((turn) => turn.speaker === "haru")?.text;
  const aoiDialogue = conversation.find((turn) => turn.speaker === "aoi")?.text;

  return {
    memory,
    event,
    phase: event?.phase ?? normalizePhase(memory.phase),
    scene: {
      haru: haruLocation,
      aoi: aoiLocation,
    },
    captureIsExact: Boolean(event?.scene?.haru && event.scene.aoi),
    haru: {
      action: event?.haruAction,
      dialogue: haruDialogue,
      publicReason: event?.haruPublicReason,
      decision: event?.haruDecision,
      location: haruLocation,
    },
    aoi: {
      action: event?.aoiAction,
      dialogue: aoiDialogue,
      publicReason: event?.aoiPublicReason,
      decision: event?.aoiDecision,
      location: aoiLocation,
    },
  };
}
