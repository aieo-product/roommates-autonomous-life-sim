/**
 * Shared world-grid contract for placeable furniture and characters.
 *
 * The world is stored as square logical cells. Rendering is only a projection
 * of that data: one cell becomes a 50 x 25 isometric diamond in the apartment
 * SVG. Keeping the projection here lets asset packs replace PNGs without
 * baking screen coordinates or display scales into room data.
 */

export type GridPoint = {
  x: number;
  y: number;
};

export type GridFootprint = {
  width: number;
  depth: number;
};

export type PixelSize = {
  width: number;
  height: number;
};

export type PixelBounds = GridPoint & PixelSize;

export type WorldGridSpec = {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  origin: GridPoint;
};

export type ManifestGridSpec = Omit<WorldGridSpec, "origin"> & {
  characterFootprint: GridFootprint;
};

export const ASSET_MANIFEST_FORMAT = "roommates-grid-assets" as const;
export const ASSET_MANIFEST_VERSION = 5 as const;
export const LEGACY_ASSET_MANIFEST_VERSION = 4 as const;

/** Canonical ROOMMATES apartment grid and its 2:1 isometric projection. */
export const WORLD_GRID = {
  columns: 24,
  rows: 18,
  tileWidth: 50,
  tileHeight: 25,
  origin: { x: 600, y: 100 },
} as const satisfies WorldGridSpec;

/** Every resident occupies the same single square cell as a 1 x 1 asset. */
export const CHARACTER_GRID_FOOTPRINT = {
  width: 1,
  depth: 1,
} as const satisfies GridFootprint;

export const CHARACTER_ASSET_CONTRACT = {
  footprintTiles: CHARACTER_GRID_FOOTPRINT,
  floorContact: "bottom-center",
  projection: "2:1-isometric",
} as const;

export type AssetRenderSpec = {
  /** Source-canvas pixel placed on the instance's projected floorContact. */
  pivot?: GridPoint;
  /** Opaque/content bounds in source-canvas pixels, including x/y offset. */
  contentBounds?: PixelBounds;
  /** Mirrors the source around its floor contact without changing placement. */
  flipX?: boolean;
  /** Optional artistic multiplier applied after automatic footprint fitting. */
  fitScale?: number;
};

export type GridAssetDefinition<AssetId extends string = string> = {
  id: AssetId;
  file: string;
  footprintTiles: GridFootprint;
  orientation?: string;
  anchorIds?: string[];
  render?: AssetRenderSpec;

  /** @deprecated v4 compatibility. Move these values under `render`. */
  pivot?: GridPoint;
  /** @deprecated v4 compatibility. Move this value under `render`. */
  flipX?: boolean;
};

export type GridAssetInstance<AssetId extends string = string> = {
  instanceId: string;
  assetId: AssetId;
  roomId: string;
  anchorId?: string;
  floorContact: GridPoint;

  /** @deprecated v4 compatibility. v5 derives this from content + footprint. */
  displayScale?: number;
};

export type GridAssetManifest<AssetId extends string = string> = {
  version: number;
  format?: typeof ASSET_MANIFEST_FORMAT;
  /** Deprecated persisted room IDs mapped to canonical IDs at load time. */
  roomIdAliases?: Readonly<Record<string, string>>;
  grid?: ManifestGridSpec;
  projection?: {
    type?: string;
    tileRatio?: string;
    camera?: string;
    origin?: string;
  };
  canvas: PixelSize;
  pivot?: GridPoint;
  recommendedDisplayScale?: number;
  assets: Array<GridAssetDefinition<AssetId>>;
  defaultScene: {
    viewBox?: PixelSize;
    instances: Array<GridAssetInstance<AssetId>>;
  };
};

export type ResolvedAssetRender = {
  canvas: PixelSize;
  contentBounds: PixelBounds;
  pivot: GridPoint;
  flipX: boolean;
  scale: number;
  scaleSource: "footprint" | "legacy-instance" | "legacy-manifest";
};

