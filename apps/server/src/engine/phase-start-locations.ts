import type { CharacterId, Phase } from "@roommates/shared";

export type PhaseStartLocations = Record<CharacterId, string>;

/**
 * Stable room/asset labels understood by the room renderer. Each phase has a
 * small schedule instead of a single fixed spawn so repeated days still feel
 * lived in while remaining reproducible for a given game seed.
 */
export const PHASE_START_LOCATION_OPTIONS = {
  morning: [
    { haru: "キッチンのアイランド調理台", aoi: "リビングの窓辺" },
    { haru: "キッチンのアイランド調理台", aoi: "リビングのソファ" },
    { haru: "洗面室", aoi: "リビングのローテーブル" },
    { haru: "ダイニングの食卓", aoi: "玄関のラグ" },
  ],
  afternoon: [
    { haru: "自室の作業机", aoi: "自室" },
    { haru: "自室", aoi: "自室の作業机" },
    { haru: "リビングの窓辺", aoi: "リビングのソファ" },
    { haru: "バルコニーの洗濯スペース", aoi: "ダイニングの食卓" },
  ],
  evening: [
    { haru: "リビングのソファ", aoi: "キッチンのアイランド調理台" },
    { haru: "リビングの窓辺", aoi: "キッチンのアイランド調理台" },
    { haru: "リビングのローテーブル", aoi: "ダイニングの食卓" },
    { haru: "ダイニングの食卓", aoi: "玄関のラグ" },
  ],
  night: [
    { haru: "自室", aoi: "自室の作業机" },
    { haru: "自室の作業机", aoi: "自室" },
    { haru: "洗面室", aoi: "浴室" },
    { haru: "リビングのソファ", aoi: "リビングの窓辺" },
  ],
} as const satisfies Record<Phase, readonly PhaseStartLocations[]>;

type LocationZone =
  | "male_room"
  | "female_room"
  | "entry"
  | "washroom"
  | "hallway"
  | "bathroom"
  | "kitchen"
  | "dining"
  | "living"
  | "balcony"
  | `unknown:${string}`;

type LocationDestination = `${LocationZone}:${string}`;

function containsAny(value: string, values: readonly string[]): boolean {
  return values.some((candidate) => value.includes(candidate));
}

/** Mirrors the renderer's coarse room routing so a synonym such as
 * `キッチン` does not count as movement to `キッチンのアイランド調理台`.
 */
function locationZone(location: string, characterId: CharacterId): LocationZone {
  const value = location.trim().toLowerCase();
  if (containsAny(value, ["キッチン", "台所", "kitchen"])) return "kitchen";
  if (containsAny(value, ["ダイニング", "食卓", "dining"])) return "dining";
  if (containsAny(value, ["ベランダ", "バルコニー", "洗濯", "ランドリー", "balcony", "laundry"])) return "balcony";
  if (containsAny(value, ["洗面", "身支度", "washroom"])) return "washroom";
  if (containsAny(value, ["風呂", "浴室", "bathroom"])) return "bathroom";
  if (containsAny(value, ["玄関", "帰宅", "外出", "entry"])) return "entry";
  if (containsAny(value, ["廊下", "hallway"])) return "hallway";
  if (containsAny(value, ["リビング", "living"])) return "living";
  if (containsAny(value, ["female_room", "famale_room", "aoi", "アオイ"])) return "female_room";
  if (containsAny(value, ["male_room", "haru", "ハル"])) return "male_room";
  if (containsAny(value, ["作業机", "デスク", "自室", "寝室", "部屋", "desk", "room"])) {
    return characterId === "haru" ? "male_room" : "female_room";
  }
  return `unknown:${value}`;
}

function locationDestination(location: string, characterId: CharacterId): LocationDestination {
  const value = location.trim().toLowerCase();
  const zone = locationZone(location, characterId);
  if (containsAny(value, ["ソファ", "sofa"])) return `${zone}:sofa`;
  if (containsAny(value, ["ローテーブル", "coffee table"])) return `${zone}:low-table`;
  if (containsAny(value, ["作業机", "デスク", "desk"])) return `${zone}:work-desk`;
  if (containsAny(value, ["アイランド", "キッチン台", "調理台", "カウンター", "island", "counter"])) return `${zone}:counter`;
  if (containsAny(value, ["洗濯スペース", "洗濯ラック", "ランドリー", "laundry"])) return `${zone}:laundry-rack`;
  if (containsAny(value, ["窓", "window"])) return `${zone}:window`;
  if (containsAny(value, ["入口", "ドア", "door"])) return `${zone}:door`;
  if (containsAny(value, ["テーブル", "食卓", "table"])) return `${zone}:table`;
  // A plain kitchen label resolves to the island-side room stand in the UI.
  if (zone === "kitchen") return `${zone}:counter`;
  return `${zone}:stand`;
}

function seedHash(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function phaseStartLocations(input: {
  seed: string;
  day: number;
  phase: Phase;
  current: PhaseStartLocations;
}): PhaseStartLocations {
  const options = PHASE_START_LOCATION_OPTIONS[input.phase];
  // The first two entries stay faithful to the public daily plan. Advancing
  // one day alternates their furniture-level destination; later entries are
  // plausible fallbacks when the preceding event already ended at that spot.
  const primaryOptionCount = 2;
  const startIndex = (seedHash(input.seed) + Math.max(1, input.day) - 1) % primaryOptionCount;
  const selected = {} as PhaseStartLocations;

  for (const characterId of ["haru", "aoi"] as const) {
    const currentDestination = locationDestination(input.current[characterId], characterId);
    let location = options[startIndex]![characterId];
    for (let offset = 0; offset < options.length; offset += 1) {
      const candidate = options[(startIndex + offset) % options.length]![characterId];
      if (locationDestination(candidate, characterId) !== currentDestination) {
        location = candidate;
        break;
      }
    }
    selected[characterId] = location;
  }

  return selected;
}
