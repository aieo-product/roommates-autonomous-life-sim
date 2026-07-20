export const ASSET_MANAGER_FORMAT = "roommates.project" as const;
export const ASSET_MANAGER_FORMAT_VERSION = 1 as const;
export const ASSET_MANAGER_STORAGE_KEY = "roommates.asset-manager.project.v1";

export const ROOM_IDS = [
  "haru_room",
  "aoi_room",
  "entry",
  "washroom",
  "hallway",
  "bathroom",
  "kitchen",
  "dining",
  "living",
  "balcony",
] as const;

export const ASSET_ORIENTATIONS = [
  "south-west-to-north-east",
  "south-east-to-north-west",
  "north-east-to-south-west",
  "north-west-to-south-east",
] as const;

export type AssetKind = "furniture" | "characters";
export type AssetOrientation = (typeof ASSET_ORIENTATIONS)[number];
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Bounds = Point & Size;

export type AssetRender = {
  canvas: Size;
  contentBounds?: Bounds;
  pivot: Point;
  flipX: boolean;
  flipY: boolean;
  fitScale: number;
};

export type ManagedFurnitureAsset = {
  id: string;
  label: string;
  file: string;
  imageUrl: string;
  footprintTiles: { width: number; depth: number };
  orientation: AssetOrientation;
  anchorIds: string[];
  render: AssetRender;
};

export type ManagedCharacterAsset = {
  id: string;
  label: string;
  runtimeId?: "haru" | "aoi" | "navigator";
  role: string;
  animationPreset: string;
  file: string;
  imageUrl: string;
  portraitFile: string;
  portraitUrl: string;
  footprintTiles: { width: number; depth: number };
  orientation: AssetOrientation;
  render: AssetRender;
};

export type ManagedPlacement = {
  instanceId: string;
  assetId: string;
  roomId: string;
  floorContact: Point;
  orientation?: AssetOrientation;
  flipX?: boolean;
  flipY?: boolean;
};

export type AssetManagerDocument = {
  format: typeof ASSET_MANAGER_FORMAT;
  formatVersion: typeof ASSET_MANAGER_FORMAT_VERSION;
  id: string;
  name: string;
  assets: {
    furniture: ManagedFurnitureAsset[];
    characters: ManagedCharacterAsset[];
  };
  placements: {
    furniture: ManagedPlacement[];
    characters: ManagedPlacement[];
  };
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export class AssetManagerValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "AssetManagerValidationError";
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const isSafeImageSource = (value: string): boolean => {
  const source = value.trim();
  if (!source) return false;
  if (/^(?:javascript|vbscript):/i.test(source)) return false;
  if (/^data:/i.test(source)) return /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(source);
  return /^(?:https?:|blob:|\/|\.\/|\.\.\/)/i.test(source);
};

const validatePoint = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  range?: { minX: number; maxX: number; minY: number; maxY: number },
): void => {
  if (!isRecord(value)) {
    issues.push({ path, message: "x と y を持つオブジェクトが必要です" });
    return;
  }
  if (!finiteNumber(value.x)) {
    issues.push({ path: `${path}.x`, message: "有限の数値を指定してください" });
  } else if (range && (value.x < range.minX || value.x > range.maxX)) {
    issues.push({ path: `${path}.x`, message: `${range.minX}〜${range.maxX} の範囲で指定してください` });
  }
  if (!finiteNumber(value.y)) {
    issues.push({ path: `${path}.y`, message: "有限の数値を指定してください" });
  } else if (range && (value.y < range.minY || value.y > range.maxY)) {
    issues.push({ path: `${path}.y`, message: `${range.minY}〜${range.maxY} の範囲で指定してください` });
  }
};

