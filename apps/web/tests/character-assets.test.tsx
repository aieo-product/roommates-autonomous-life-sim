import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AssetManagerProvider,
  createDefaultAssetManagerDocument,
} from "../src/assets-manager/index.js";
import {
  ResidentPortrait,
  ResidentSceneSprite,
} from "../src/character-assets.js";

describe("replaceable character slots", () => {
  it("renders the male slot with managed sprite metadata and replacement images", () => {
    const project = createDefaultAssetManagerDocument();
    const male = project.assets.characters.find((asset) => asset.role === "male")!;
    male.imageUrl = "https://cdn.example.com/custom-male-sheet.png";
    male.spriteSheet.canvas.width = 512;
    male.spriteSheet.columns = 4;
    male.spriteSheet.animations.walk = {
      frames: [2, 3],
      frameDurationMs: 90,
      loop: true,
    };

    const markup = renderToStaticMarkup(
      <AssetManagerProvider initialDocument={project} storage={undefined}>
        <ResidentSceneSprite person="haru" direction="west" moving />
      </AssetManagerProvider>,
    );

    expect(markup).toContain('data-character-role="male"');
    expect(markup).toContain('data-runtime-id="haru"');
    expect(markup).toContain('data-sprite-grid="4x4"');
    expect(markup).toContain("custom-male-sheet.png");
    expect(markup).toContain("width:256px");
    expect(markup).toContain("margin-top:-192px");
    expect(markup).toContain("translateX(-128px)");
  });

  it("keeps the caller-provided profile name separate from the asset label", () => {
    const project = createDefaultAssetManagerDocument();
    const female = project.assets.characters.find((asset) => asset.role === "female")!;
    female.label = "差し替え素材の名前";
    female.portraitUrl = "https://cdn.example.com/custom-female-portrait.png";

    const markup = renderToStaticMarkup(
      <AssetManagerProvider initialDocument={project} storage={undefined}>
        <ResidentPortrait person="aoi" alt="プレイヤー設定の名前" />
      </AssetManagerProvider>,
    );

    expect(markup).toContain('alt="プレイヤー設定の名前"');
    expect(markup).toContain("custom-female-portrait.png");
    expect(markup).not.toContain("差し替え素材の名前");
  });
});
