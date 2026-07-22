import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appUrl = new URL("../../web/src/App.tsx", import.meta.url);
const app = readFileSync(appUrl, "utf8");
const css = readFileSync(new URL("../../web/src/styles.css", import.meta.url), "utf8");

type Rect = { x: number; y: number; width: number; height: number };
type Anchor = Rect & { id: string };
type LayoutArea = {
  id: string;
  bounds: Rect | Rect[];
  anchors?: Anchor[];
  blocked?: Rect[];
  zones?: LayoutArea[];
};
type FurnitureManifest = {
  version: number;
  format: string;
  grid: {
    columns: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
    characterFootprint: { width: number; depth: number };
  };
  canvas: { width: number; height: number };
  assets: Array<{
    id: string;
    file: string;
    footprintTiles: { width: number; depth: number };
    render: {
      contentBounds: Rect;
      pivot: { x: number; y: number };
      fitScale?: number;
      flipX?: boolean;
    };
    // v4 read-compatibility fields; v5 assets must use `render`.
    pivot?: { x: number; y: number };
    flipX?: boolean;
  }>;
  defaultScene: {
    instances: Array<{
      instanceId: string;
      assetId: string;
      roomId: string;
      anchorId?: string;
      floorContact: { x: number; y: number };
      pivot?: { x: number; y: number };
      displayScale?: number;
    }>;
  };
};

const overlaps = (left: Rect, right: Rect): boolean =>
  left.x < right.x + right.width
  && left.x + left.width > right.x
  && left.y < right.y + right.height
  && left.y + left.height > right.y;

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

