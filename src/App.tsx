import { useState } from "react";
import { CharacterComparison } from "./components/CharacterComparison";
import { CharacterSettingsPanel } from "./components/CharacterSettingsPanel";
import { DecisionDemo } from "./components/DecisionDemo";
import type { CharacterId } from "./domain/characterSettings";
import { useCharacterSettings } from "./hooks/useCharacterSettings";

type StudioView = CharacterId | "compare";

const views: { id: StudioView; label: string }[] = [
  { id: "haru", label: "Haru" },
  { id: "aoi", label: "Aoi" },
  { id: "compare", label: "比較" }
];

export const App = () => {
  const {
    settings,
    savedSettings,
    errorMessage,
    savedAt,
    updateCharacter,
    save,
    resetCharacter,
    resetAll
  } = useCharacterSettings();
  const [activeView, setActiveView] = useState<StudioView>("haru");
  const hasUnsavedChanges =
    JSON.stringify(settings) !== JSON.stringify(savedSettings);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ROOMMATES ホーム">
          <span className="brand__mark" aria-hidden="true">
            R
          </span>
          <span>
            <strong>ROOMMATES</strong>
            <small>CHARACTER STUDIO</small>
          </span>
        </a>
        <div className="topbar__status">
          <span className="status-dot" />
          個性設定はゲームデータと分けて保存
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero__copy">
            <span className="eyebrow">MAKE THEM FEEL ALIVE</span>
            <h1>
              二人らしさを、
              <br />
              暮らしの選択へ。
            </h1>
            <p>
              プロフィールと10の個性パラメータが、提案への判断・台詞・行動理由を変えます。
            </p>
          </div>
          <div className="hero__characters" aria-hidden="true">
            <div className="hero-person hero-person--haru">
              <span>H</span>
              <small>thoughtful</small>
            </div>
            <div className="hero__connection">
              <span />
              <i>same moment</i>
              <span />
            </div>
            <div className="hero-person hero-person--aoi">
              <span>A</span>
              <small>expressive</small>
            </div>
          </div>
        </section>

        <section className="studio" aria-labelledby="studio-title">
          <header className="studio__header">
            <div>
              <span className="eyebrow">01 / CHARACTER SETTINGS</span>
              <h2 id="studio-title">キャラクター設定</h2>
            </div>
            <div className="studio__save-state">
              <span
                className={
                  hasUnsavedChanges
                    ? "save-state save-state--dirty"
                    : "save-state"
                }
              >
                {hasUnsavedChanges
                  ? "未保存の変更があります"
                  : savedAt
                    ? `${savedAt.toLocaleTimeString("ja-JP", {
                        hour: "2-digit",
                        minute: "2-digit"
                      })} に保存`
                    : "保存済み設定を使用中"}
              </span>
              <button
                className="button button--primary"
                type="button"
                onClick={save}
              >
                設定を保存
              </button>
            </div>
          </header>

          <nav className="studio-tabs" aria-label="設定対象">
            {views.map((view) => (
              <button
                key={view.id}
                type="button"
                className={
                  activeView === view.id ? "is-active" : undefined
                }
                aria-pressed={activeView === view.id}
                onClick={() => setActiveView(view.id)}
              >
                {view.label}
                {view.id !== "compare" ? (
                  <span
                    className={`tab-dot tab-dot--${view.id}`}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            ))}
          </nav>

          <div className="studio__content">
            {activeView === "haru" ? (
              <CharacterSettingsPanel
                character={settings.characters.haru}
                accentColor="#4f78a6"
                onChange={(character) =>
                  updateCharacter("haru", character)
                }
                onReset={resetCharacter}
              />
            ) : null}
            {activeView === "aoi" ? (
              <CharacterSettingsPanel
                character={settings.characters.aoi}
                accentColor="#d46d6d"
                onChange={(character) =>
                  updateCharacter("aoi", character)
                }
                onReset={resetCharacter}
              />
            ) : null}
            {activeView === "compare" ? (
              <CharacterComparison settings={settings} />
            ) : null}
          </div>

          <footer className="studio__footer">
            <p>
              保存内容はゲームのリセットとは別に保持され、次のプレイでも再利用できます。
            </p>
            <button
              className="button button--danger"
              type="button"
              onClick={resetAll}
            >
              二人とも初期設定へ戻す
            </button>
          </footer>

          {errorMessage ? (
            <p className="notice notice--error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </section>

        <DecisionDemo settings={savedSettings} />
      </main>

      <footer className="page-footer">
        <span>ROOMMATES / Character Studio</span>
        <span>Personality shapes every choice.</span>
      </footer>
    </div>
  );
};
