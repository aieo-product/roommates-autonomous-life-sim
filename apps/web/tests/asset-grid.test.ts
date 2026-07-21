import { describe, expect, it } from "vitest";
import furnitureManifestJson from "../../../assets/furniture/manifest.json";
import {
  CHARACTER_ASSET_CONTRACT,
  CHARACTER_GRID_FOOTPRINT,
  WORLD_GRID,
  collectAssetManifestIssues,
  computeFootprintFitScale,
  projectGridPoint,
  projectedFootprintWidth,
  resolveAssetRender,
  resolveAssetSpriteFrame,
  validateAssetManifest,
  worldGridForManifest,
  type GridAssetManifest,
} from "../src/asset-grid.js";

const v5Manifest = {
  version: 5,
  format: "roommates-grid-assets",
  grid: {
    columns: 24,
    rows: 18,
    tileWidth: 50,
    tileHeight: 25,
    characterFootprint: { width: 1, depth: 1 },
  },
  canvas: { width: 256, height: 256 },
  pivot: { x: 128, y: 236 },
  assets: [
    {
      id: "island-kitchen",
      file: "island-kitchen.png",
      footprintTiles: { width: 2, depth: 1 },
      render: {
        contentBounds: { x: 80, y: 91, width: 150, height: 145 },
        pivot: { x: 228, y: 236 },
        flipX: true,
        fitScale: 1.1,
      },
    },
  ],
  defaultScene: {
    instances: [
      {
        instanceId: "kitchen-island",
        assetId: "island-kitchen",
        roomId: "kitchen",
        floorContact: { x: 4, y: 11 },
        displayScale: 9,
      },
    ],
  },
} satisfies GridAssetManifest;

describe("canonical asset grid", () => {
  it("uses a 24x18 square-cell world with 50x25 isometric tiles", () => {
    expect(WORLD_GRID).toEqual({
      columns: 24,
      rows: 18,
      tileWidth: 50,
      tileHeight: 25,
      origin: { x: 600, y: 100 },
    });
    expect(projectGridPoint({ x: 4, y: 3 })).toEqual({ x: 625, y: 187.5 });
    expect(worldGridForManifest(v5Manifest)).toEqual(WORLD_GRID);
  });

  it("gives every character the same 1x1 occupancy contract", () => {
    expect(CHARACTER_GRID_FOOTPRINT).toEqual({ width: 1, depth: 1 });
    expect(CHARACTER_ASSET_CONTRACT.footprintTiles).toBe(CHARACTER_GRID_FOOTPRINT);
    expect(projectedFootprintWidth(CHARACTER_GRID_FOOTPRINT)).toBe(50);
  });
});

describe("footprint-driven asset rendering", () => {
  it("fits visible width to projected cells and applies only a relative art multiplier", () => {
    // A 2x1 footprint projects to 75 px. 75 / 150 * 1.1 = 0.55.
    expect(projectedFootprintWidth({ width: 2, depth: 1 })).toBe(75);
    expect(computeFootprintFitScale(
      { width: 2, depth: 1 },
      { width: 150 },
      1.1,
    )).toBeCloseTo(0.55);
  });

  it("uses v5 contentBounds instead of a persisted instance displayScale", () => {
    const asset = v5Manifest.assets[0];
    const instance = v5Manifest.defaultScene.instances[0];
    const render = resolveAssetRender(v5Manifest, asset, instance);

    expect(render.scale).toBeCloseTo(0.55);
    expect(render.scaleSource).toBe("footprint");
    expect(render.pivot).toEqual({ x: 228, y: 236 });
    expect(render.flipX).toBe(true);
  });

  it("mirrors around the floor contact instead of moving a flipped asset", () => {
    const render = resolveAssetRender(
      v5Manifest,
      v5Manifest.assets[0],
      v5Manifest.defaultScene.instances[0],
    );
    const frame = resolveAssetSpriteFrame({ x: 500, y: 300 }, render);
    const transformedPivotX = (2 * frame.x + frame.width)
      - (frame.x + render.pivot.x * render.scale);

    expect(transformedPivotX).toBeCloseTo(500);
    expect(frame.y + render.pivot.y * render.scale).toBeCloseTo(300);
    expect(frame.transform).toContain("scale(-1 1)");
  });

  it("keeps v4 top-level render metadata and absolute displayScale working", () => {
    const legacyManifest: GridAssetManifest = {
      version: 4,
      canvas: { width: 256, height: 256 },
      pivot: { x: 128, y: 236 },
      recommendedDisplayScale: 0.5,
      assets: [{
        id: "legacy-chair",
        file: "legacy-chair.png",
        footprintTiles: { width: 1, depth: 1 },
        pivot: { x: 119, y: 230 },
        flipX: true,
      }],
      defaultScene: {
        instances: [{
          instanceId: "legacy-chair-1",
          assetId: "legacy-chair",
          roomId: "living",
          floorContact: { x: 20, y: 12 },
          displayScale: 0.72,
        }],
      },
    };

    const render = resolveAssetRender(
      legacyManifest,
      legacyManifest.assets[0],
      legacyManifest.defaultScene.instances[0],
    );
    expect(render.scale).toBe(0.72);
    expect(render.scaleSource).toBe("legacy-instance");
    expect(render.pivot).toEqual({ x: 119, y: 230 });
    expect(render.flipX).toBe(true);
  });
});

