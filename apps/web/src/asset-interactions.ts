import type { CharacterId, Point, RoomId } from "./room-layout.js";

type AssetInteractionSource = {
  id: string;
  label: string;
  anchorIds: string[];
  footprintTiles: { width: number; depth: number };
};

type AssetInteractionPlacement = {
  instanceId: string;
  assetId: string;
  roomId: string;
  floorContact: Point;
};

export type AssetInteractionDocument = {
  assets: { furniture: AssetInteractionSource[] };
  placements: { furniture: AssetInteractionPlacement[] };
};

export type AssetInteractionAnchor = {
  id: string;
  assetId: string;
  label: string;
  roomId: RoomId;
  tags: string[];
  floorContact: Point;
  footprintTiles: { width: number; depth: number };
};

const GENERIC_TAGS = new Set([
  "asset", "room", "resident", "male", "female", "haru", "aoi",
  "living", "kitchen", "dining", "entry", "washroom", "bathroom",
  "balcony", "hallway",
]);

const TAG_ALIASES: Record<string, string[]> = {
  bed: ["ベッド", "寝床"],
  desk: ["デスク", "机", "作業机"],
  sofa: ["ソファ"],
  table: ["テーブル", "食卓"],
  island: ["アイランド", "調理台", "キッチン台", "カウンター"],
  refrigerator: ["冷蔵庫"],
  bathtub: ["浴槽", "バスタブ", "お風呂"],
  vanity: ["洗面台", "洗面"],
  rug: ["ラグ", "玄関マット"],
  rack: ["ラック", "物干し", "洗濯"],
  chair: ["椅子", "チェア"],
  tv: ["テレビ"],
};

const normalize = (value: string): string => value
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[_/.-]+/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();

const searchableTags = (asset: AssetInteractionSource, placement: AssetInteractionPlacement): string[] => {
  const raw = [asset.id, asset.label, placement.instanceId, ...asset.anchorIds]
    .map(normalize)
    .filter(Boolean);
  const words = raw.flatMap((value) => value.split(" "))
    .filter((value) => value.length >= 2 && !GENERIC_TAGS.has(value));
  const aliases = words.flatMap((word) => TAG_ALIASES[word] ?? []);
  return [...new Set([...raw, ...words, ...aliases].filter((value) => value.length >= 2))];
};

export const createAssetInteractionAnchors = (
  document: AssetInteractionDocument,
  validRoomIds: ReadonlySet<string>,
): AssetInteractionAnchor[] => {
  const assets = new Map(document.assets.furniture.map((asset) => [asset.id, asset]));
  return document.placements.furniture.flatMap((placement) => {
    const asset = assets.get(placement.assetId);
    if (!asset || !validRoomIds.has(placement.roomId)) return [];
    return [{
      id: placement.instanceId,
      assetId: asset.id,
      label: asset.label,
      roomId: placement.roomId as RoomId,
      tags: searchableTags(asset, placement),
      floorContact: { ...placement.floorContact },
      footprintTiles: { ...asset.footprintTiles },
    }];
  });
};

export const findAssetInteractionAnchor = (
  text: string,
  anchors: readonly AssetInteractionAnchor[],
  roomId?: RoomId,
): AssetInteractionAnchor | undefined => {
  const haystack = normalize(text);
  if (!haystack) return undefined;
  return anchors
    .filter((anchor) => !roomId || anchor.roomId === roomId)
    .map((anchor) => ({
      anchor,
      score: Math.max(0, ...anchor.tags.map((tag) => haystack.includes(normalize(tag)) ? tag.length : 0)),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0]?.anchor;
};

/**
 * Returns a 1x1 resident floor-contact point immediately outside an asset's
 * registered footprint. The two runtime residents use opposite sides so a
 * shared action remains readable and collision-free.
 */
export const interactionStandPoint = (
  anchor: AssetInteractionAnchor,
  person: CharacterId,
): Point => {
  const left = anchor.floorContact.x - anchor.footprintTiles.width;
  const top = anchor.floorContact.y - anchor.footprintTiles.depth;
  const centerY = top + anchor.footprintTiles.depth / 2;
  return person === "haru"
    ? { x: left - 0.55, y: centerY }
    : { x: anchor.floorContact.x + 0.55, y: centerY };
};