const validateRender = (value: unknown, path: string, issues: ValidationIssue[]): void => {
  if (!isRecord(value)) {
    issues.push({ path, message: "render 設定が必要です" });
    return;
  }

  if (!isRecord(value.canvas)) {
    issues.push({ path: `${path}.canvas`, message: "canvas の width / height が必要です" });
  } else {
    for (const axis of ["width", "height"] as const) {
      const dimension = value.canvas[axis];
      if (!finiteNumber(dimension) || dimension <= 0 || dimension > 8192) {
        issues.push({ path: `${path}.canvas.${axis}`, message: "1〜8192 の数値を指定してください" });
      }
    }
  }

  validatePoint(value.pivot, `${path}.pivot`, issues, {
    minX: -8192,
    maxX: 8192,
    minY: -8192,
    maxY: 8192,
  });

  if (value.contentBounds !== undefined) {
    if (!isRecord(value.contentBounds)) {
      issues.push({ path: `${path}.contentBounds`, message: "x / y / width / height が必要です" });
    } else {
      validatePoint(value.contentBounds, `${path}.contentBounds`, issues, {
        minX: 0,
        maxX: 8192,
        minY: 0,
        maxY: 8192,
      });
      for (const axis of ["width", "height"] as const) {
        const dimension = value.contentBounds[axis];
        if (!finiteNumber(dimension) || dimension <= 0 || dimension > 8192) {
          issues.push({ path: `${path}.contentBounds.${axis}`, message: "1〜8192 の数値を指定してください" });
        }
      }
      if (
        isRecord(value.canvas)
        && finiteNumber(value.canvas.width)
        && finiteNumber(value.canvas.height)
        && finiteNumber(value.contentBounds.x)
        && finiteNumber(value.contentBounds.y)
        && finiteNumber(value.contentBounds.width)
        && finiteNumber(value.contentBounds.height)
      ) {
        if (value.contentBounds.x + value.contentBounds.width > value.canvas.width) {
          issues.push({ path: `${path}.contentBounds.width`, message: "content bounds が canvas 幅を超えています" });
        }
        if (value.contentBounds.y + value.contentBounds.height > value.canvas.height) {
          issues.push({ path: `${path}.contentBounds.height`, message: "content bounds が canvas 高さを超えています" });
        }
      }
    }
  }

  if (typeof value.flipX !== "boolean") {
    issues.push({ path: `${path}.flipX`, message: "true または false が必要です" });
  }
  if (typeof value.flipY !== "boolean") {
    issues.push({ path: `${path}.flipY`, message: "true または false が必要です" });
  }
  if (!finiteNumber(value.fitScale) || value.fitScale < 0.1 || value.fitScale > 4) {
    issues.push({ path: `${path}.fitScale`, message: "0.1〜4 の数値を指定してください" });
  }
};

const validateBaseAsset = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  ids: Set<string>,
): value is Record<string, unknown> => {
  if (!isRecord(value)) {
    issues.push({ path, message: "asset はオブジェクトで指定してください" });
    return false;
  }

  if (!nonEmptyString(value.id) || !/^[a-z0-9][a-z0-9_-]*$/i.test(value.id)) {
    issues.push({ path: `${path}.id`, message: "英数字・ハイフン・アンダースコアで ID を指定してください" });
  } else if (ids.has(value.id)) {
    issues.push({ path: `${path}.id`, message: `ID「${value.id}」が重複しています` });
  } else {
    ids.add(value.id);
  }
  if (!nonEmptyString(value.label)) {
    issues.push({ path: `${path}.label`, message: "表示名を入力してください" });
  }
  if (!nonEmptyString(value.file)) {
    issues.push({ path: `${path}.file`, message: "portable pack 用の相対 file が必要です" });
  }
  if (!nonEmptyString(value.imageUrl) || !isSafeImageSource(value.imageUrl)) {
    issues.push({ path: `${path}.imageUrl`, message: "HTTPS、相対パス、または画像 Data URL を指定してください" });
  }
  if (!isRecord(value.footprintTiles)) {
    issues.push({ path: `${path}.footprintTiles`, message: "width / depth が必要です" });
  } else {
    const width = value.footprintTiles.width;
    const depth = value.footprintTiles.depth;
    if (!Number.isInteger(width) || (width as number) < 1 || (width as number) > 24) {
      issues.push({ path: `${path}.footprintTiles.width`, message: "1〜24 の整数を指定してください" });
    }
    if (!Number.isInteger(depth) || (depth as number) < 1 || (depth as number) > 18) {
      issues.push({ path: `${path}.footprintTiles.depth`, message: "1〜18 の整数を指定してください" });
    }
  }
  if (!ASSET_ORIENTATIONS.includes(value.orientation as AssetOrientation)) {
    issues.push({ path: `${path}.orientation`, message: "対応している向きを選択してください" });
  }
  validateRender(value.render, `${path}.render`, issues);
  return true;
};

