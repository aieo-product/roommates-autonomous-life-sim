import type { CharacterId } from "@roommates/shared";
import haruWalkCycleUrl from "../../../assets/characters/otani-haru/walk-cycle.png";
import haruPortraitUrl from "../../../assets/characters/otani-haru/portraits/ui-bust-v2.png";
import aoiWalkCycleUrl from "../../../assets/characters/mizuhara-aoi/walk-cycle.png";
import aoiPortraitUrl from "../../../assets/characters/mizuhara-aoi/portraits/ui-bust-v2.png";
import navigatorPortraitUrl from "../../../assets/characters/navigator/portraits/ui-bust-v2.png";
import type { SpriteDirection } from "./after-scene.js";
import { useManagedCharacterAsset } from "./assets-manager/index.js";

type ResidentCharacterAsset = {
  sheetUrl: string;
  portraitUrl: string;
  resultUrl: string;
};

export const residentCharacterAssets: Record<CharacterId, ResidentCharacterAsset> = {
  haru: {
    sheetUrl: haruWalkCycleUrl,
    portraitUrl: haruPortraitUrl,
    resultUrl: haruPortraitUrl,
  },
  aoi: {
    sheetUrl: aoiWalkCycleUrl,
    portraitUrl: aoiPortraitUrl,
    resultUrl: aoiPortraitUrl,
  },
};

export const navigatorCharacterAssets = {
  portraitUrl: navigatorPortraitUrl,
} as const;

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
  const managedAsset = useManagedCharacterAsset(person);
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
  const managedAsset = useManagedCharacterAsset(person);
  return (
    <span
      className={`resident-scene-sprite direction-${direction} ${moving ? "is-moving" : ""}`}
      aria-hidden="true"
    >
      <img src={managedAsset?.imageUrl ?? residentCharacterAssets[person].sheetUrl} alt="" />
    </span>
  );
}
