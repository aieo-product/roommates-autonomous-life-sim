import { describe, expect, it } from "vitest";
import {
  ASSET_MANAGER_STORAGE_KEY,
  AssetManagerValidationError,
  createDefaultAssetManagerDocument,
  findManagedCharacterAsset,
  loadAssetManagerDocument,
  parseAssetManagerJson,
  resolveCharacterScene,
  resolveFurnitureScene,
  saveAssetManagerDocument,
  serializeAssetManagerDocument,
  validateAssetManagerDocument,
} from "../src/assets-manager/index.js";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

describe("asset manager document", () => {
  it("adapts the bundled furniture and character manifests into a valid project", () => {
    const project = createDefaultAssetManagerDocument();

    expect(validateAssetManagerDocument(project)).toEqual([]);
    expect(project.format).toBe("roommates.project");
    expect(project.assets.furniture.some((asset) => asset.id === "bathtub")).toBe(true);
    expect(project.assets.characters.map((asset) => asset.runtimeId)).toEqual([
      "haru",
      "aoi",
      "navigator",
    ]);
    expect(project.assets.characters.map((asset) => asset.role)).toEqual([
      "male",
      "female",
      "navigator",
    ]);
    expect(project.assets.characters[0]?.spriteSheet).toMatchObject({
      canvas: { width: 384, height: 512 },
      frameSize: { width: 128, height: 128 },
      columns: 3,
      rows: 4,
      directionRows: { south: 0, east: 1, north: 2, west: 3 },
      animations: { walk: { frames: [0, 1, 2, 1], frameDurationMs: 170 } },
    });
    expect(project.assets.characters.every((asset) => (
      asset.footprintTiles.width === 1 && asset.footprintTiles.depth === 1
    ))).toBe(true);
    expect(project.placements.furniture.length).toBeGreaterThan(10);
    expect(project.placements.characters.map((placement) => placement.roomId)).toEqual([
      "male_room",
      "female_room",
      "living",
    ]);
  });

  it("migrates legacy resident roles, room aliases, and missing sheet metadata", () => {
    const legacy = createDefaultAssetManagerDocument() as unknown as {
      assets: { characters: Array<Record<string, unknown>> };
      placements: { characters: Array<Record<string, unknown>> };
    };
    legacy.assets.characters[0]!.role = "resident";
    legacy.assets.characters[1]!.role = "resident";
    legacy.assets.characters[2]!.role = "player-command-agent";
    legacy.assets.characters[0]!.id = "custom-resident-one";
    legacy.assets.characters[1]!.id = "custom-resident-two";
    delete legacy.assets.characters[0]!.runtimeId;
    delete legacy.assets.characters[1]!.runtimeId;
    legacy.placements.characters[0]!.assetId = "custom-resident-one";
    legacy.placements.characters[1]!.assetId = "custom-resident-two";
    legacy.assets.characters.forEach((character) => { delete character.spriteSheet; });
    legacy.placements.characters[0]!.roomId = "haru_room";
    legacy.placements.characters[1]!.roomId = "aoi_room";

    const migrated = parseAssetManagerJson(JSON.stringify(legacy));

    expect(migrated.assets.characters.map((asset) => asset.role)).toEqual([
      "male",
      "female",
      "navigator",
    ]);
    expect(migrated.assets.characters.every((asset) => asset.spriteSheet.columns === 3)).toBe(true);
    expect(migrated.placements.characters.map((placement) => placement.roomId)).toEqual([
      "male_room",
      "female_room",
      "living",
    ]);
  });

  it("round-trips URL and uploaded Data URL image sources", () => {
    const project = createDefaultAssetManagerDocument();
    project.assets.furniture[0]!.imageUrl = "data:image/png;base64,aGVsbG8=";
    project.assets.characters[0]!.portraitUrl = "https://cdn.example.com/haru.png";

    const restored = parseAssetManagerJson(serializeAssetManagerDocument(project));

    expect(restored.assets.furniture[0]?.imageUrl).toBe("data:image/png;base64,aGVsbG8=");
    expect(restored.assets.characters[0]?.portraitUrl).toBe("https://cdn.example.com/haru.png");
  });

  it("reports actionable paths for invalid footprint, URL, IDs, and floor contact", () => {
    const project = createDefaultAssetManagerDocument();
    project.assets.furniture[0]!.footprintTiles.width = 0;
    project.assets.furniture[0]!.imageUrl = "javascript:alert(1)";
    project.assets.furniture[1]!.id = project.assets.furniture[0]!.id;
    project.placements.furniture[0]!.floorContact.x = 99;

    const issues = validateAssetManagerDocument(project);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "assets.furniture.0.footprintTiles.width" }),
      expect.objectContaining({ path: "assets.furniture.0.imageUrl" }),
      expect.objectContaining({ path: "assets.furniture.1.id" }),
      expect.objectContaining({ path: "placements.furniture.0.floorContact.x" }),
    ]));
  });

  it("rejects role/runtime mismatches and invalid sprite sheet contracts", () => {
    const project = createDefaultAssetManagerDocument();
    const male = project.assets.characters[0]!;
    male.role = "female";
    male.spriteSheet.canvas.width = 385;
    male.spriteSheet.animations.walk!.frames = [3];

    const issues = validateAssetManagerDocument(project);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "assets.characters.0.role" }),
      expect.objectContaining({ path: "assets.characters.0.spriteSheet.canvas" }),
      expect.objectContaining({ path: "assets.characters.0.spriteSheet.animations.walk.frames.0" }),
    ]));
  });

  it("validates action tags as stable, unique IDs", () => {
    const project = createDefaultAssetManagerDocument();
    project.assets.furniture[0]!.anchorIds = ["cook", "cook", "not valid"];

    expect(validateAssetManagerDocument(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "assets.furniture.0.anchorIds.1" }),
      expect.objectContaining({ path: "assets.furniture.0.anchorIds.2" }),
    ]));
  });

  it("rejects malformed and wrong-version JSON with a validation error", () => {
    expect(() => parseAssetManagerJson("{"))
      .toThrow(AssetManagerValidationError);

    const project = createDefaultAssetManagerDocument() as unknown as Record<string, unknown>;
    project.formatVersion = 2;
    expect(() => parseAssetManagerJson(JSON.stringify(project)))
      .toThrow(/version 1/);
  });
});