const validatePlacements = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  assetIds: Set<string>,
): void => {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "配置の配列が必要です" });
    return;
  }
  const instanceIds = new Set<string>();
  value.forEach((placement, index) => {
    const itemPath = `${path}.${index}`;
    if (!isRecord(placement)) {
      issues.push({ path: itemPath, message: "配置はオブジェクトで指定してください" });
      return;
    }
    if (!nonEmptyString(placement.instanceId) || !/^[a-z0-9][a-z0-9_-]*$/i.test(placement.instanceId)) {
      issues.push({ path: `${itemPath}.instanceId`, message: "有効な instance ID を指定してください" });
    } else if (instanceIds.has(placement.instanceId)) {
      issues.push({ path: `${itemPath}.instanceId`, message: `instance ID「${placement.instanceId}」が重複しています` });
    } else {
      instanceIds.add(placement.instanceId);
    }
    if (!nonEmptyString(placement.assetId) || !assetIds.has(placement.assetId)) {
      issues.push({ path: `${itemPath}.assetId`, message: "同じ種類に登録済みの asset ID を指定してください" });
    }
    if (!nonEmptyString(placement.roomId) || !/^[a-z0-9][a-z0-9_-]*$/i.test(placement.roomId)) {
      issues.push({ path: `${itemPath}.roomId`, message: "有効な room ID を指定してください" });
    }
    validatePoint(placement.floorContact, `${itemPath}.floorContact`, issues, {
      minX: 0,
      maxX: 24,
      minY: 0,
      maxY: 18,
    });
    if (placement.orientation !== undefined && !ASSET_ORIENTATIONS.includes(placement.orientation as AssetOrientation)) {
      issues.push({ path: `${itemPath}.orientation`, message: "対応している向きを選択してください" });
    }
    if (placement.flipX !== undefined && typeof placement.flipX !== "boolean") {
      issues.push({ path: `${itemPath}.flipX`, message: "true または false が必要です" });
    }
    if (placement.flipY !== undefined && typeof placement.flipY !== "boolean") {
      issues.push({ path: `${itemPath}.flipY`, message: "true または false が必要です" });
    }
  });
};

