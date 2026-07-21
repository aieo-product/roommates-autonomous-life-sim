import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { CharacterId } from "@roommates/shared";
import haruWalkCycleUrl from "../../../assets/characters/otani-haru/walk-cycle.png";
import haruPortraitUrl from "../../../assets/characters/otani-haru/portraits/ui-bust-v2.png";
import aoiWalkCycleUrl from "../../../assets/characters/mizuhara-aoi/walk-cycle.png";
import aoiPortraitUrl from "../../../assets/characters/mizuhara-aoi/portraits/ui-bust-v2.png";
import navigatorPortraitUrl from "../../../assets/characters/navigator/portraits/ui-bust-v2.png";
import type { SpriteDirection } from "./after-scene.js";
import {
  useManagedCharacterAsset,
  type CharacterRole,
  type CharacterRuntimeId,
  type CharacterSpriteSheet,
  type ManagedCharacterAsset,
} from "./assets-manager/index.js";

type ResidentCharacterAsset = {
  runtimeId: CharacterRuntimeId;
  role: Extract<CharacterRole, "male" | "female">;
  sheetUrl: string;
  portraitUrl: string;
  resultUrl: string;
  spriteSheet: CharacterSpriteSheet;
};

const standardWalkSheet = (file: string): CharacterSpriteSheet => ({
  file,
  canvas: { width: 384, height: 512 },
  frameSize: { width: 128, height: 128 },
  columns: 3,
  rows: 4,
  directionRows: { south: 0, east: 1, north: 2, west: 3 },
  animations: {
    idle: { frames: [1], frameDurationMs: 170, loop: true },
    walk: { frames: [0, 1, 2, 1], frameDurationMs: 170, loop: true },
  },
});

export const residentCharacterAssets: Record<CharacterId, ResidentCharacterAsset> = {
  haru: {
    runtimeId: "haru",
    role: "male",
    sheetUrl: haruWalkCycleUrl,
    portraitUrl: haruPortraitUrl,
    resultUrl: haruPortraitUrl,
    spriteSheet: standardWalkSheet("otani-haru/walk-cycle.png"),
  },
  aoi: {
    runtimeId: "aoi",
    role: "female",
    sheetUrl: aoiWalkCycleUrl,
    portraitUrl: aoiPortraitUrl,
    resultUrl: aoiPortraitUrl,
    spriteSheet: standardWalkSheet("mizuhara-aoi/walk-cycle.png"),
  },
};

export const navigatorCharacterAssets = {
  portraitUrl: navigatorPortraitUrl,
} as const;

export const residentRoleFor = (
  person: CharacterId,
): Extract<CharacterRole, "male" | "female"> => person === "haru" ? "male" : "female";

export const useResidentCharacterAsset = (
  person: CharacterId,
): ManagedCharacterAsset | undefined => useManagedCharacterAsset(residentRoleFor(person));

export function ResidentPortrait({
  person,
  alt = "",
  className = "",
  thinking = false,
}: {
  person: CharacterId;
  alt?: string;
  className?: string;
  thinking?: boolean;
}) {
  const managedAsset = useResidentCharacterAsset(person);
  return (
    <span
      className={`resident-portrait portrait-${person} ${className}`.trim()}
      aria-hidden={alt ? undefined : true}
    >
      <img src={managedAsset?.portraitUrl ?? residentCharacterAssets[person].portraitUrl} alt={alt} />
      {thinking && <span className="resident-portrait-thinking">•••</span>}
    </span>
  );
}

export function ResidentSceneSprite({
  person,
  direction = "south",
  moving = false,
}: {
  person: CharacterId;
  direction?: SpriteDirection;
  moving?: boolean;
}) {
  const fallback = residentCharacterAssets[person];
  const managedAsset = useResidentCharacterAsset(person);
  const spriteSheet = managedAsset?.spriteSheet ?? fallback.spriteSheet;
  const animationPreset = managedAsset?.animationPreset ?? "walk";
  const animation = moving
    ? spriteSheet.animations[animationPreset]
      ?? spriteSheet.animations.walk
      ?? spriteSheet.animations.idle
    : spriteSheet.animations.idle;
  const frames = animation?.frames.length ? animation.frames : [0];
  const framesKey = frames.join(",");
  const [frameCursor, setFrameCursor] = useState(0);

  useEffect(() => {
    setFrameCursor(0);
    if (!moving || frames.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setFrameCursor((current) => {
        if (current + 1 < frames.length) return current + 1;
        return animation?.loop === false ? current : 0;
      });
    }, animation?.frameDurationMs ?? 170);
    return () => window.clearInterval(timer);
  }, [animation?.frameDurationMs, animation?.loop, frames.length, framesKey, moving]);

  const displayFrameSize = 64;
  const frame = frames[Math.min(frameCursor, frames.length - 1)] ?? 0;
  const row = spriteSheet.directionRows[direction] ?? 0;
  const imageStyle = useMemo<CSSProperties>(() => ({
    width: `${spriteSheet.columns * displayFrameSize}px`,
    height: `${spriteSheet.rows * displayFrameSize}px`,
    marginTop: `${-row * displayFrameSize}px`,
    transform: `translateX(${-frame * displayFrameSize}px)`,
    animation: "none",
    "--resident-idle-offset": `${-((spriteSheet.animations.idle?.frames[0] ?? 0) * displayFrameSize)}px`,
  } as CSSProperties), [frame, row, spriteSheet]);

  return (
    <span
      className={`resident-scene-sprite direction-${direction} ${moving ? "is-moving" : ""}`}
      aria-hidden="true"
      data-character-role={managedAsset?.role ?? fallback.role}
      data-runtime-id={managedAsset?.runtimeId ?? fallback.runtimeId}
      data-sprite-grid={`${spriteSheet.columns}x${spriteSheet.rows}`}
      data-sprite-frame={`${spriteSheet.frameSize.width}x${spriteSheet.frameSize.height}`}
    >
      <img src={managedAsset?.imageUrl ?? fallback.sheetUrl} alt="" style={imageStyle} />
    </span>
  );
}
