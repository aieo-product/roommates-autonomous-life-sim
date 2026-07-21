export type CharacterDisplayNames = Record<"haru" | "aoi", string>;

type CharacterDisplayNameSource = Record<
  "haru" | "aoi",
  string | { name: string }
>;

export type CharacterDisplayRoster = Partial<Record<
  "haru" | "aoi",
  { displayName?: string }
>>;
export type CharacterDisplayRosterSource =
  | CharacterDisplayRoster
  | readonly CharacterDisplayRoster[];

const BASE_ALIASES: Record<"haru" | "aoi", string[]> = {
  haru: ["Haru", "ハル", "住人1", "住人１"],
  aoi: ["Aoi", "アオイ", "住人2", "住人２"],
};

const displayNamesFrom = (
  source: CharacterDisplayNameSource,
): CharacterDisplayNames => ({
  haru: typeof source.haru === "string" ? source.haru : source.haru.name,
  aoi: typeof source.aoi === "string" ? source.aoi : source.aoi.name,
});

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const aliasPattern = (value: string): string => {
  const escaped = escapeRegExp(value);
  return /^[A-Za-z0-9_][A-Za-z0-9_ .'-]*[A-Za-z0-9_]$/u.test(value)
    || /^[A-Za-z0-9_]$/u.test(value)
    ? `\\b${escaped}\\b`
    : escaped;
};

/**
 * Rewrites legacy public slot labels at the last presentation boundary.
 * Structured actor/speaker IDs never pass through this function and remain
 * the stable `haru | aoi` runtime contract.
 */
export function formatCharacterDisplayText(
  value: string,
  source: CharacterDisplayNameSource,
  eventRoster?: CharacterDisplayRosterSource,
): string;
export function formatCharacterDisplayText(
  value: undefined,
  source: CharacterDisplayNameSource,
  eventRoster?: CharacterDisplayRosterSource,
): undefined;
export function formatCharacterDisplayText(
  value: string | undefined,
  source: CharacterDisplayNameSource,
  eventRoster?: CharacterDisplayRosterSource,
): string | undefined;
export function formatCharacterDisplayText(
  value: string | undefined,
  source: CharacterDisplayNameSource,
  eventRoster?: CharacterDisplayRosterSource,
): string | undefined {
  if (value === undefined || value === "") return value;
  const names = displayNamesFrom(source);

  // Protect text that already contains the configured display names. This
  // avoids expanding a valid name such as "Haru Jr." into "Haru Jr. Jr.".
  const protectedNames: string[] = [];
  let protectedText = value;
  const currentNames = [...new Set([names.haru, names.aoi])]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const name of currentNames) {
    const marker = `\uE000ROOMMATES_NAME_${protectedNames.length}\uE001`;
    if (!protectedText.includes(name)) continue;
    protectedNames.push(name);
    protectedText = protectedText.split(name).join(marker);
  }

  const aliasToSlot = new Map<string, "haru" | "aoi">();
  const aliases: string[] = [];
  const addAlias = (slot: "haru" | "aoi", alias: string | undefined): void => {
    const trimmed = alias?.trim();
    if (!trimmed) return;
    const key = trimmed.toLocaleLowerCase("en-US");
    if (aliasToSlot.has(key)) return;
    aliasToSlot.set(key, slot);
    aliases.push(trimmed);
  };
  const rosters = eventRoster
    ? Array.isArray(eventRoster) ? eventRoster : [eventRoster]
    : [];
  for (const roster of rosters) {
    addAlias("haru", roster.haru?.displayName);
    addAlias("aoi", roster.aoi?.displayName);
  }
  for (const slot of ["haru", "aoi"] as const) {
    for (const alias of BASE_ALIASES[slot]) addAlias(slot, alias);
  }
  aliases.sort((left, right) => right.length - left.length);
  const aliasMatcher = new RegExp(
    [...new Set(aliases.map(aliasPattern))].join("|"),
    "giu",
  );
  const formatted = protectedText.replace(aliasMatcher, (legacyName) => {
    const slot = aliasToSlot.get(legacyName.toLocaleLowerCase("en-US"));
    return slot ? names[slot] : legacyName;
  });
  return protectedNames.reduce(
    (text, name, index) => text.split(`\uE000ROOMMATES_NAME_${index}\uE001`).join(name),
    formatted,
  );
}
