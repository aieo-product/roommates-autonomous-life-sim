import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeFootprintFitScale,
  projectedFootprintWidth,
} from "../../web/src/asset-grid.js";

type Footprint = { width: number; depth: number };
type RenderMetadata = {
  contentBounds: { x: number; y: number; width: number; height: number };
  pivot: { x: number; y: number };
  flipX?: boolean;
  fitScale: number;
};
type FurnitureManifest = {
  version: number;
  format: string;
  roomIdAliases: Record<string, string>;
  grid: {
    columns: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
    characterFootprint: Footprint;
  };
  canvas: { width: number; height: number };
  assets: Array<{
    id: string;
    footprintTiles: Footprint;
    render: RenderMetadata;
  }>;
  defaultScene: {
    instances: Array<{
      instanceId: string;
      assetId: string;
      roomId: string;
      floorContact: { x: number; y: number };
    }>;
  };
};
type CharacterManifest = {
  logicalTileFootprint: { width: number; height: number };
  gridContract: {
    coordinateSystem: string;
    footprintTiles: Footprint;
    floorContact: string;
  };
};
type PortableRoomPack = {
  rooms: Array<{ id: string }>;
  placements: {
    assets: Array<{
      instanceId: string;
      assetId: string;
      roomId: string;
      floorContact: { x: number; y: number };
    }>;
    characters: Array<{
      instanceId: string;
      roomId: string;
      floorContact: { x: number; y: number };
      facing: string;
    }>;
  };
  extensions?: {
    "roommates.room-id-aliases"?: Record<string, string>;
  };
};

const repositoryUrl = new URL("../../../", import.meta.url);
const repositoryPath = fileURLToPath(repositoryUrl);
const validatorPath = fileURLToPath(new URL("scripts/validate-assets.mjs", repositoryUrl));
const furnitureManifest = JSON.parse(readFileSync(
  new URL("assets/furniture/manifest.json", repositoryUrl),
  "utf8",
)) as FurnitureManifest;
const characterManifest = JSON.parse(readFileSync(
  new URL("assets/characters/manifest.json", repositoryUrl),
  "utf8",
)) as CharacterManifest;
const sampleRoomPack = JSON.parse(readFileSync(
  new URL("docs/examples/roommates-asset-format-v1/room-pack.json", repositoryUrl),
  "utf8",
)) as PortableRoomPack;

const runValidator = (...args: string[]) => spawnSync(
  process.execPath,
  [validatorPath, ...args],
  { cwd: repositoryPath, encoding: "utf8" },
);

const assetById = (id: string) => {
  const asset = furnitureManifest.assets.find((candidate) => candidate.id === id);
  expect(asset, `${id} should be registered`).toBeDefined();
  return asset!;
};

