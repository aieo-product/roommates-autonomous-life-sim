import aoiBedUrl from "../../../assets/furniture/aoi-bed.png";
import balconyDryingRackUrl from "../../../assets/furniture/balcony-drying-rack.png";
import bathtubUrl from "../../../assets/furniture/bathtub.png";
import deskChairUrl from "../../../assets/furniture/desk-chair.png";
import diningChairUrl from "../../../assets/furniture/dining-chair.png";
import diningTableUrl from "../../../assets/furniture/dining-table.png";
import entryShoeCabinetUrl from "../../../assets/furniture/entry-shoe-cabinet.png";
import floorLampUrl from "../../../assets/furniture/floor-lamp.png";
import haruBedUrl from "../../../assets/furniture/haru-bed.png";
import islandKitchenUrl from "../../../assets/furniture/island-kitchen.png";
import kitchenCounterUrl from "../../../assets/furniture/kitchen-counter.png";
import laundryBasketUrl from "../../../assets/furniture/laundry-basket.png";
import lowTableUrl from "../../../assets/furniture/low-table.png";
import furnitureManifest from "../../../assets/furniture/manifest.json";
import entryRugUrl from "../../../assets/furniture/entry-rug.png";
import pottedPlantUrl from "../../../assets/furniture/potted-plant.png";
import refrigeratorUrl from "../../../assets/furniture/refrigerator.png";
import sofaUrl from "../../../assets/furniture/sofa.png";
import storageShelfUrl from "../../../assets/furniture/storage-shelf.png";
import tvConsoleUrl from "../../../assets/furniture/tv-console.png";
import washroomVanityUrl from "../../../assets/furniture/washroom-vanity.png";
import workDeskUrl from "../../../assets/furniture/work-desk.png";
import {
  collectAssetManifestIssues,
  resolveAssetRender,
  resolveAssetSpriteFrame,
  type AssetSpriteFrame,
  type GridAssetDefinition,
  type GridAssetInstance,
  type GridAssetManifest,
  type PixelBounds,
} from "./asset-grid.js";
import { projectRoomPoint, type Point } from "./room-layout.js";

export const FURNITURE_ASSET_URLS = {
  "aoi-bed": aoiBedUrl,
  "balcony-drying-rack": balconyDryingRackUrl,
  bathtub: bathtubUrl,
  "desk-chair": deskChairUrl,
  "dining-chair": diningChairUrl,
  "dining-table": diningTableUrl,
  "entry-shoe-cabinet": entryShoeCabinetUrl,
  "entry-rug": entryRugUrl,
  "floor-lamp": floorLampUrl,
  "haru-bed": haruBedUrl,
  "island-kitchen": islandKitchenUrl,
  "kitchen-counter": kitchenCounterUrl,
  "laundry-basket": laundryBasketUrl,
  "low-table": lowTableUrl,
  "potted-plant": pottedPlantUrl,
  refrigerator: refrigeratorUrl,
  sofa: sofaUrl,
  "storage-shelf": storageShelfUrl,
  "tv-console": tvConsoleUrl,
  "washroom-vanity": washroomVanityUrl,
  "work-desk": workDeskUrl,
} as const;

export type FurnitureAssetId = keyof typeof FURNITURE_ASSET_URLS;

export type FurniturePlacement = GridAssetInstance<FurnitureAssetId> & {
  /** Projected floor contact; retained as `pivot` for existing consumers. */
  pivot: Point;
  assetPivot: Point;
  contentBounds: PixelBounds;
  flipX: boolean;
  /** Resolved scale. v5 computes it from footprint/content; v4 reads legacy data. */
  displayScale: number;
  scaleSource: AssetSpriteFrame["scaleSource"];
  spriteFrame: AssetSpriteFrame;
};

