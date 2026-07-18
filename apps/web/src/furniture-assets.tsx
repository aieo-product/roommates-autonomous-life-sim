import aoiBedUrl from "../../../assets/furniture/aoi-bed.png";
import deskChairUrl from "../../../assets/furniture/desk-chair.png";
import diningChairUrl from "../../../assets/furniture/dining-chair.png";
import diningTableUrl from "../../../assets/furniture/dining-table.png";
import floorLampUrl from "../../../assets/furniture/floor-lamp.png";
import haruBedUrl from "../../../assets/furniture/haru-bed.png";
import laundryBasketUrl from "../../../assets/furniture/laundry-basket.png";
import lowTableUrl from "../../../assets/furniture/low-table.png";
import furnitureManifest from "../../../assets/furniture/manifest.json";
import pottedPlantUrl from "../../../assets/furniture/potted-plant.png";
import sofaUrl from "../../../assets/furniture/sofa.png";
import storageShelfUrl from "../../../assets/furniture/storage-shelf.png";
import tvConsoleUrl from "../../../assets/furniture/tv-console.png";
import workDeskUrl from "../../../assets/furniture/work-desk.png";

export const FURNITURE_ASSET_URLS = {
  "aoi-bed": aoiBedUrl,
  "desk-chair": deskChairUrl,
  "dining-chair": diningChairUrl,
  "dining-table": diningTableUrl,
  "floor-lamp": floorLampUrl,
  "haru-bed": haruBedUrl,
  "laundry-basket": laundryBasketUrl,
  "low-table": lowTableUrl,
  "potted-plant": pottedPlantUrl,
  sofa: sofaUrl,
  "storage-shelf": storageShelfUrl,
  "tv-console": tvConsoleUrl,
  "work-desk": workDeskUrl,
} as const;

export type FurnitureAssetId = keyof typeof FURNITURE_ASSET_URLS;

type FurniturePlacement = {
  instanceId: string;
  assetId: FurnitureAssetId;
  roomId: string;
  anchorId?: string;
  pivot: { x: number; y: number };
  displayScale: number;
};

const registeredAssetIds = new Set(Object.keys(FURNITURE_ASSET_URLS));
const manifestAssetIds = new Set(furnitureManifest.assets.map((asset) => asset.id));

const registryIssues = [
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

export const FURNITURE_SCENE_PLACEMENTS = furnitureManifest.defaultScene.instances
  .map((placement): FurniturePlacement => {
    if (!registeredAssetIds.has(placement.assetId)) {
      throw new Error(`Unknown furniture asset in default scene: ${placement.assetId}`);
    }

    return {
      ...placement,
      assetId: placement.assetId as FurnitureAssetId,
    };
  })
  .sort((left, right) => left.pivot.y - right.pivot.y);

/**
 * Generated furniture overlay for the shared 1280 x 720 apartment SVG.
 * ApartmentStage is reused by the live view, memories, and result captures,
 * so mounting this layer once keeps every scene on the same asset contract.
 */
export function FurnitureSpriteLayer() {
  const { canvas, pivot } = furnitureManifest;

  return (
    <g className="furniture-sprite-layer" aria-hidden="true">
      {FURNITURE_SCENE_PLACEMENTS.map((placement) => {
        const width = canvas.width * placement.displayScale;
        const height = canvas.height * placement.displayScale;
        const x = placement.pivot.x - pivot.x * placement.displayScale;
        const y = placement.pivot.y - pivot.y * placement.displayScale;

        return (
          <image
            key={placement.instanceId}
            className={`furniture-sprite furniture-${placement.assetId}`}
            data-furniture-asset={placement.assetId}
            data-furniture-instance={placement.instanceId}
            href={FURNITURE_ASSET_URLS[placement.assetId]}
            x={x}
            y={y}
            width={width}
            height={height}
            preserveAspectRatio="xMidYMid meet"
            style={{ imageRendering: "pixelated", pointerEvents: "none" }}
          />
        );
      })}
    </g>
  );
}
