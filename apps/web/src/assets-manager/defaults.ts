import characterManifestJson from "../../../../assets/characters/manifest.json";
import furnitureManifestJson from "../../../../assets/furniture/manifest.json";
import {
  ASSET_MANAGER_FORMAT,
  ASSET_MANAGER_FORMAT_VERSION,
  type AssetManagerDocument,
  type AssetOrientation,
  type Bounds,
  type CharacterRole,
  type CharacterRuntimeId,
  type CharacterSpriteSheet,
  type ManagedCharacterAsset,
  type ManagedFurnitureAsset,
  type ManagedPlacement,
  type Point,
  type Size,
} from "./model.js";

type RawFurnitureAsset = {
  id: string;
  label?: string;
  file: string;
  footprintTiles: { width: number; depth: number };
  orientation?: string;
  anchorIds?: string[];
  pivot?: Point;
  flipX?: boolean;
  flipY?: boolean;
  render?: {
    canvas?: Size;
    contentBounds?: Bounds;
    pivot?: Point;
    flipX?: boolean;
    flipY?: boolean;
    fitScale?: number;
  };
};

type RawFurniturePlacement = {
  instanceId: string;
  assetId: string;
  roomId: string;
  floorContact: Point;
  orientation?: string;
  flipX?: boolean;
  flipY?: boolean;
};

type RawFurnitureManifest = {
  canvas?: Size;
  pivot?: Point;
  defaultScene?: { instances?: RawFurniturePlacement[] };
  assets?: RawFurnitureAsset[];
};

type RawCharacterAsset = {
  id: string;
  name?: string;
  runtimeId?: string;
  role?: string;
  animationPreset?: string;
  relativeVisualHeight?: number;
  portrait: string;
  sheet: string;
  footprintTiles?: { width: number; depth?: number; height?: number };
  orientation?: string;
  render?: {
    canvas?: Size;
    contentBounds?: Bounds;
    pivot?: Point;
    flipX?: boolean;
    flipY?: boolean;
    fitScale?: number;
  };
  spriteSheet?: CharacterSpriteSheet;
  placement?: {
    instanceId?: string;
    roomId: string;
    floorContact: Point;
    orientation?: string;
    flipX?: boolean;
    flipY?: boolean;
  };
};

type RawCharacterManifest = {
  frameSize?: Size;
  pivot?: Point;
  logicalTileFootprint?: { width: number; height: number };
  sheet?: { width: number; height: number; columns: number; rows: number };
  directionOrder?: string[];
  frameDurationMs?: number;
  characters?: RawCharacterAsset[];
};

const furnitureFiles = import.meta.glob<string>(
  "../../../../assets/furniture/*.png",
  { eager: true, query: "?url", import: "default" },
);
const characterFiles = import.meta.glob<string>(
  "../../../../assets/characters/**/*.png",
  { eager: true, query: "?url", import: "default" },
);

const fileName = (path: string): string => path.split("/").at(-1) ?? path;

const furnitureUrlByFile = new Map(
  Object.entries(furnitureFiles).map(([path, url]) => [fileName(path), url]),
);

