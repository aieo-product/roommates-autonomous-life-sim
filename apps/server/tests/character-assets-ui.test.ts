import {
  existsSync,
  readFileSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type CharacterManifest = {
  version: number;
  frameSize: { width: number; height: number };
  displaySize: { width: number; height: number };
  pivot: { x: number; y: number };
  sheet: { width: number; height: number; columns: number; rows: number };
  directionOrder: string[];
  animationPresets: Record<string, { columns: string[]; sequence: string[] }>;
  characters: Array<{
    id: string;
    name: string;
    role: string;
    animationPreset: string;
    portrait: string;
    sheet: string;
  }>;
};

const characterRootUrl = new URL("../../../assets/characters/", import.meta.url);
const manifestUrl = new URL("manifest.json", characterRootUrl);
const characterAssetsUrl = new URL("../../web/src/character-assets.tsx", import.meta.url);
const appUrl = new URL("../../web/src/App.tsx", import.meta.url);
const personalityStudioUrl = new URL(
  "../../web/src/personality/PersonalityStudio.tsx",
  import.meta.url,
);
const resultHeroUrl = new URL("../../web/src/result/ResultHero.tsx", import.meta.url);
const highlightsUrl = new URL("../../web/src/result/Highlights.tsx", import.meta.url);
const reflectionsUrl = new URL("../../web/src/result/Reflections.tsx", import.meta.url);
const appCssUrl = new URL("../../web/src/styles.css", import.meta.url);
const resultCssUrl = new URL("../../web/src/result/result.css", import.meta.url);
const webSourceDirectory = fileURLToPath(new URL("../../web/src/", import.meta.url));

const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as CharacterManifest;
const characterAssets = readFileSync(characterAssetsUrl, "utf8");
const app = readFileSync(appUrl, "utf8");
const personalityStudio = readFileSync(personalityStudioUrl, "utf8");
const resultHero = readFileSync(resultHeroUrl, "utf8");
const highlights = readFileSync(highlightsUrl, "utf8");
const reflections = readFileSync(reflectionsUrl, "utf8");
const residentCss = `${readFileSync(appCssUrl, "utf8")}\n${readFileSync(resultCssUrl, "utf8")}`;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pngDimensions = (url: URL): { width: number; height: number } => {
  const image = readFileSync(url);
  if (image.length < 24 || !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${fileURLToPath(url)} is not a valid PNG image`);
  }
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
};

const sourceBetween = (
  source: string,
  startToken: string,
  endTokens: string[],
): string => {
  const start = source.indexOf(startToken);
  expect(start, `${startToken} should exist`).toBeGreaterThanOrEqual(0);
  const ends = endTokens
    .map((token) => source.indexOf(token, start + startToken.length))
    .filter((index) => index > start);
  expect(ends.length, `${startToken} should have a following boundary`).toBeGreaterThan(0);
  return source.slice(start, Math.min(...ends));
};

const expectNamedExport = (source: string, name: string): void => {
  const inlineExport = new RegExp(
    `export\\s+(?:const|function|class)\\s+${escapeRegex(name)}\\b`,
  );
  const exportList = new RegExp(
    `export\\s*\\{[^}]*\\b${escapeRegex(name)}\\b[^}]*\\}`,
    "s",
  );
  expect(
    inlineExport.test(source) || exportList.test(source),
    `${name} should be a named export`,
  ).toBe(true);
};

const expectNamedImport = (
  source: string,
  name: string,
  modulePath: string,
): void => {
  const namedImport = new RegExp(
    `import\\s*\\{[^}]*\\b${escapeRegex(name)}\\b[^}]*\\}\\s*from\\s*["']${escapeRegex(modulePath)}(?:\\.js)?["']`,
    "s",
  );
  expect(
    source,
    `${name} should be imported from ${modulePath}`,
  ).toMatch(namedImport);
};

const readWebSourceTree = (directory: string): string =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: Dirent) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readWebSourceTree(path);
      return /\.(?:css|ts|tsx)$/.test(entry.name) ? readFileSync(path, "utf8") : [];
    })
    .join("\n");

