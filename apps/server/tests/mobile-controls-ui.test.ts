import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../../web/src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../web/src/styles.css", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
const mobileStyles = styles.slice(styles.lastIndexOf("/* Smartphone layout"));

const sourceBetween = (startToken: string, endToken: string): string => {
  const start = app.indexOf(startToken);
  const end = app.indexOf(endToken, start + startToken.length);
  expect(start, `${startToken} should exist`).toBeGreaterThanOrEqual(0);
  expect(end, `${endToken} should follow ${startToken}`).toBeGreaterThan(start);
  return app.slice(start, end);
};

describe("mobile-friendly game controls", () => {
  it("connects compact header and timeline controls to the life-log drawer", () => {
    expect(app).toContain('aria-label="ゲーム情報とメニュー"');
    expect(app.match(/aria-controls="life-log-drawer"/g)).toHaveLength(2);
    expect(app.match(/aria-expanded=\{logOpen\}/g)).toHaveLength(2);
    expect(app).toContain('aria-label="ゲームを最初からやり直す"');
    expect(app).toContain('aria-expanded={personalityOpen}');
  });

  it("makes the life log focusable, dismissible, and restores the opener", () => {
    const drawer = sourceBetween("function LogDrawer", "export default function App");
    expect(drawer).toContain('id="life-log-drawer"');
    expect(drawer).toContain("ref={drawerRef}");
    expect(drawer).toContain("tabIndex={-1}");
    expect(drawer).toContain('keyboardEvent.key !== "Escape"');
    expect(drawer).toContain("previousFocus?.focus({ preventScroll: true })");
    expect(drawer).toContain('aria-controls="life-log-list"');
    expect(drawer).toContain('id="life-log-list"');
    expect(drawer).toContain('role="tabpanel"');
  });

  it("returns schedule-derived cues to the touch-friendly instruction field", () => {
    expect(app).toContain("const suggestionInputRef = useRef<HTMLTextAreaElement | null>(null)");
    expect(app).toContain("ref={suggestionInputRef}");
    expect(app).toContain('enterKeyHint="send"');
    expect(app).toContain("suggestionInputRef.current?.focus({ preventScroll: true })");
    expect(app).toContain("suggestionInputRef.current?.scrollIntoView({");
  });

  it("associates inspector tabs and the currently rendered panel", () => {
    expect(app).toContain('aria-label="住人と共同生活の詳細"');
    expect(app).toContain('id={`inspector-tab-${id}`}');
    expect(app).toContain('aria-controls="inspector-panel"');
    expect(app).toContain('id="inspector-panel"');
    expect(app).toContain('aria-labelledby={`inspector-tab-${inspectorTab}`}');
  });

  it("labels the compact event-card detail action as a dialog opener", () => {
    const card = sourceBetween("function EventCard", "function EventAnnouncementModal");
    expect(card).toContain('aria-haspopup="dialog"');
    expect(card).toContain('aria-label={`${event.eventTitle}の全文を読む`}');
    expect(card.match(/className="event-icon" aria-hidden="true"/g)).toHaveLength(3);
  });
});

describe("smartphone layout contract", () => {
  it("declares a device-width viewport and a compact breakpoint", () => {
    expect(indexHtml).toContain('name="viewport"');
    expect(indexHtml).toContain('content="width=device-width, initial-scale=1.0"');
    expect(mobileStyles).toContain("@media (max-width: 700px)");
  });

  it("releases desktop-only fixed sizing and enables vertical page scrolling", () => {
    expect(mobileStyles).toMatch(/html,\s*body,\s*#root\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?height:\s*auto;/);
    expect(mobileStyles).toMatch(/body\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/);
    expect(mobileStyles).toMatch(/\.app\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*100dvh;[\s\S]*?overflow:\s*visible;/);
  });

  it("stacks the game, producer controls, and inspector into a usable single column", () => {
    expect(mobileStyles).toMatch(/\.game-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(mobileStyles).toMatch(/\.producer-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,1fr\);/);
    expect(mobileStyles).toContain("height: clamp(300px, 82vw, 350px)");
    expect(mobileStyles).toMatch(/\.inspector-panel\s*\{[\s\S]*?overflow:\s*visible;/);
  });

  it("keeps primary actions and the life-log drawer touch friendly", () => {
    expect(mobileStyles).toMatch(/\.dock-actions button\s*\{[^}]*min-height:\s*44px;/);
    expect(mobileStyles).toMatch(/\.advance-button\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/);
    expect(mobileStyles).toMatch(/\.log-drawer\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?78dvh/);
    expect(mobileStyles).toMatch(/\.log-filters button\s*\{[^}]*min-height:\s*44px;/);
  });
});