const characterUrlFor = (relativeFile: string): string => {
  const normalized = relativeFile.replace(/^\.\//, "");
  const entry = Object.entries(characterFiles).find(([path]) => path.endsWith(`/${normalized}`));
  return entry?.[1] ?? `/assets/characters/${normalized}`;
};

const asOrientation = (value: string | undefined): AssetOrientation => {
  switch (value) {
    case "south-east-to-north-west":
    case "north-east-to-south-west":
    case "north-west-to-south-east":
      return value;
    default:
      return "south-west-to-north-east";
  }
};

const humanizeAssetId = (id: string): string =>
  id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const canonicalRoomId = (roomId: string): string => {
  if (roomId === "haru_room") return "male_room";
  if (roomId === "aoi_room" || roomId === "famale_room") return "female_room";
  return roomId;
};

const runtimeIdForCharacter = (
  id: string,
  explicit?: string,
): CharacterRuntimeId | undefined => {
  if (explicit === "haru" || explicit === "aoi" || explicit === "navigator") return explicit;
  if (id === "otani-haru" || id === "haru") return "haru";
  if (id === "mizuhara-aoi" || id === "aoi") return "aoi";
  if (id === "navigator") return "navigator";
  return undefined;
};

const roleForCharacter = (
  role: string | undefined,
  runtimeId: CharacterRuntimeId | undefined,
): CharacterRole => {
  if (role === "male" || role === "female" || role === "navigator") return role;
  if (runtimeId === "aoi") return "female";
  if (runtimeId === "navigator") return "navigator";
  return "male";
};

const createSpriteSheet = (
  manifest: RawCharacterManifest,
  asset: RawCharacterAsset,
  frameSize: Size,
): CharacterSpriteSheet => {
  if (asset.spriteSheet) return structuredClone(asset.spriteSheet);
  const columns = manifest.sheet?.columns ?? 3;
  const rows = manifest.sheet?.rows ?? 4;
  const directionOrder = manifest.directionOrder ?? ["south", "east", "north", "west"];
  const directionRow = (direction: "south" | "east" | "north" | "west", fallback: number) => {
    const index = directionOrder.indexOf(direction);
    return index >= 0 ? index : fallback;
  };
  const animationPreset = asset.animationPreset ?? "walk";
  return {
    file: asset.sheet,
    canvas: {
      width: manifest.sheet?.width ?? frameSize.width * columns,
      height: manifest.sheet?.height ?? frameSize.height * rows,
    },
    frameSize: { ...frameSize },
    columns,
    rows,
    directionRows: {
      south: directionRow("south", 0),
      east: directionRow("east", 1),
      north: directionRow("north", 2),
      west: directionRow("west", 3),
    },
    animations: {
      idle: { frames: [1], frameDurationMs: manifest.frameDurationMs ?? 170, loop: true },
      [animationPreset]: {
        frames: [0, 1, 2, 1],
        frameDurationMs: manifest.frameDurationMs ?? 170,
        loop: true,
      },
    },
  };
};

const createFurnitureAssets = (): ManagedFurnitureAsset[] => {
  const manifest = furnitureManifestJson as unknown as RawFurnitureManifest;
  const canvas = manifest.canvas ?? { width: 256, height: 256 };
  const defaultPivot = manifest.pivot ?? { x: canvas.width / 2, y: canvas.height };

  return (manifest.assets ?? []).map((asset) => ({
    id: asset.id,
    label: asset.label?.trim() || humanizeAssetId(asset.id),
    file: asset.file,
    imageUrl: furnitureUrlByFile.get(asset.file) ?? `/assets/furniture/${asset.file}`,
    footprintTiles: {
      width: asset.footprintTiles.width,
      depth: asset.footprintTiles.depth,
    },
    orientation: asOrientation(asset.orientation),
    anchorIds: [...(asset.anchorIds ?? [])],
    render: {
      canvas: { ...(asset.render?.canvas ?? canvas) },
      ...(asset.render?.contentBounds ? { contentBounds: { ...asset.render.contentBounds } } : {}),
      pivot: { ...(asset.render?.pivot ?? asset.pivot ?? defaultPivot) },
      flipX: asset.render?.flipX ?? asset.flipX ?? false,
      flipY: asset.render?.flipY ?? asset.flipY ?? false,
      fitScale: asset.render?.fitScale ?? 1,
    },
  }));
};

const createFurniturePlacements = (): ManagedPlacement[] => {
  const manifest = furnitureManifestJson as unknown as RawFurnitureManifest;
  return (manifest.defaultScene?.instances ?? []).map((placement) => ({
    instanceId: placement.instanceId,
    assetId: placement.assetId,
    roomId: canonicalRoomId(placement.roomId),
    floorContact: { ...placement.floorContact },
    ...(placement.orientation ? { orientation: asOrientation(placement.orientation) } : {}),
    ...(placement.flipX !== undefined ? { flipX: placement.flipX } : {}),
    ...(placement.flipY !== undefined ? { flipY: placement.flipY } : {}),
  }));
};

const createCharacterAssets = (): ManagedCharacterAsset[] => {
  const manifest = characterManifestJson as unknown as RawCharacterManifest;
  const frameSize = manifest.frameSize ?? { width: 128, height: 128 };
  const defaultPivot = manifest.pivot ?? { x: frameSize.width / 2, y: frameSize.height };
  const logicalFootprint = manifest.logicalTileFootprint ?? { width: 1, height: 1 };

  return (manifest.characters ?? []).map((asset) => {
    const runtimeId = runtimeIdForCharacter(asset.id, asset.runtimeId);
    const width = asset.footprintTiles?.width ?? logicalFootprint.width;
    const depth = asset.footprintTiles?.depth
      ?? asset.footprintTiles?.height
      ?? logicalFootprint.height;
    return {
      id: asset.id,
      label: asset.name?.trim() || humanizeAssetId(asset.id),
      runtimeId,
      role: roleForCharacter(asset.role, runtimeId),
      animationPreset: asset.animationPreset ?? "walk",
      file: asset.sheet,
      imageUrl: characterUrlFor(asset.sheet),
      portraitFile: asset.portrait,
      portraitUrl: characterUrlFor(asset.portrait),
      footprintTiles: { width, depth },
      orientation: asOrientation(asset.orientation),
      render: {
        canvas: { ...(asset.render?.canvas ?? frameSize) },
        ...(asset.render?.contentBounds ? { contentBounds: { ...asset.render.contentBounds } } : {}),
        pivot: { ...(asset.render?.pivot ?? defaultPivot) },
        flipX: asset.render?.flipX ?? false,
        flipY: asset.render?.flipY ?? false,
        fitScale: asset.render?.fitScale ?? asset.relativeVisualHeight ?? 1,
      },
      spriteSheet: createSpriteSheet(manifest, asset, asset.render?.canvas ?? frameSize),
    };
  });
};

const defaultCharacterPlacement = (
  asset: ManagedCharacterAsset,
  index: number,
): ManagedPlacement => {
  const defaults: Record<string, { roomId: string; floorContact: Point }> = {
    haru: { roomId: "male_room", floorContact: { x: 4.3, y: 4.8 } },
    aoi: { roomId: "female_room", floorContact: { x: 12.2, y: 4.8 } },
    navigator: { roomId: "living", floorContact: { x: 17.5, y: 11.5 } },
  };
  const fallback = { roomId: "living", floorContact: { x: 18 + index, y: 13 } };
  const rawAsset = (characterManifestJson as unknown as RawCharacterManifest).characters
    ?.find((candidate) => candidate.id === asset.id);
  const placement = rawAsset?.placement
    ?? (asset.runtimeId ? defaults[asset.runtimeId] ?? fallback : fallback);
  return {
    instanceId: rawAsset?.placement?.instanceId ?? `${asset.id}-start`,
    assetId: asset.id,
    roomId: canonicalRoomId(placement.roomId),
    floorContact: { ...placement.floorContact },
    ...(rawAsset?.placement?.orientation
      ? { orientation: asOrientation(rawAsset.placement.orientation) }
      : {}),
    ...(rawAsset?.placement?.flipX !== undefined ? { flipX: rawAsset.placement.flipX } : {}),
    ...(rawAsset?.placement?.flipY !== undefined ? { flipY: rawAsset.placement.flipY } : {}),
  };
};

export const createDefaultAssetManagerDocument = (): AssetManagerDocument => {
  const characters = createCharacterAssets();
  return {
    format: ASSET_MANAGER_FORMAT,
    formatVersion: ASSET_MANAGER_FORMAT_VERSION,
    id: "roommates-default-room",
    name: "ROOMMATES Default Room",
    assets: {
      furniture: createFurnitureAssets(),
      characters,
    },
    placements: {
      furniture: createFurniturePlacements(),
      characters: characters.map(defaultCharacterPlacement),
    },
  };
};