export type AssetSpriteFrame = ResolvedAssetRender & {
  floorContact: GridPoint;
  x: number;
  y: number;
  width: number;
  height: number;
  transform?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPositiveNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value > 0;

const isGridPoint = (value: unknown): value is GridPoint =>
  isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const isPixelSize = (value: unknown): value is PixelSize =>
  isRecord(value) && isPositiveNumber(value.width) && isPositiveNumber(value.height);

const isFootprint = (value: unknown): value is GridFootprint =>
  isRecord(value)
  && Number.isInteger(value.width)
  && Number.isInteger(value.depth)
  && isPositiveNumber(value.width)
  && isPositiveNumber(value.depth);

const isPixelBounds = (value: unknown): value is PixelBounds =>
  isRecord(value)
  && isFiniteNumber(value.x)
  && isFiniteNumber(value.y)
  && isPositiveNumber(value.width)
  && isPositiveNumber(value.height);

/** Project a logical world coordinate into the shared apartment SVG. */
export const projectGridPoint = (
  point: GridPoint,
  grid: WorldGridSpec = WORLD_GRID,
): GridPoint => ({
  x: grid.origin.x + point.x * (grid.tileWidth / 2) - point.y * (grid.tileWidth / 2),
  y: grid.origin.y + point.x * (grid.tileHeight / 2) + point.y * (grid.tileHeight / 2),
});

/** Resolve a portable manifest grid against the host scene's SVG origin. */
export const worldGridForManifest = (
  manifest: Pick<GridAssetManifest, "grid">,
  origin: GridPoint = WORLD_GRID.origin,
): WorldGridSpec => ({
  columns: manifest.grid?.columns ?? WORLD_GRID.columns,
  rows: manifest.grid?.rows ?? WORLD_GRID.rows,
  tileWidth: manifest.grid?.tileWidth ?? WORLD_GRID.tileWidth,
  tileHeight: manifest.grid?.tileHeight ?? WORLD_GRID.tileHeight,
  origin,
});

/** Width of a rectangular cell footprint after a 2:1 isometric projection. */
export const projectedFootprintWidth = (
  footprint: GridFootprint,
  grid: Pick<WorldGridSpec, "tileWidth"> = WORLD_GRID,
): number => (footprint.width + footprint.depth) * (grid.tileWidth / 2);

/**
 * Fit the visible source width to the projected footprint width.
 *
 * Vertical pixels intentionally do not participate: furniture and residents
 * rise above the floor plane, while their width is what represents occupied
 * square cells. `fitScale` is a small art-direction multiplier, not a stored
 * absolute display scale.
 */
export const computeFootprintFitScale = (
  footprint: GridFootprint,
  contentBounds: Pick<PixelBounds, "width">,
  fitScale = 1,
  grid: Pick<WorldGridSpec, "tileWidth"> = WORLD_GRID,
): number => {
  if (!isFootprint(footprint)) {
    throw new Error("footprintTiles must contain positive integer width/depth");
  }
  if (!isPositiveNumber(contentBounds.width)) {
    throw new Error("contentBounds.width must be a positive number");
  }
  if (!isPositiveNumber(fitScale)) {
    throw new Error("render.fitScale must be a positive number");
  }

  return (projectedFootprintWidth(footprint, grid) / contentBounds.width) * fitScale;
};

/** Alias used by asset-pack tooling. */
export const fitAssetToFootprint = computeFootprintFitScale;

const fullCanvasBounds = (canvas: PixelSize): PixelBounds => ({
  x: 0,
  y: 0,
  width: canvas.width,
  height: canvas.height,
});

const bottomCenter = (bounds: PixelBounds): GridPoint => ({
  x: bounds.x + bounds.width / 2,
  y: bounds.y + bounds.height,
});

/** Resolve v5 render metadata while retaining read compatibility with v4. */
export const resolveAssetRender = <AssetId extends string>(
  manifest: GridAssetManifest<AssetId>,
  asset: GridAssetDefinition<AssetId>,
  instance?: GridAssetInstance<AssetId>,
  grid?: WorldGridSpec,
): ResolvedAssetRender => {
  const resolvedGrid = grid ?? worldGridForManifest(manifest);
  const contentBounds = asset.render?.contentBounds ?? fullCanvasBounds(manifest.canvas);
  const pivot = asset.render?.pivot
    ?? asset.pivot
    ?? manifest.pivot
    ?? bottomCenter(contentBounds);
  const flipX = asset.render?.flipX ?? asset.flipX ?? false;
  const automaticScale = computeFootprintFitScale(
    asset.footprintTiles,
    contentBounds,
    asset.render?.fitScale ?? 1,
    resolvedGrid,
  );

  if (manifest.version < ASSET_MANIFEST_VERSION && isPositiveNumber(instance?.displayScale)) {
    return {
      canvas: manifest.canvas,
      contentBounds,
      pivot,
      flipX,
      scale: instance.displayScale,
      scaleSource: "legacy-instance",
    };
  }

  if (manifest.version < ASSET_MANIFEST_VERSION && isPositiveNumber(manifest.recommendedDisplayScale)) {
    return {
      canvas: manifest.canvas,
      contentBounds,
      pivot,
      flipX,
      scale: manifest.recommendedDisplayScale,
      scaleSource: "legacy-manifest",
    };
  }

  return {
    canvas: manifest.canvas,
    contentBounds,
    pivot,
    flipX,
    scale: automaticScale,
    scaleSource: "footprint",
  };
};

/** Anchor a resolved source canvas to one projected floor-contact pixel. */
export const resolveAssetSpriteFrame = (
  floorContact: GridPoint,
  render: ResolvedAssetRender,
): AssetSpriteFrame => {
  const width = render.canvas.width * render.scale;
  const height = render.canvas.height * render.scale;
  const mirroredPivotX = render.flipX
    ? render.canvas.width - render.pivot.x
    : render.pivot.x;
  const x = floorContact.x - mirroredPivotX * render.scale;
  const y = floorContact.y - render.pivot.y * render.scale;

  return {
    ...render,
    floorContact,
    x,
    y,
    width,
    height,
    transform: render.flipX
      ? `translate(${2 * x + width} 0) scale(-1 1)`
      : undefined,
  };
};

/** Collect actionable asset-pack problems without throwing. */
export const collectAssetManifestIssues = (
  value: unknown,
  grid?: WorldGridSpec,
): string[] => {
  const issues: string[] = [];
  if (!isRecord(value)) return ["manifest must be an object"];

  if (!Number.isInteger(value.version) || !isPositiveNumber(value.version)) {
    issues.push("version must be a positive integer");
  }

  const isV5 = isFiniteNumber(value.version) && value.version >= ASSET_MANIFEST_VERSION;
  if (isV5 && value.format !== ASSET_MANIFEST_FORMAT) {
    issues.push(`format must be "${ASSET_MANIFEST_FORMAT}" for v5`);
  }

  if (value.roomIdAliases !== undefined) {
    if (!isRecord(value.roomIdAliases)) {
      issues.push("roomIdAliases must map legacy room IDs to canonical room IDs");
    } else {
      for (const [legacyId, canonicalId] of Object.entries(value.roomIdAliases)) {
        if (legacyId.trim() === "" || typeof canonicalId !== "string" || canonicalId.trim() === "") {
          issues.push("roomIdAliases must map non-empty room IDs to non-empty room IDs");
          break;
        }
      }
    }
  }

  let manifestGrid: ManifestGridSpec | undefined;
  if (value.grid !== undefined) {
    if (!isRecord(value.grid)
      || !Number.isInteger(value.grid.columns)
      || !Number.isInteger(value.grid.rows)
      || !isPositiveNumber(value.grid.columns)
      || !isPositiveNumber(value.grid.rows)
      || !isPositiveNumber(value.grid.tileWidth)
      || !isPositiveNumber(value.grid.tileHeight)
      || !isFootprint(value.grid.characterFootprint)) {
      issues.push("grid must define positive columns/rows/tileWidth/tileHeight and characterFootprint");
    } else {
      manifestGrid = value.grid as unknown as ManifestGridSpec;
      if (manifestGrid.characterFootprint.width !== CHARACTER_GRID_FOOTPRINT.width
        || manifestGrid.characterFootprint.depth !== CHARACTER_GRID_FOOTPRINT.depth) {
        issues.push("grid.characterFootprint must be 1x1");
      }
    }
  } else if (isV5) {
    issues.push("grid is required for v5 manifests");
  }
  const validationGrid = grid ?? (manifestGrid
    ? { ...manifestGrid, origin: WORLD_GRID.origin }
    : WORLD_GRID);

  if (!isPixelSize(value.canvas)) {
    issues.push("canvas must contain positive width/height");
  }
  const canvas = isPixelSize(value.canvas) ? value.canvas : undefined;

  if (!Array.isArray(value.assets)) {
    issues.push("assets must be an array");
  }
  if (!isRecord(value.defaultScene) || !Array.isArray(value.defaultScene.instances)) {
    issues.push("defaultScene.instances must be an array");
  }

  const assetIds = new Set<string>();
  const assetFootprints = new Map<string, GridFootprint>();
  for (const [index, candidate] of (Array.isArray(value.assets) ? value.assets : []).entries()) {
    const path = `assets[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(`${path} must be an object`);
      continue;
    }
    if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
      issues.push(`${path}.id must be a non-empty string`);
    } else if (assetIds.has(candidate.id)) {
      issues.push(`${path}.id duplicates ${candidate.id}`);
    } else {
      assetIds.add(candidate.id);
    }
    if (typeof candidate.file !== "string" || candidate.file.trim() === "") {
      issues.push(`${path}.file must be a non-empty string`);
    }
    if (!isFootprint(candidate.footprintTiles)) {
      issues.push(`${path}.footprintTiles must contain positive integer width/depth`);
    } else if (typeof candidate.id === "string") {
      assetFootprints.set(candidate.id, candidate.footprintTiles);
    }

    if (candidate.pivot !== undefined && !isGridPoint(candidate.pivot)) {
      issues.push(`${path}.pivot must contain finite x/y`);
    }
    if (candidate.flipX !== undefined && typeof candidate.flipX !== "boolean") {
      issues.push(`${path}.flipX must be boolean`);
    }
    if (candidate.render !== undefined) {
      if (!isRecord(candidate.render)) {
        issues.push(`${path}.render must be an object`);
      } else {
        const render = candidate.render;
        if (render.pivot !== undefined && !isGridPoint(render.pivot)) {
          issues.push(`${path}.render.pivot must contain finite x/y`);
        }
        if (render.flipX !== undefined && typeof render.flipX !== "boolean") {
          issues.push(`${path}.render.flipX must be boolean`);
        }
        if (render.fitScale !== undefined && !isPositiveNumber(render.fitScale)) {
          issues.push(`${path}.render.fitScale must be a positive number`);
        }
        if (render.contentBounds !== undefined) {
          if (!isPixelBounds(render.contentBounds)) {
            issues.push(`${path}.render.contentBounds must contain finite x/y and positive width/height`);
          } else if (canvas && (
            render.contentBounds.x < 0
            || render.contentBounds.y < 0
            || render.contentBounds.x + render.contentBounds.width > canvas.width
            || render.contentBounds.y + render.contentBounds.height > canvas.height
          )) {
            issues.push(`${path}.render.contentBounds must stay inside the source canvas`);
          }
        }
      }
    }
  }

  const instanceIds = new Set<string>();
  const instances = isRecord(value.defaultScene) && Array.isArray(value.defaultScene.instances)
    ? value.defaultScene.instances
    : [];
  for (const [index, candidate] of instances.entries()) {
    const path = `defaultScene.instances[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(`${path} must be an object`);
      continue;
    }
    if (typeof candidate.instanceId !== "string" || candidate.instanceId.trim() === "") {
      issues.push(`${path}.instanceId must be a non-empty string`);
    } else if (instanceIds.has(candidate.instanceId)) {
      issues.push(`${path}.instanceId duplicates ${candidate.instanceId}`);
    } else {
      instanceIds.add(candidate.instanceId);
    }
    if (typeof candidate.assetId !== "string" || !assetIds.has(candidate.assetId)) {
      issues.push(`${path}.assetId must reference a registered asset`);
    }
    if (typeof candidate.roomId !== "string" || candidate.roomId.trim() === "") {
      issues.push(`${path}.roomId must be a non-empty string`);
    }
    if (!isGridPoint(candidate.floorContact)) {
      issues.push(`${path}.floorContact must contain finite x/y`);
    } else {
      const footprint = typeof candidate.assetId === "string"
        ? assetFootprints.get(candidate.assetId)
        : undefined;
      if (candidate.floorContact.x < 0 || candidate.floorContact.x > validationGrid.columns
        || candidate.floorContact.y < 0 || candidate.floorContact.y > validationGrid.rows
        || (footprint && candidate.floorContact.x - footprint.width < 0)
        || (footprint && candidate.floorContact.y - footprint.depth < 0)) {
        issues.push(`${path} footprint must stay inside the ${validationGrid.columns}x${validationGrid.rows} world grid`);
      }
    }
    if (candidate.displayScale !== undefined && !isPositiveNumber(candidate.displayScale)) {
      issues.push(`${path}.displayScale must be a positive number when supplied for v4 compatibility`);
    }
  }

  return issues;
};

/** Validate and narrow an unknown manifest before it reaches the renderer. */
export function validateAssetManifest<AssetId extends string = string>(
  value: unknown,
  grid?: WorldGridSpec,
): asserts value is GridAssetManifest<AssetId> {
  const issues = collectAssetManifestIssues(value, grid);
  if (issues.length > 0) {
    throw new Error(`Invalid asset manifest: ${issues.join("; ")}`);
  }
}
