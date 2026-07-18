import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appUrl = new URL("../../web/src/App.tsx", import.meta.url);
const app = readFileSync(appUrl, "utf8");
const css = readFileSync(new URL("../../web/src/styles.css", import.meta.url), "utf8");

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
    expect(modal).toContain("{event.eventTitle}");
    expect(modal).toContain("{event.narration}");
    expect(modal).toContain("{displayedSuggestion}");
    expect(modal).toContain("{navigatorMessage}");
    expect(modal).toMatch(/const displayedSuggestion\s*=\s*(?:suggestion\s*\|\|\s*event\.suggestion|event\.suggestion\s*\|\|\s*suggestion)/);
    expect(modal).not.toContain("clipText(");
  });

  it("pops a fresh resolved event in the stage and opens details only on request", () => {
    expect(presentationEffect).toMatch(/game\.status !== "resolved"/);
    expect(presentationEffect).toMatch(/presentedEventIdRef\.current === latestId\) return;/);
    expect(app).toContain("const [freshEventId, setFreshEventId]");
    expect(presentationEffect).toMatch(/if \(submittedSuggestion\) \{[\s\S]*?setFreshEventId\(latestId\)/);
    expect(presentationEffect.match(/setEventAnnouncementId\(latestId\)/g)).toHaveLength(1);
    expect(app).toContain('fresh={freshEventId === latestEvent?.id}');
    expect(app).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(card).toContain('event-result ${fresh ? "is-fresh" : ""}');
    expect(card).toContain("{event?.eventTitle}");
    expect(card).toContain("clipText(event?.narration");
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

describe("generated furniture integration", () => {
  const manifestUrl = new URL("../../../assets/furniture/manifest.json", import.meta.url);
  const rendererUrl = new URL("../../web/src/furniture-assets.tsx", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
    assets: Array<{ id: string; file: string }>;
  };

  it("statically imports and references all 13 furniture PNGs", () => {
    expect(manifest.assets).toHaveLength(13);
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

  it("connects one generated furniture layer to the shared apartment renderer", () => {
    expect(app).toMatch(/import\s*\{\s*FurnitureSpriteLayer\s*\}\s*from\s*["']\.\/furniture-assets(?:\.js)?["']/);
    expect(app.match(/<FurnitureSpriteLayer\b/g)).toHaveLength(1);
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
    expect(furnitureLayer).toContain("<FurnitureSpriteLayer");
    expect(apartmentStage).toContain("<FurnitureLayer />");
    expect(app).toContain("<ApartmentStage game={game}");
  });
});