describe("resolved event announcement", () => {
  const card = sourceBetween(
    app,
    "function EventCard",
    ["function EventAnnouncementModal"],
  );
  const modal = sourceBetween(
    app,
    "function EventAnnouncementModal",
    ["function CharacterInspector", "function SchedulePanel"],
  );
  const presentationEffect = sourceBetween(
    app,
    "    const latestId = latestEvent?.id ?? null;",
    ["\n  const selectCharacter"],
  );
  const logDrawer = sourceBetween(
    app,
    "function LogDrawer",
    ["export default function App"],
  );

  it("is a labelled, focus-contained modal with responsive scrolling", () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain('aria-labelledby="event-announcement-title"');
    expect(modal).toContain('aria-describedby="event-announcement-narration"');
    expect(modal).toContain('id="event-announcement-title"');
    expect(modal).toContain('id="event-announcement-narration"');
    expect(modal).toContain('document.body.style.overflow = "hidden"');
    expect(modal).toMatch(/\.key === "Escape"/);
    expect(css).toMatch(/\.event-announcement-scroll\s*\{[\s\S]*?overflow-y:\s*auto;/);
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain("@media (max-height: 800px)");
  });

  it("renders the full event, instruction, and Dekopin response without clipping", () => {
    expect(modal).toContain("{displayText(event.eventTitle)}");
    expect(modal).toContain("{displayText(event.narration)}");
    expect(modal).toContain("{displayedSuggestion}");
    expect(modal).toContain("{displayText(navigatorMessage)}");
    expect(modal).toContain("formatCharacterDisplayText(value, people, event.characterRoster ?? roster)");
    expect(modal).toMatch(/const displayedSuggestion\s*=\s*(?:suggestion\s*\|\|\s*event\.suggestion|event\.suggestion\s*\|\|\s*suggestion)/);
    expect(modal).toContain("const conversation = conversationForEvent(event)");
    expect(modal).toContain('className="event-announcement-conversation"');
    expect(modal).toContain("conversation.map((turn, index)");
    expect(modal).not.toContain("resident.dialogue");
    expect(css).toMatch(/\.event-announcement-conversation\s*\{[\s\S]*?margin-top:\s*13px;/);
    expect(modal).not.toContain("clipText(");
  });

  it("shows the complete authored conversation in archive order", () => {
    expect(logDrawer).toContain("conversationForEvent(event)");
    expect(logDrawer).toContain(".map((turn, index) =>");
    expect(logDrawer).toContain("people[turn.speaker].name");
    expect(logDrawer).not.toContain("event.haruDialogue &&");
    expect(logDrawer).not.toContain("event.aoiDialogue &&");
  });

  it("pops a fresh resolved event in the stage and opens details only on request", () => {
    expect(presentationEffect).toMatch(/game\.status !== "resolved"/);
    expect(presentationEffect).toMatch(/presentedEventIdRef\.current === latestId\) return;/);
    expect(app).toContain("const [freshEventId, setFreshEventId]");
    expect(presentationEffect).toMatch(/if \(submittedSuggestion\) \{[\s\S]*?setFreshEventId\(latestId\)/);
    expect(presentationEffect).toMatch(/if \(submittedSuggestion\) \{[\s\S]*?beginAfterScene\(latestEvent\)/);
    expect(presentationEffect.match(/setEventAnnouncementId\(latestId\)/g)).toHaveLength(1);
    expect(app).toContain('fresh={freshEventId === latestEvent?.id}');
    expect(app).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(card).toContain('event-result ${fresh ? "is-fresh" : ""}');
    expect(card).toContain("{formatCharacterDisplayText(event?.eventTitle, people, event?.characterRoster ?? roster)}");
    expect(card).toContain("clipText(formatCharacterDisplayText(event?.narration, people, event?.characterRoster ?? roster)");
    expect(card).toContain("{navigatorMessage &&");
    expect(card).toContain("全文を読む");
    expect(app).toMatch(/onOpen=\{latestEvent \? \(\) => \{[\s\S]*?setEventAnnouncementId\(latestEvent\.id\)/);
    expect(css).toMatch(/\.event-card\s*\{[\s\S]*?left:\s*18px;[\s\S]*?bottom:\s*15px;[\s\S]*?width:\s*min\(500px,\s*calc\(100% - 36px\)\);/);
    expect(css).toMatch(/\.event-card\.is-fresh\s*\{[\s\S]*?min-height:\s*108px;[\s\S]*?animation:\s*eventCardPop/);
    expect(css).toMatch(/@media \(max-height:\s*800px\)[\s\S]*?\.event-card\s*\{[\s\S]*?bottom:\s*10px;/);
    expect(css).toContain("@keyframes eventCardPop");
    expect(app).toMatch(/eventLog\.find\(\(event\) => event\.id === eventAnnouncementId\)/);
  });

  it("baselines the loaded event id so a saved event does not auto-open", () => {
    expect(app).toContain("useRef<string | null | undefined>(undefined)");
    expect(app).toMatch(/if \(initialLoading\) return;/);
    expect(app).toMatch(/presentedEventIdRef\.current === undefined[\s\S]*?presentedEventIdRef\.current = latestId;[\s\S]*?return;/);
  });

  it("keeps the final event over the result until the player chooses Result", () => {
    expect(app).toMatch(/game\.status !== "resolved"\s*&&\s*game\.status !== "ended"/);
    expect(presentationEffect).toMatch(/if \(game\.status === "ended"\)[\s\S]*?setEventAnnouncementId\(latestId\);[\s\S]*?return;/);
    const resultBranch = sourceBetween(
      app,
      "if (showResult)",
      ["\n  return ("],
    );
    expect(resultBranch).toContain("<ResultScreen");
    expect(resultBranch).toContain("<EventAnnouncementModal");
    expect(resultBranch).toContain('continueLabel="結果を見る"');
    expect(resultBranch).toContain("onClose={closeEventAnnouncement}");
  });

  it("does not treat fast-forward as a fresh manual instruction", () => {
    expect(app).toMatch(/:\s*fastForwardGame\([^)]*\)\);/);
    expect(app).toContain('kind === "reset" ? INITIAL_GAME_STATE : previous');
    expect(app).toMatch(/operationRef\.current = kind;[\s\S]*?setFreshEventId\(null\);[\s\S]*?submittedSuggestionRef\.current = null;/);
    expect(presentationEffect).toMatch(/if \(submittedSuggestion\) \{[\s\S]*?setFreshEventId\(latestId\)/);
  });
});

describe("resident speech bubbles", () => {
  it("connects a visible tail to the character-facing edge", () => {
    expect(app).toContain("resolveSpeechBubblePlacement");
    expect(app).toContain("speech-object-${speechBubble.side}");
    expect(css).toMatch(/\.speech-object,\s*\n\.scene-speech\s*\{[\s\S]*?overflow:\s*visible;/);
    expect(css).toMatch(/\.speech-object-left \.scene-speech::after\s*\{[\s\S]*?right:\s*-8px;/);
    expect(css).toMatch(/\.speech-object-right \.scene-speech::after\s*\{[\s\S]*?left:\s*-8px;/);
    expect(app).toContain('hasCharacterSpeech ? "has-character-speech" : ""');
    expect(css).toMatch(/@media \(max-width:\s*700px\)[\s\S]*?\.apartment-stage\.has-character-speech svg\s*\{[\s\S]*?transform:\s*scale\(1\.04\);/);
  });
});

describe("generated furniture integration", () => {
  const manifestUrl = new URL("../../../assets/furniture/manifest.json", import.meta.url);
  const rendererUrl = new URL("../../web/src/furniture-assets.tsx", import.meta.url);
  const layoutUrl = new URL("../../../docs/room-layout.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as FurnitureManifest;
  const layout = JSON.parse(readFileSync(layoutUrl, "utf8")) as { rooms: LayoutArea[] };
  const areas = layout.rooms.flatMap((room) => [room, ...(room.zones ?? [])]);
  const areaById = new Map(areas.map((area) => [area.id, area]));
  const anchorById = new Map(areas.flatMap((area) => area.anchors ?? []).map((anchor) => [anchor.id, anchor]));
  const assetById = new Map(manifest.assets.map((asset) => [asset.id, asset]));

  const footprintFor = (instance: FurnitureManifest["defaultScene"]["instances"][number]): Rect => {
    const asset = assetById.get(instance.assetId);
    expect(asset, `${instance.instanceId} should reference a registered asset`).toBeDefined();
    return {
      x: instance.floorContact.x - (asset?.footprintTiles.width ?? 0),
      y: instance.floorContact.y - (asset?.footprintTiles.depth ?? 0),
      width: asset?.footprintTiles.width ?? 0,
      height: asset?.footprintTiles.depth ?? 0,
    };
  };

  it("statically imports and references all 21 grid furniture PNGs", () => {
    expect(manifest.version).toBe(5);
    expect(manifest.format).toBe("roommates-grid-assets");
    expect(manifest.grid).toEqual({
      columns: 24,
      rows: 18,
      tileWidth: 50,
      tileHeight: 25,
      characterFootprint: { width: 1, depth: 1 },
    });
    expect(manifest.assets).toHaveLength(21);
    expect(manifest.assets.map((asset) => asset.id)).toEqual(expect.arrayContaining([
      "island-kitchen",
      "entry-rug",
    ]));
    expect(existsSync(rendererUrl), "the shared furniture renderer should exist").toBe(true);
    const renderer = readFileSync(rendererUrl, "utf8");

    for (const asset of manifest.assets) {
      expect(
        existsSync(new URL(`../../../assets/furniture/${asset.file}`, import.meta.url)),
        `${asset.file} should exist`,
      ).toBe(true);

      const escapedFile = asset.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const importMatch = renderer.match(new RegExp(
        `import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+["'][^"']*assets/furniture/${escapedFile}["']`,
      ));
      expect(importMatch, `${asset.file} should be statically imported`).not.toBeNull();
      const identifier = importMatch?.[1] ?? "";
      expect(
        renderer.match(new RegExp(`\\b${identifier}\\b`, "g"))?.length ?? 0,
        `${asset.file} should be referenced by the renderer`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("stores portable v5 content metadata instead of per-instance display scales", () => {
    for (const asset of manifest.assets) {
      const { contentBounds, pivot, fitScale = 1 } = asset.render;
      expect(contentBounds.width, `${asset.id} needs a visible pixel width`).toBeGreaterThan(0);
      expect(contentBounds.height, `${asset.id} needs a visible pixel height`).toBeGreaterThan(0);
      expect(contentBounds.x, `${asset.id} content should start on canvas`).toBeGreaterThanOrEqual(0);
      expect(contentBounds.y, `${asset.id} content should start on canvas`).toBeGreaterThanOrEqual(0);
      expect(contentBounds.x + contentBounds.width).toBeLessThanOrEqual(manifest.canvas.width);
      expect(contentBounds.y + contentBounds.height).toBeLessThanOrEqual(manifest.canvas.height);
      expect(pivot.x, `${asset.id} needs a source-canvas floor pivot`).toBeTypeOf("number");
      expect(pivot.y, `${asset.id} needs a source-canvas floor pivot`).toBeTypeOf("number");
      expect(fitScale, `${asset.id} fitScale is a relative adjustment`).toBeGreaterThan(0);
      expect(asset.pivot, `${asset.id} should not use the v4 top-level pivot`).toBeUndefined();
      expect(asset.flipX, `${asset.id} should not use the v4 top-level flip`).toBeUndefined();
    }

    for (const instance of manifest.defaultScene.instances) {
      expect(instance.displayScale, `${instance.instanceId} must derive its scale from footprint/content`).toBeUndefined();
    }
  });

  it("derives anchor-bound furniture feet from the canonical room anchors", () => {
    for (const instance of manifest.defaultScene.instances) {
      expect(instance.pivot, `${instance.instanceId} should not persist an SVG pixel position`).toBeUndefined();
      if (!instance.anchorId) continue;

      const anchor = anchorById.get(instance.anchorId);
      expect(anchor, `${instance.anchorId} should exist in the canonical layout`).toBeDefined();
      expect(instance.floorContact).toEqual({
        x: (anchor?.x ?? 0) + (anchor?.width ?? 0),
        y: (anchor?.y ?? 0) + (anchor?.height ?? 0),
      });
    }
  });

  it("keeps every furniture footprint on its room floor and clear of fixed areas", () => {
    const footprintsByRoom = new Map<string, Array<{ instanceId: string; rect: Rect }>>();

    for (const instance of manifest.defaultScene.instances) {
      const area = areaById.get(instance.roomId);
      expect(area, `${instance.roomId} should exist in the canonical layout`).toBeDefined();
      expect(Array.isArray(area?.bounds), `${instance.roomId} should have one rectangular floor`).toBe(false);

      const bounds = area?.bounds as Rect;
      const footprint = footprintFor(instance);
      expect(footprint.x, `${instance.instanceId} should stay inside the left wall`).toBeGreaterThanOrEqual(bounds.x);
      expect(footprint.y, `${instance.instanceId} should stay inside the back wall`).toBeGreaterThanOrEqual(bounds.y);
      expect(footprint.x + footprint.width, `${instance.instanceId} should stay inside the right wall`)
        .toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(footprint.y + footprint.height, `${instance.instanceId} should stay inside the front wall`)
        .toBeLessThanOrEqual(bounds.y + bounds.height);

      for (const blocked of area?.blocked ?? []) {
        expect(overlaps(footprint, blocked), `${instance.instanceId} should avoid a blocked floor area`).toBe(false);
      }

      const roomFootprints = footprintsByRoom.get(instance.roomId) ?? [];
      roomFootprints.push({ instanceId: instance.instanceId, rect: footprint });
      footprintsByRoom.set(instance.roomId, roomFootprints);
    }

    for (const roomFootprints of footprintsByRoom.values()) {
      roomFootprints.forEach((left, index) => {
        for (const right of roomFootprints.slice(index + 1)) {
          expect(overlaps(left.rect, right.rect), `${left.instanceId} should not overlap ${right.instanceId}`).toBe(false);
        }
      });
    }
  });

  it("projects tile contacts and resolves sprite frames through the shared grid engine", () => {
    const renderer = readFileSync(rendererUrl, "utf8");
    expect(renderer).toMatch(/import\s*\{\s*projectRoomPoint,\s*type Point\s*\}\s*from\s*["']\.\/room-layout(?:\.js)?["']/);
    expect(renderer).toContain("projectRoomPoint(placement.floorContact.x, placement.floorContact.y)");
    expect(renderer).toContain("resolveAssetRender(manifest, asset, placement)");
    expect(renderer).toContain("resolveAssetSpriteFrame(projectedFloorContact, resolvedRender)");
    expect(renderer).toContain("collectAssetManifestIssues(furnitureManifest)");
    expect(renderer).not.toContain("canvas.width * placement.displayScale");
    expect(renderer).toContain("scale(-1 1)");
    expect(renderer).toMatch(/sort\(\(left, right\) => left\.pivot\.y - right\.pivot\.y\)/);
  });

  it("fits standardized furniture from visible width and logical square cells", () => {
    const expectedFootprints = {
      sofa: { width: 3, depth: 1 },
      "island-kitchen": { width: 1, depth: 2 },
      refrigerator: { width: 1, depth: 1 },
      bathtub: { width: 1, depth: 2 },
      "entry-rug": { width: 2, depth: 1 },
      "balcony-drying-rack": { width: 2, depth: 1 },
    } as const;

    for (const [assetId, footprint] of Object.entries(expectedFootprints)) {
      const asset = manifest.assets.find((candidate) => candidate.id === assetId);
      const instance = manifest.defaultScene.instances.find((candidate) => candidate.assetId === assetId);
      expect(asset?.footprintTiles).toEqual(footprint);
      expect(instance, `${assetId} should be placed in the default scene`).toBeDefined();

      const contentWidth = asset?.render.contentBounds.width ?? 0;
      const relativeFit = asset?.render.fitScale ?? 1;
      const projectedWidth = (footprint.width + footprint.depth) * (manifest.grid.tileWidth / 2);
      const automaticScale = (projectedWidth / contentWidth) * relativeFit;
      expect(automaticScale, `${assetId} should resolve a finite automatic scale`).toBeGreaterThan(0);
      expect(Number.isFinite(automaticScale)).toBe(true);
    }

    expect(manifest.defaultScene.instances.some((instance) => instance.assetId === "island-kitchen")).toBe(true);
    expect(manifest.defaultScene.instances.some((instance) => instance.assetId === "kitchen-counter")).toBe(false);
    expect(manifest.defaultScene.instances.some((instance) => instance.assetId === "entry-rug")).toBe(true);
    expect(manifest.defaultScene.instances.some((instance) => instance.assetId === "entry-shoe-cabinet")).toBe(false);
    expect(anchorById.has("entry_cabinet")).toBe(false);
  });

  it("connects one managed furniture layer to the shared apartment renderer", () => {
    expect(app).toMatch(/import\s*\{[\s\S]*?\bManagedFurnitureSpriteLayer\b[\s\S]*?\}\s*from\s*["']\.\/assets-manager(?:\/index)?(?:\.js)?["']/);
    expect(app.match(/<ManagedFurnitureSpriteLayer\b/g)).toHaveLength(1);
    expect(app.match(/<FurnitureLayer\b/g)).toHaveLength(1);

    const furnitureLayer = sourceBetween(
      app,
      "function FurnitureLayer",
      ["function SceneCharacter"],
    );
    const apartmentStage = sourceBetween(
      app,
      "function ApartmentStage",
      ["function ResolutionProgress", "function EventCard"],
    );
    expect(furnitureLayer).toContain("<ManagedFurnitureSpriteLayer");
    expect(furnitureLayer).toContain('className="door-mark"');
    expect(furnitureLayer).not.toContain('className="entry-rug"');
    expect(furnitureLayer).not.toContain('className="entry-rug-inset"');
    expect(furnitureLayer).toContain('className="rug"');
    expect(furnitureLayer).toContain('className="rail"');
    expect(furnitureLayer).not.toContain('className="wash-furniture"');
    expect(furnitureLayer).not.toContain('className="bath-furniture"');
    expect(furnitureLayer).not.toContain('className="kitchen-furniture"');
    expect(furnitureLayer).not.toContain('className="entry-mat"');
    expect(furnitureLayer).not.toContain('className="laundry"');
    expect(apartmentStage).toContain("<FurnitureLayer />");
    expect(app).toContain("<ApartmentStage game={game}");
  });
});