export const validateAssetManagerDocument = (value: unknown): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path: "$", message: "JSON オブジェクトが必要です" }];
  if (value.format !== ASSET_MANAGER_FORMAT) {
    issues.push({ path: "format", message: `「${ASSET_MANAGER_FORMAT}」を指定してください` });
  }
  if (value.formatVersion !== ASSET_MANAGER_FORMAT_VERSION) {
    issues.push({ path: "formatVersion", message: `version ${ASSET_MANAGER_FORMAT_VERSION} のみ読み込めます` });
  }
  if (!nonEmptyString(value.id) || !/^[a-z0-9][a-z0-9_-]*$/i.test(value.id)) {
    issues.push({ path: "id", message: "有効な project ID を指定してください" });
  }
  if (!nonEmptyString(value.name)) {
    issues.push({ path: "name", message: "project 名を入力してください" });
  }

  if (!isRecord(value.assets)) {
    issues.push({ path: "assets", message: "furniture / characters が必要です" });
  }
  if (!isRecord(value.placements)) {
    issues.push({ path: "placements", message: "furniture / characters が必要です" });
  }

  const furnitureIds = new Set<string>();
  const characterIds = new Set<string>();
  const furniture = isRecord(value.assets) ? value.assets.furniture : undefined;
  const characters = isRecord(value.assets) ? value.assets.characters : undefined;

  if (!Array.isArray(furniture)) {
    issues.push({ path: "assets.furniture", message: "家具 asset の配列が必要です" });
  } else {
    furniture.forEach((asset, index) => {
      const path = `assets.furniture.${index}`;
      if (!validateBaseAsset(asset, path, issues, furnitureIds)) return;
      if (!Array.isArray(asset.anchorIds) || asset.anchorIds.some((id) => typeof id !== "string")) {
        issues.push({ path: `${path}.anchorIds`, message: "文字列 ID の配列が必要です" });
      }
    });
  }

  if (!Array.isArray(characters)) {
    issues.push({ path: "assets.characters", message: "character asset の配列が必要です" });
  } else {
    const runtimeIds = new Set<string>();
    characters.forEach((asset, index) => {
      const path = `assets.characters.${index}`;
      if (!validateBaseAsset(asset, path, issues, characterIds)) return;
      if (asset.runtimeId !== undefined && !["haru", "aoi", "navigator"].includes(String(asset.runtimeId))) {
        issues.push({ path: `${path}.runtimeId`, message: "haru / aoi / navigator のいずれかを指定してください" });
      } else if (typeof asset.runtimeId === "string" && runtimeIds.has(asset.runtimeId)) {
        issues.push({ path: `${path}.runtimeId`, message: `runtime slot「${asset.runtimeId}」が重複しています` });
      } else if (typeof asset.runtimeId === "string") {
        runtimeIds.add(asset.runtimeId);
      }
      if (!nonEmptyString(asset.role)) issues.push({ path: `${path}.role`, message: "role を入力してください" });
      if (!nonEmptyString(asset.animationPreset)) {
        issues.push({ path: `${path}.animationPreset`, message: "animation preset を入力してください" });
      }
      if (!nonEmptyString(asset.portraitFile)) {
        issues.push({ path: `${path}.portraitFile`, message: "portrait の相対 file が必要です" });
      }
      if (!nonEmptyString(asset.portraitUrl) || !isSafeImageSource(asset.portraitUrl)) {
        issues.push({ path: `${path}.portraitUrl`, message: "HTTPS、相対パス、または画像 Data URL を指定してください" });
      }
      const footprint = asset.footprintTiles;
      if (isRecord(footprint) && (footprint.width !== 1 || footprint.depth !== 1)) {
        issues.push({ path: `${path}.footprintTiles`, message: "character の footprint は 1 × 1 にしてください" });
      }
    });
  }

  const furniturePlacements = isRecord(value.placements) ? value.placements.furniture : undefined;
  const characterPlacements = isRecord(value.placements) ? value.placements.characters : undefined;
  validatePlacements(furniturePlacements, "placements.furniture", issues, furnitureIds);
  validatePlacements(characterPlacements, "placements.characters", issues, characterIds);
  return issues;
};

export const parseAssetManagerDocument = (value: unknown): AssetManagerDocument => {
  const issues = validateAssetManagerDocument(value);
  if (issues.length > 0) throw new AssetManagerValidationError(issues);
  return structuredClone(value) as AssetManagerDocument;
};

export const parseAssetManagerJson = (json: string): AssetManagerDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new AssetManagerValidationError([{ path: "$", message: "JSON の構文が正しくありません" }]);
  }
  return parseAssetManagerDocument(parsed);
};

export const serializeAssetManagerDocument = (document: AssetManagerDocument): string => {
  const parsed = parseAssetManagerDocument(document);
  return `${JSON.stringify(parsed, null, 2)}\n`;
};

export const issuesForPath = (issues: ValidationIssue[], path: string): ValidationIssue[] =>
  issues.filter((issue) => issue.path === path || issue.path.startsWith(`${path}.`));