describe("resident character asset manifest", () => {
  it("keeps the sprite geometry and the Haru/Aoi runtime mapping explicit", () => {
    expect(manifest).toMatchObject({
      version: 4,
      frameSize: { width: 128, height: 128 },
      displaySize: { width: 64, height: 64 },
      pivot: { x: 64, y: 118 },
      sheet: { width: 384, height: 512, columns: 3, rows: 4 },
      directionOrder: ["south", "east", "north", "west"],
    });

    expect(manifest.characters.find(({ id }) => id === "otani-haru")).toMatchObject({
      name: "オータニ ハル",
      role: "resident",
      animationPreset: "walk",
      portrait: "otani-haru/portraits/ui-bust-v2.png",
      sheet: "otani-haru/walk-cycle.png",
    });
    expect(manifest.characters.find(({ id }) => id === "mizuhara-aoi")).toMatchObject({
      name: "ミズハラ アオイ",
      role: "resident",
      animationPreset: "walk",
      portrait: "mizuhara-aoi/portraits/ui-bust-v2.png",
      sheet: "mizuhara-aoi/walk-cycle.png",
    });
    expect(manifest.characters.some(({ id }) => id === "producer")).toBe(false);
  });

  it("has a correctly sized sheet and every manifest-derived frame", () => {
    for (const character of manifest.characters) {
      const portraitUrl = new URL(character.portrait, characterRootUrl);
      expect(existsSync(portraitUrl), `${character.portrait} should exist`).toBe(true);
      expect(pngDimensions(portraitUrl), `${character.portrait} should be a 256px UI portrait`).toEqual({
        width: 256,
        height: 256,
      });

      const sheetUrl = new URL(character.sheet, characterRootUrl);
      expect(existsSync(sheetUrl), `${character.sheet} should exist`).toBe(true);
      expect(pngDimensions(sheetUrl), `${character.sheet} should match manifest.sheet`).toEqual({
        width: manifest.sheet.width,
        height: manifest.sheet.height,
      });

      const preset = manifest.animationPresets[character.animationPreset];
      expect(preset, `${character.animationPreset} should exist`).toBeDefined();
      const characterDirectory = character.sheet.replace(/\/walk-cycle\.png$/, "");
      for (const direction of manifest.directionOrder) {
        for (const column of preset?.columns ?? []) {
          const framePath = `${characterDirectory}/frames/${direction}-${column}.png`;
          const frameUrl = new URL(framePath, characterRootUrl);
          expect(existsSync(frameUrl), `${framePath} should exist`).toBe(true);
          expect(pngDimensions(frameUrl), `${framePath} should match manifest.frameSize`).toEqual(
            manifest.frameSize,
          );
        }
      }
    }
  });
});

