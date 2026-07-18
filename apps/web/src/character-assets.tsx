import type { CharacterId } from "@roommates/shared";
import haruWalkCycleUrl from "../../../assets/characters/otani-haru/walk-cycle.png";
import haruSouthIdleUrl from "../../../assets/characters/otani-haru/frames/south-idle.png";
import haruResultUrl from "../../../assets/characters/otani-haru/frames/east-idle.png";
import aoiWalkCycleUrl from "../../../assets/characters/mizuhara-aoi/walk-cycle.png";
import aoiSouthIdleUrl from "../../../assets/characters/mizuhara-aoi/frames/south-idle.png";
import aoiResultUrl from "../../../assets/characters/mizuhara-aoi/frames/west-idle.png";

type ResidentCharacterAsset = {
  sheetUrl: string;
  portraitUrl: string;
  resultUrl: string;
};

export const residentCharacterAssets: Record<CharacterId, ResidentCharacterAsset> = {
  haru: {
    sheetUrl: haruWalkCycleUrl,
    portraitUrl: haruSouthIdleUrl,
    resultUrl: haruResultUrl,
  },
  aoi: {
    sheetUrl: aoiWalkCycleUrl,
    portraitUrl: aoiSouthIdleUrl,
    resultUrl: aoiResultUrl,
  },
};

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
  return (
    <span
      className={`resident-portrait portrait-${person} ${className}`.trim()}
      aria-hidden={alt ? undefined : true}
    >
      <img src={residentCharacterAssets[person].portraitUrl} alt={alt} />
      {thinking && <span className="resident-portrait-thinking">•••</span>}
    </span>
  );
}

export function ResidentSceneSprite({
  person,
  active = false,
}: {
  person: CharacterId;
  active?: boolean;
}) {
  return (
    <span className={`resident-scene-sprite ${active ? "is-active" : ""}`} aria-hidden="true">
      <img src={residentCharacterAssets[person].sheetUrl} alt="" />
    </span>
  );
}