describe("Roommates Asset Format validator", () => {
  it("validates shipped runtime assets and all portable v1 examples", () => {
    const result = runValidator();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Validated \d+ manifest\(s\)/);
    expect(result.stdout).toContain("roommates.asset-pack");
    expect(result.stdout).toContain("roommates.character-pack");
    expect(result.stdout).toContain("roommates.room-pack");
  });

  it("rejects a malformed manifest with actionable JSON paths", () => {
    const fixture = "apps/server/tests/fixtures/invalid-asset-pack.json";
    const result = runValidator("--schema-only", fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Asset validation failed");
    expect(result.stderr).toContain("$.formatVersion: must be 1");
    expect(result.stderr).toContain("$.assets[0].footprintTiles.width: must be a positive integer");
    expect(result.stderr).toContain("$.assets[0].file: must be a safe path relative to the pack root");
    expect(result.stderr).toContain("$.assets[0].render.contentBounds: must fit inside render.canvas");
    expect(result.stderr).toContain("$.assets[0].render.pivot: must be inside or on the edge of render.canvas");
  });

  it("rejects room overflow and collisions against loaded pack footprints", () => {
    const result = runValidator(
      "--schema-only",
      "docs/examples/roommates-asset-format-v1/asset-pack.json",
      "docs/examples/roommates-asset-format-v1/character-pack.json",
      "apps/server/tests/fixtures/invalid-room-pack.json",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("$.placements.assets[2].floorContact: places sample.bathtub outside room 'test-room'");
    expect(result.stderr).toContain("$.placements.assets[1].floorContact: overlaps instance 'fridge-a'");
    expect(result.stderr).toContain("$.placements.characters[0].floorContact: overlaps asset instance 'fridge-a'");
  });
});

describe("shipped square-grid asset contract", () => {
  it("keeps the runtime grid, character scale, and canvas explicit", () => {
    expect(furnitureManifest).toMatchObject({
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
    });
    expect(characterManifest.logicalTileFootprint).toEqual({ width: 1, height: 1 });
    expect(characterManifest.gridContract).toMatchObject({
      coordinateSystem: "square-world-grid",
      footprintTiles: { width: 1, depth: 1 },
      floorContact: "bottom-center",
    });
  });

  it("emits canonical private-room IDs while retaining read-only aliases", () => {
    expect(furnitureManifest.roomIdAliases).toEqual({
      haru_room: "male_room",
      aoi_room: "female_room",
      famale_room: "female_room",
    });
    const privateRoomIds = furnitureManifest.defaultScene.instances
      .filter(({ assetId }) => assetId === "haru-bed" || assetId === "aoi-bed")
      .map(({ roomId }) => roomId);
    expect(privateRoomIds).toEqual(["male_room", "female_room"]);
    expect(privateRoomIds).not.toContain("haru_room");
    expect(privateRoomIds).not.toContain("aoi_room");

    const sampleRoomIds = sampleRoomPack.rooms.map(({ id }) => id);
    expect(sampleRoomIds).toEqual(expect.arrayContaining(["male_room", "female_room"]));
    expect(sampleRoomIds).not.toEqual(expect.arrayContaining(["haru_room", "aoi_room", "famale_room"]));
    expect(sampleRoomPack.extensions?.["roommates.room-id-aliases"]).toEqual(
      furnitureManifest.roomIdAliases,
    );
  });

  it("locks the key one-cell and two-cell furniture footprints", () => {
    expect(assetById("island-kitchen").footprintTiles).toEqual({ width: 1, depth: 2 });
    expect(assetById("bathtub").footprintTiles).toEqual({ width: 1, depth: 2 });
    expect(assetById("refrigerator").footprintTiles).toEqual({ width: 1, depth: 1 });
    expect(assetById("sofa").footprintTiles).toEqual({ width: 3, depth: 1 });
    expect(assetById("balcony-drying-rack").footprintTiles).toEqual({ width: 2, depth: 1 });
    expect(assetById("entry-rug").footprintTiles).toEqual({ width: 2, depth: 1 });
  });

  it("projects and fits one-cell and two-cell assets from the same grid scale", () => {
    expect(projectedFootprintWidth({ width: 1, depth: 1 })).toBe(50);
    expect(projectedFootprintWidth({ width: 1, depth: 2 })).toBe(75);
    expect(computeFootprintFitScale(
      { width: 1, depth: 2 },
      { width: 150 },
      1.2,
    )).toBeCloseTo(0.6);
  });

  it("keeps the sample residents on opposite sides of the island and facing each other", () => {
    const island = sampleRoomPack.placements.assets.find(({ assetId }) => assetId === "sample.island-kitchen");
    const male = sampleRoomPack.placements.characters.find(({ instanceId }) => instanceId === "male-character");
    const female = sampleRoomPack.placements.characters.find(({ instanceId }) => instanceId === "female-character");

    expect(island?.floorContact).toEqual({ x: 6, y: 3 });
    expect(male).toMatchObject({ floorContact: { x: 5, y: 2 }, facing: "east" });
    expect(female).toMatchObject({ floorContact: { x: 7, y: 2 }, facing: "west" });
    expect(male!.floorContact.x).toBeLessThan(island!.floorContact.x);
    expect(female!.floorContact.x).toBeGreaterThan(island!.floorContact.x);
  });

  it("stores fit, bounds, pivot, orientation, and flip separately from placement", () => {
    for (const id of [
      "island-kitchen",
      "bathtub",
      "refrigerator",
      "sofa",
      "balcony-drying-rack",
      "entry-rug",
    ]) {
      const asset = assetById(id);
      expect(asset.render.contentBounds.width, `${id} content width`).toBeGreaterThan(0);
      expect(asset.render.contentBounds.height, `${id} content height`).toBeGreaterThan(0);
      expect(asset.render.contentBounds.x + asset.render.contentBounds.width, `${id} horizontal bounds`)
        .toBeLessThanOrEqual(furnitureManifest.canvas.width);
      expect(asset.render.contentBounds.y + asset.render.contentBounds.height, `${id} vertical bounds`)
        .toBeLessThanOrEqual(furnitureManifest.canvas.height);
      expect(asset.render.pivot.x, `${id} pivot x`).toBeLessThanOrEqual(furnitureManifest.canvas.width);
      expect(asset.render.pivot.y, `${id} pivot y`).toBeLessThanOrEqual(furnitureManifest.canvas.height);
      expect(asset.render.fitScale, `${id} fit scale`).toBeGreaterThan(0);
    }

    expect(assetById("bathtub").render.flipX).toBe(false);
    const requiredPlacements = new Map([
      ["island-kitchen", "kitchen"],
      ["bathtub", "bathroom"],
      ["refrigerator", "kitchen"],
      ["sofa", "living"],
      ["balcony-drying-rack", "balcony"],
      ["entry-rug", "entry"],
    ]);
    for (const [assetId, roomId] of requiredPlacements) {
      expect(furnitureManifest.defaultScene.instances).toContainEqual(expect.objectContaining({
        assetId,
        roomId,
        floorContact: { x: expect.any(Number), y: expect.any(Number) },
      }));
    }
  });
});
