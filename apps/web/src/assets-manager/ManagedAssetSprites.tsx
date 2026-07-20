import { useMemo } from "react";
import {
  computeFootprintFitScale,
  projectGridPoint,
  resolveAssetSpriteFrame,
  type PixelBounds,
  type ResolvedAssetRender,
} from "../asset-grid.js";
import { useManagedFurnitureScene } from "./AssetManagerContext.js";

const flipTransform = (
  x: number,
  y: number,
  width: number,
  height: number,
  flipX: boolean,
  flipY: boolean,
): string | undefined => {
  if (flipX && flipY) return `translate(${2 * x + width} ${2 * y + height}) scale(-1 -1)`;
  if (flipX) return `translate(${2 * x + width} 0) scale(-1 1)`;
  if (flipY) return `translate(0 ${2 * y + height}) scale(1 -1)`;
  return undefined;
};

/**
 * Context-backed drop-in scene layer. Mounting this instead of the static
 * manifest layer makes editor changes visible in the apartment immediately.
 */
export function ManagedFurnitureSpriteLayer() {
  const scene = useManagedFurnitureScene();
  const frames = useMemo(() => scene.map((placement) => {
    const floorContact = projectGridPoint(placement.floorContact);
    const { asset } = placement;
    const contentBounds: PixelBounds = asset.render.contentBounds ?? {
      x: 0,
      y: 0,
      ...asset.render.canvas,
    };
    const resolvedRender: ResolvedAssetRender = {
      canvas: asset.render.canvas,
      contentBounds,
      pivot: asset.render.pivot,
      flipX: placement.flipX,
      scale: computeFootprintFitScale(
        asset.footprintTiles,
        contentBounds,
        asset.render.fitScale,
      ),
      scaleSource: "footprint",
    };
    const frame = resolveAssetSpriteFrame(floorContact, resolvedRender);
    return {
      ...placement,
      projectedY: floorContact.y,
      frame,
    };
  }).sort((left, right) => left.projectedY - right.projectedY), [scene]);

  return (
    <g className="furniture-sprite-layer managed-furniture-sprite-layer" aria-hidden="true">
      {frames.map((placement) => {
        const { x, y, width, height } = placement.frame;
        return (
          <image
            key={placement.instanceId}
            className={`furniture-sprite furniture-${placement.asset.id}`}
            data-furniture-asset={placement.asset.id}
            data-furniture-instance={placement.instanceId}
            data-furniture-room={placement.roomId}
            data-furniture-orientation={placement.orientation}
            data-furniture-flip={`${placement.flipX ? "x" : ""}${placement.flipY ? "y" : ""}` || undefined}
            data-furniture-footprint={`${placement.asset.footprintTiles.width}x${placement.asset.footprintTiles.depth}`}
            href={placement.imageUrl}
            x={x}
            y={y}
            width={width}
            height={height}
            transform={flipTransform(x, y, width, height, placement.flipX, placement.flipY)}
            preserveAspectRatio="xMidYMid meet"
            style={{ imageRendering: "pixelated", pointerEvents: "none" }}
          />
        );
      })}
    </g>
  );
}