const registeredAssetIds = new Set(Object.keys(FURNITURE_ASSET_URLS));
const manifest = furnitureManifest as unknown as GridAssetManifest<FurnitureAssetId>;
const manifestAssets = manifest.assets as Array<GridAssetDefinition<FurnitureAssetId>>;
const manifestAssetById = new Map(manifestAssets.map((asset) => [asset.id, asset]));
const manifestAssetIds = new Set<string>(manifestAssets.map((asset) => asset.id));

const registryIssues = [
  ...collectAssetManifestIssues(furnitureManifest),
  ...[...manifestAssetIds]
    .filter((assetId) => !registeredAssetIds.has(assetId))
    .map((assetId) => `manifest asset is not imported: ${assetId}`),
  ...[...registeredAssetIds]
    .filter((assetId) => !manifestAssetIds.has(assetId))
    .map((assetId) => `imported asset is missing from manifest: ${assetId}`),
];

if (registryIssues.length > 0) {
  throw new Error(`Invalid furniture asset registry: ${registryIssues.join(", ")}`);
}

export const FURNITURE_MANIFEST = furnitureManifest;

export const FURNITURE_SCENE_PLACEMENTS = manifest.defaultScene.instances
  .map((placement): FurniturePlacement => {
    if (!registeredAssetIds.has(placement.assetId)) {
      throw new Error(`Unknown furniture asset in default scene: ${placement.assetId}`);
    }
    const asset = manifestAssetById.get(placement.assetId as FurnitureAssetId);
    if (!asset) {
      throw new Error(`Missing furniture render config: ${placement.assetId}`);
    }

    const projectedFloorContact = projectRoomPoint(placement.floorContact.x, placement.floorContact.y);
    const resolvedRender = resolveAssetRender(manifest, asset, placement);
    const spriteFrame = resolveAssetSpriteFrame(projectedFloorContact, resolvedRender);
    // Explicit v4 fallbacks make mixed/older packs readable during migration.
    const legacyAssetPivot = asset.pivot ?? furnitureManifest.pivot;
    const assetPivot = asset.render?.pivot ?? legacyAssetPivot ?? resolvedRender.pivot;
    const legacyFlipX = asset.flipX ?? false;
    const flipX = asset.render?.flipX ?? legacyFlipX;

    return {
      ...placement,
      assetId: placement.assetId as FurnitureAssetId,
      pivot: projectedFloorContact,
      assetPivot,
      contentBounds: resolvedRender.contentBounds,
      flipX,
      displayScale: resolvedRender.scale,
      scaleSource: resolvedRender.scaleSource,
      spriteFrame,
    };
  })
  .sort((left, right) => left.pivot.y - right.pivot.y);

/**
 * Generated furniture overlay for the shared 1280 x 720 apartment SVG.
 * ApartmentStage is reused by the live view, memories, and result captures,
 * so mounting this layer once keeps every scene on the same asset contract.
 */
export function FurnitureSpriteLayer() {
  return (
    <g className="furniture-sprite-layer" aria-hidden="true">
      {FURNITURE_SCENE_PLACEMENTS.map((placement) => {
        const { x, y, width, height } = placement.spriteFrame;
        const flipTransform = placement.flipX
          ? `translate(${2 * x + width} 0) scale(-1 1)`
          : undefined;

        return (
          <image
            key={placement.instanceId}
            className={`furniture-sprite furniture-${placement.assetId}`}
            data-furniture-asset={placement.assetId}
            data-furniture-instance={placement.instanceId}
            data-furniture-flip={placement.flipX ? "x" : undefined}
            data-furniture-scale-source={placement.scaleSource}
            data-furniture-footprint={`${manifestAssetById.get(placement.assetId)?.footprintTiles.width ?? 0}x${manifestAssetById.get(placement.assetId)?.footprintTiles.depth ?? 0}`}
            href={FURNITURE_ASSET_URLS[placement.assetId]}
            x={x}
            y={y}
            width={width}
            height={height}
            transform={flipTransform}
            preserveAspectRatio="xMidYMid meet"
            style={{ imageRendering: "pixelated", pointerEvents: "none" }}
          />
        );
      })}
    </g>
  );
}