describe("resident character asset registry", () => {
  const requiredImports = [
    "otani-haru/walk-cycle.png",
    "mizuhara-aoi/walk-cycle.png",
    "otani-haru/portraits/ui-bust-v2.png",
    "mizuhara-aoi/portraits/ui-bust-v2.png",
    "navigator/portraits/ui-bust-v2.png",
  ];

  it("statically imports and references every runtime resident and navigator image", () => {
    for (const assetPath of requiredImports) {
      const importPattern = new RegExp(
        `^import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+["'][^"']*assets/characters/${escapeRegex(assetPath)}(?:\\?url)?["'];?\\s*$`,
        "gm",
      );
      const matches = [...characterAssets.matchAll(importPattern)];
      expect(matches, `${assetPath} should have one top-level static import`).toHaveLength(1);

      const identifier = matches[0]?.[1] ?? "";
      const references = characterAssets.match(
        new RegExp(`\\b${escapeRegex(identifier)}\\b`, "g"),
      )?.length ?? 0;
      expect(
        references,
        `${assetPath} should be retained through residentCharacterAssets`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("exports the shared registry and both resident renderers", () => {
    expectNamedExport(characterAssets, "residentCharacterAssets");
    expectNamedExport(characterAssets, "navigatorCharacterAssets");
    expectNamedExport(characterAssets, "ResidentPortrait");
    expectNamedExport(characterAssets, "ResidentSceneSprite");
    expect(characterAssets).toMatch(
      /residentCharacterAssets(?:\s*:\s*[^=]+)?\s*=\s*\{[\s\S]*?\bharu\s*:/,
    );
    expect(characterAssets).toMatch(
      /residentCharacterAssets(?:\s*:\s*[^=]+)?\s*=\s*\{[\s\S]*?\baoi\s*:/,
    );
    expect(characterAssets).toMatch(/navigatorCharacterAssets\s*=\s*\{[\s\S]*?portraitUrl\s*:/);
    expect(characterAssets).toMatch(
      /haru\s*:\s*\{[\s\S]*?portraitUrl\s*:\s*haruPortraitUrl,[\s\S]*?resultUrl\s*:\s*haruPortraitUrl/,
    );
    expect(characterAssets).toMatch(
      /aoi\s*:\s*\{[\s\S]*?portraitUrl\s*:\s*aoiPortraitUrl,[\s\S]*?resultUrl\s*:\s*aoiPortraitUrl/,
    );
  });

  it("does not import the retired Producer character anywhere in the web app", () => {
    const webSource = readWebSourceTree(webSourceDirectory);
    expect(webSource).not.toContain("assets/characters/producer/");
    expect(characterAssets).not.toContain("import.meta.glob");
  });

  it("preserves pixel art in a 64px resident viewport", () => {
    const rules = [...residentCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) =>
        /\.(?:resident-(?:portrait|scene|sprite)[\w-]*|character-(?:portrait|scene|sprite)[\w-]*)/.test(
          match[1] ?? "",
        ))
      .map((match) => match[2] ?? "");

    expect(rules.length, "resident asset CSS rules should exist").toBeGreaterThan(0);
    expect(
      rules.some((declarations) => /image-rendering\s*:\s*pixelated\s*;?/.test(declarations)),
      "resident images should use nearest-neighbor rendering",
    ).toBe(true);
    expect(
      rules.some((declarations) =>
        /(?:^|;)\s*width\s*:\s*64px\s*;/.test(declarations)
        && /(?:^|;)\s*height\s*:\s*64px\s*;?/.test(declarations)),
      "a resident sprite viewport should be 64px square",
    ).toBe(true);
  });
});

describe("resident character images across the UI", () => {
  it("replaces the live scene sprite and shared PixelPortrait", () => {
    expectNamedImport(app, "ResidentPortrait", "./character-assets");
    expectNamedImport(app, "ResidentSceneSprite", "./character-assets");

    const pixelPortrait = sourceBetween(app, "function PixelPortrait", ["function MetricBar"]);
    const sceneCharacter = sourceBetween(app, "function SceneCharacter", ["function ApartmentStage"]);
    expect(pixelPortrait).toMatch(/<ResidentPortrait\b/);
    expect(pixelPortrait).toMatch(/person=\{person\}/);
    expect(sceneCharacter).toMatch(/<ResidentSceneSprite\b/);
    expect(sceneCharacter).toMatch(/person=\{person\}/);
  });

  it("uses the shared portrait in the personality menu", () => {
    expectNamedImport(personalityStudio, "ResidentPortrait", "../character-assets");
    expect(personalityStudio).toMatch(/<ResidentPortrait\b/);
  });

  it("uses resident images in the result hero, highlights, and reflections", () => {
    expectNamedImport(resultHero, "residentCharacterAssets", "../character-assets");
    expectNamedImport(resultHero, "navigatorCharacterAssets", "../character-assets");
    expect(resultHero).toMatch(/residentCharacterAssets\.haru\.resultUrl/);
    expect(resultHero).toMatch(/residentCharacterAssets\.aoi\.resultUrl/);
    expect(resultHero).toMatch(/navigatorCharacterAssets\.portraitUrl/);

    for (const [name, source] of [
      ["Highlights", highlights],
      ["Reflections", reflections],
    ] as const) {
      expectNamedImport(source, "ResidentPortrait", "../character-assets");
      expect(source, `${name} should render ResidentPortrait`).toMatch(/<ResidentPortrait\b/);
    }

  });

  it("keeps the result portraits large, contained, and responsive", () => {
    expect(residentCss).toMatch(
      /\.result-resident-pair img\s*\{[^}]*width:\s*112px;[^}]*height:\s*112px;[^}]*object-fit:\s*contain;[^}]*image-rendering:\s*pixelated;/,
    );
    expect(residentCss).toMatch(
      /@media \(max-width:\s*560px\)[\s\S]*?\.result-resident-pair img\s*\{[^}]*width:\s*88px;[^}]*height:\s*88px;/,
    );
    expect(residentCss).toMatch(
      /\.result-score-dekopin img\s*\{[^}]*object-fit:\s*contain;[^}]*image-rendering:\s*pixelated;/,
    );
  });
});