describe("asset manager persistence", () => {
  it("saves and loads a valid project under the stable localStorage key", () => {
    const storage = memoryStorage();
    const project = createDefaultAssetManagerDocument();
    project.name = "差し替えた部屋";

    expect(saveAssetManagerDocument(storage, project)).toBeUndefined();
    expect(storage.values.has(ASSET_MANAGER_STORAGE_KEY)).toBe(true);
    expect(loadAssetManagerDocument(storage, createDefaultAssetManagerDocument()).document.name)
      .toBe("差し替えた部屋");
  });

  it("falls back safely when persisted JSON is invalid", () => {
    const storage = memoryStorage();
    storage.values.set(ASSET_MANAGER_STORAGE_KEY, "not json");
    const fallback = createDefaultAssetManagerDocument();

    const result = loadAssetManagerDocument(storage, fallback);

    expect(result.document).toEqual(fallback);
    expect(result.document).not.toBe(fallback);
    expect(result.error).toContain("読み込めませんでした");
  });
});

describe("runtime asset resolution", () => {
  it("resolves canonical male/female roles while keeping haru/aoi aliases", () => {
    const project = createDefaultAssetManagerDocument();

    expect(findManagedCharacterAsset(project, "male")?.runtimeId).toBe("haru");
    expect(findManagedCharacterAsset(project, "female")?.runtimeId).toBe("aoi");
    expect(findManagedCharacterAsset(project, "haru")?.role).toBe("male");
    expect(findManagedCharacterAsset(project, "aoi")?.role).toBe("female");
  });

  it("resolves edited furniture configuration and placement without a reload", () => {
    const project = createDefaultAssetManagerDocument();
    const placement = project.placements.furniture[0]!;
    const asset = project.assets.furniture.find((item) => item.id === placement.assetId)!;
    asset.imageUrl = "https://cdn.example.com/replacement.png";
    asset.render.flipX = true;
    placement.roomId = "kitchen";
    placement.floorContact = { x: 4, y: 12 };

    const resolved = resolveFurnitureScene(project).find(
      (item) => item.instanceId === placement.instanceId,
    );

    expect(resolved).toMatchObject({
      imageUrl: "https://cdn.example.com/replacement.png",
      flipX: true,
      roomId: "kitchen",
      floorContact: { x: 4, y: 12 },
    });
  });

  it("lets placement-level orientation and flip override the character defaults", () => {
    const project = createDefaultAssetManagerDocument();
    project.placements.characters[0]!.orientation = "north-east-to-south-west";
    project.placements.characters[0]!.flipX = true;

    expect(resolveCharacterScene(project)[0]).toMatchObject({
      orientation: "north-east-to-south-west",
      flipX: true,
      asset: { runtimeId: "haru" },
    });
  });
});
