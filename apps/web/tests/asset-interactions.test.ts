import { describe, expect, it } from "vitest";
import {
  createAssetInteractionAnchors,
  findAssetInteractionAnchor,
  interactionStandPoint,
} from "../src/asset-interactions.js";

const document = {
  assets: {
    furniture: [
      {
        id: "island-kitchen",
        label: "Island Kitchen",
        anchorIds: ["kitchen_island"],
        footprintTiles: { width: 1, depth: 2 },
      },
      {
        id: "custom-piano",
        label: "ピアノ",
        anchorIds: ["演奏"],
        footprintTiles: { width: 2, depth: 1 },
      },
    ],
  },
  placements: {
    furniture: [
      {
        instanceId: "kitchen-island",
        assetId: "island-kitchen",
        roomId: "kitchen",
        floorContact: { x: 4, y: 12 },
      },
      {
        instanceId: "living-piano",
        assetId: "custom-piano",
        roomId: "living",
        floorContact: { x: 20, y: 13 },
      },
    ],
  },
};

describe("asset interaction anchors", () => {
  const anchors = createAssetInteractionAnchors(
    document,
    new Set(["kitchen", "living"]),
  );

  it("matches current asset placement using built-in and custom action tags", () => {
    expect(findAssetInteractionAnchor("アイランドで料理する", anchors)?.id).toBe("kitchen-island");
    expect(findAssetInteractionAnchor("ピアノを演奏する", anchors)?.id).toBe("living-piano");
  });

  it("can restrict matching to the current room", () => {
    expect(findAssetInteractionAnchor("演奏する", anchors, "kitchen")).toBeUndefined();
    expect(findAssetInteractionAnchor("演奏する", anchors, "living")?.id).toBe("living-piano");
  });

  it("places the two residents on opposite sides of a 2-cell asset", () => {
    const island = anchors.find((anchor) => anchor.id === "kitchen-island");
    expect(island).toBeDefined();
    expect(interactionStandPoint(island!, "haru")).toEqual({ x: 2.45, y: 11 });
    expect(interactionStandPoint(island!, "aoi")).toEqual({ x: 4.55, y: 11 });
  });
});
