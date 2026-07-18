import aoiSpriteUrl from "../../../../assets/characters/mizuhara-aoi/frames/south-idle.png";
import haruSpriteUrl from "../../../../assets/characters/otani-haru/frames/south-idle.png";

const CHARACTER_SPRITES = {
  haru: haruSpriteUrl,
  aoi: aoiSpriteUrl,
} as const;

export function CharacterSprite({
  person,
  className,
}: {
  person: "haru" | "aoi";
  className?: string;
}) {
  const classes = ["result-character-sprite", className].filter(Boolean).join(" ");

  return (
    <img
      className={classes}
      src={CHARACTER_SPRITES[person]}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