describe("asset manifest validation", () => {
  it("accepts the v5 grid contract", () => {
    expect(collectAssetManifestIssues(v5Manifest)).toEqual([]);
    expect(() => validateAssetManifest(v5Manifest)).not.toThrow();
  });

  it("accepts a legacy-to-canonical room ID map and rejects malformed aliases", () => {
    const withAliases = {
      ...v5Manifest,
      roomIdAliases: {
        haru_room: "male_room",
        aoi_room: "female_room",
        famale_room: "female_room",
      },
    };
    expect(collectAssetManifestIssues(withAliases)).toEqual([]);

    const invalidAliases = { ...v5Manifest, roomIdAliases: { haru_room: "" } };
    expect(collectAssetManifestIssues(invalidAliases)).toContain(
      "roomIdAliases must map non-empty room IDs to non-empty room IDs",
    );
  });

  it("validates and resolves every asset in the shipped v5 manifest", () => {
    expect(collectAssetManifestIssues(furnitureManifestJson)).toEqual([]);
    const manifest = furnitureManifestJson as unknown as GridAssetManifest;
    for (const instance of manifest.defaultScene.instances) {
      const asset = manifest.assets.find((candidate) => candidate.id === instance.assetId);
      expect(asset, instance.assetId).toBeDefined();
      const resolved = resolveAssetRender(manifest, asset!, instance);
      expect(resolved.scaleSource).toBe("footprint");
      expect(resolved.scale).toBeGreaterThan(0);
      expect(Number.isFinite(resolved.scale)).toBe(true);
    }
  });

  it("reports invalid content, duplicate ids, unknown assets, and grid overflow", () => {
    const invalid = structuredClone(v5Manifest) as unknown as Record<string, unknown>;
    const assets = invalid.assets as Array<Record<string, unknown>>;
    assets.push({ ...assets[0] });
    const render = assets[0].render as Record<string, unknown>;
    render.contentBounds = { x: 240, y: 0, width: 30, height: 10 };
    const defaultScene = invalid.defaultScene as { instances: Array<Record<string, unknown>> };
    defaultScene.instances[0].assetId = "missing";
    defaultScene.instances[0].floorContact = { x: 25, y: 19 };

    const issues = collectAssetManifestIssues(invalid);
    expect(issues).toContain("assets[1].id duplicates island-kitchen");
    expect(issues).toContain("assets[0].render.contentBounds must stay inside the source canvas");
    expect(issues).toContain("defaultScene.instances[0].assetId must reference a registered asset");
    expect(issues).toContain("defaultScene.instances[0] footprint must stay inside the 24x18 world grid");
    expect(() => validateAssetManifest(invalid)).toThrow("Invalid asset manifest");
  });
});
