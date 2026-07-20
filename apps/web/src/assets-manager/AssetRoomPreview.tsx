import type { CSSProperties } from "react";
import { computeFootprintFitScale } from "../asset-grid.js";
import type {
  ManagedCharacterAsset,
  ManagedFurnitureAsset,
  ManagedPlacement,
  Point,
} from "./model.js";

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 330;
const TILE_HALF_WIDTH = 11;
const TILE_HALF_HEIGHT = 5.5;
const ORIGIN = { x: 350, y: 34 };

const project = (point: Point): Point => ({
  x: ORIGIN.x + (point.x - point.y) * TILE_HALF_WIDTH,
  y: ORIGIN.y + (point.x + point.y) * TILE_HALF_HEIGHT,
});

const points = (values: Point[]): string =>
  values.map((point) => {
    const projected = project(point);
    return `${projected.x},${projected.y}`;
  }).join(" ");

const gridLines = (): Array<{ key: string; a: Point; b: Point }> => {
  const lines: Array<{ key: string; a: Point; b: Point }> = [];
  for (let x = 0; x <= 24; x += 1) {
    lines.push({ key: `x-${x}`, a: project({ x, y: 0 }), b: project({ x, y: 18 }) });
  }
  for (let y = 0; y <= 18; y += 1) {
    lines.push({ key: `y-${y}`, a: project({ x: 0, y }), b: project({ x: 24, y }) });
  }
  return lines;
};

const GRID_LINES = gridLines();

export function AssetRoomPreview({
  asset,
  placement,
  character = false,
}: {
  asset: ManagedFurnitureAsset | ManagedCharacterAsset;
  placement?: ManagedPlacement;
  character?: boolean;
}) {
  const floorContact = placement?.floorContact ?? { x: 18, y: 12 };
  const floorPoint = project(floorContact);
  const width = asset.footprintTiles.width;
  const depth = asset.footprintTiles.depth;
  const footprint = points([
    floorContact,
    { x: floorContact.x - width, y: floorContact.y },
    { x: floorContact.x - width, y: floorContact.y - depth },
    { x: floorContact.x, y: floorContact.y - depth },
  ]);
  const boundsWidth = asset.render.contentBounds?.width ?? asset.render.canvas.width;
  const scale = computeFootprintFitScale(
    asset.footprintTiles,
    { width: boundsWidth },
    asset.render.fitScale,
    { tileWidth: TILE_HALF_WIDTH * 4 },
  );
  const spriteWidth = asset.render.canvas.width * scale;
  const spriteHeight = asset.render.canvas.height * scale;
  const spriteX = floorPoint.x - asset.render.pivot.x * scale;
  const spriteY = floorPoint.y - asset.render.pivot.y * scale;
  const flipX = placement?.flipX ?? asset.render.flipX;
  const flipY = placement?.flipY ?? asset.render.flipY;
  const transform = [
    flipX ? `translate(${2 * spriteX + spriteWidth} 0) scale(-1 1)` : "",
    flipY ? `translate(0 ${2 * spriteY + spriteHeight}) scale(1 -1)` : "",
  ].filter(Boolean).join(" ") || undefined;
  const characterStyle = {
    transform: `translate(${floorPoint.x - 28}px, ${floorPoint.y - 56}px) scaleX(${flipX ? -1 : 1})`,
  } as CSSProperties;

  return (
    <section className="asset-room-preview" aria-labelledby="asset-room-preview-title">
      <div className="asset-room-preview-heading">
        <div>
          <small>LIVE GRID PREVIEW</small>
          <h3 id="asset-room-preview-title">24 × 18 マス配置</h3>
        </div>
        <span>{placement?.roomId ?? "未配置"}</span>
      </div>
      <div className="asset-room-preview-canvas">
        <svg viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`} role="img" aria-label={`${asset.label}を${placement?.roomId ?? "部屋"}の ${floorContact.x}, ${floorContact.y} に配置したプレビュー`}>
          <polygon
            className="asset-room-grid-floor"
            points={points([{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 18 }, { x: 0, y: 18 }])}
          />
          <g className="asset-room-grid-lines">
            {GRID_LINES.map((line) => (
              <line key={line.key} x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} />
            ))}
          </g>
          <polygon className="asset-room-grid-footprint" points={footprint} />
          {!character && (
            <image
              href={asset.imageUrl}
              x={spriteX}
              y={spriteY}
              width={spriteWidth}
              height={spriteHeight}
              transform={transform}
              preserveAspectRatio="xMidYMid meet"
            />
          )}
          <circle className="asset-room-grid-contact" cx={floorPoint.x} cy={floorPoint.y} r="4" />
        </svg>
        {character && (
          <img
            className="asset-room-preview-character"
            src={(asset as ManagedCharacterAsset).portraitUrl}
            alt=""
            style={characterStyle}
          />
        )}
      </div>
      <p>
        接地点 <strong>X {floorContact.x}</strong> / <strong>Y {floorContact.y}</strong>
        <span aria-hidden="true"> · </span>
        占有 <strong>{width} × {depth}</strong> マス
      </p>
    </section>
  );
}
