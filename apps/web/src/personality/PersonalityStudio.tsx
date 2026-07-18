import { useEffect, useRef, useState } from "react";
import type { CharacterId } from "@roommates/shared";
import { ResidentPortrait } from "../character-assets";
import type { CharacterSettingsController } from "./useCharacterSettings";
import {
  CHARACTER_ACCENTS,
  PERSONALITY_FIELDS,
  tendencyLabel,
  type CharacterProfile,
  type PersonalityCharacter,
  type PersonalityKey,
} from "./model";

type StudioTab = CharacterId | "compare";
const STUDIO_TABS: readonly StudioTab[] = ["haru", "aoi", "compare"];

type PersonalityStudioProps = {
  controller: CharacterSettingsController;
  onClose: () => void;
};

function PersonalitySlider({
  field,
  value,
  accent,
  onChange,
}: {
  field: (typeof PERSONALITY_FIELDS)[number];
  value: number;
  accent: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="personality-trait">
      <span className="personality-trait-heading">
        <span><strong>{field.label}</strong><small>{field.description}</small></span>
        <output style={{ color: accent }}>{value}</output>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={field.label}
        style={{ accentColor: accent }}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="personality-trait-scale">
        <span>{field.lowLabel}</span>
        <b>{tendencyLabel(field, value)}</b>
        <span>{field.highLabel}</span>
      </span>
    </label>
  );
}

function TagEditor({
  id,
  label,
  values,
  onChange,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="personality-tags">
      <legend>{label}</legend>
      {values.map((value, index) => (
        <div className="personality-tag-row" key={`${id}-${index}`}>
          <input
            id={`${id}-${index}`}
            value={value}
            maxLength={40}
            aria-label={`${label} ${index + 1}`}
            onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.currentTarget.value : item))}
          />
          <button
            type="button"
            aria-label={`${value || `${label} ${index + 1}`}を削除`}
            disabled={values.length <= 1}
            onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
          >×</button>
        </div>
      ))}
      <button
        className="personality-tag-add"
        type="button"
        disabled={values.length >= 10}
        onClick={() => onChange([...values, ""])}
      >＋ 追加</button>
    </fieldset>
  );
}

function ProfileEditor({
  characterId,
  profile,
  onChange,
}: {
  characterId: CharacterId;
  profile: CharacterProfile;
  onChange: (profile: CharacterProfile) => void;
}) {
  const update = <Key extends keyof CharacterProfile>(key: Key, value: CharacterProfile[Key]): void => {
    onChange({ ...profile, [key]: value });
  };
  const fieldId = (name: string): string => `personality-${characterId}-${name}`;

  return (
    <div className="personality-profile-grid">
      <label htmlFor={fieldId("name")}>名前<input id={fieldId("name")} value={profile.name} maxLength={20} onChange={(event) => update("name", event.currentTarget.value)} /></label>
      <label htmlFor={fieldId("age")}>年齢<input id={fieldId("age")} type="number" min={18} max={100} value={profile.age} onChange={(event) => update("age", Number(event.currentTarget.value))} /></label>
      <label className="is-wide" htmlFor={fieldId("occupation")}>職業<input id={fieldId("occupation")} value={profile.occupation} maxLength={40} onChange={(event) => update("occupation", event.currentTarget.value)} /></label>
      <label className="is-wide" htmlFor={fieldId("introduction")}>人物紹介<textarea id={fieldId("introduction")} value={profile.introduction} maxLength={160} rows={2} onChange={(event) => update("introduction", event.currentTarget.value)} /></label>
      <TagEditor id={fieldId("likes")} label="好きなこと" values={profile.likes} onChange={(values) => update("likes", values)} />
      <TagEditor id={fieldId("dislikes")} label="苦手なこと" values={profile.dislikes} onChange={(values) => update("dislikes", values)} />
      <label className="is-wide" htmlFor={fieldId("lifeStyle")}>生活習慣<textarea id={fieldId("lifeStyle")} value={profile.lifeStyle} maxLength={160} rows={2} onChange={(event) => update("lifeStyle", event.currentTarget.value)} /></label>
      <label className="is-wide" htmlFor={fieldId("romanceView")}>恋愛観<textarea id={fieldId("romanceView")} value={profile.romanceView} maxLength={160} rows={2} onChange={(event) => update("romanceView", event.currentTarget.value)} /></label>
      <label className="is-wide" htmlFor={fieldId("speechStyle")}>話し方の特徴<textarea id={fieldId("speechStyle")} value={profile.speechStyle} maxLength={160} rows={2} onChange={(event) => update("speechStyle", event.currentTarget.value)} /></label>
    </div>
  );
}

function CharacterEditor({
  character,
  onChange,
  onReset,
}: {
  character: PersonalityCharacter;
  onChange: (character: PersonalityCharacter) => void;
  onReset: () => void;
}) {
  const accent = CHARACTER_ACCENTS[character.id];
  const updatePersonality = (key: PersonalityKey, value: number): void => {
    onChange({ ...character, personality: { ...character.personality, [key]: value } });
  };

  return (
    <section className={`personality-character personality-character-${character.id}`} aria-label={`${character.profile.name}の個性設定`}>
      <header className="personality-character-header">
        <ResidentPortrait person={character.id} className="personality-avatar" />
        <div><small>{character.id === "haru" ? "HARU PROFILE" : "AOI PROFILE"}</small><h3>{character.profile.name}</h3><p>{character.profile.introduction}</p></div>
        <button type="button" onClick={onReset}>この人を初期設定へ</button>
      </header>

      <details className="personality-section" open>
        <summary><span><strong>個性パラメータ</strong><small>行動と台詞へ反映する10の傾向</small></span></summary>
        <div className="personality-trait-grid">
          {PERSONALITY_FIELDS.map((field) => (
            <PersonalitySlider
              key={field.key}
              field={field}
              value={character.personality[field.key]}
              accent={accent}
              onChange={(value) => updatePersonality(field.key, value)}
            />
          ))}
        </div>
      </details>

      <details className="personality-section">
        <summary><span><strong>プロフィール</strong><small>背景・生活習慣・恋愛観・話し方</small></span></summary>
        <ProfileEditor characterId={character.id} profile={character.profile} onChange={(profile) => onChange({ ...character, profile })} />
      </details>
    </section>
  );
}

function CharacterComparison({ controller }: { controller: CharacterSettingsController }) {
  const { haru, aoi } = controller.settings.characters;
  return (
    <section className="personality-comparison" aria-labelledby="personality-comparison-title">
      <header><small>SIDE BY SIDE</small><h3 id="personality-comparison-title">二人の違いを見比べる</h3><p>バーの差が大きいほど、同じきっかけにも異なる反応が生まれます。</p></header>
      <div className="personality-comparison-head" aria-hidden="true"><strong>{haru.profile.name}</strong><span>個性</span><strong>{aoi.profile.name}</strong></div>
      {PERSONALITY_FIELDS.map((field) => {
        const haruValue = haru.personality[field.key];
        const aoiValue = aoi.personality[field.key];
        return (
          <div className="personality-comparison-row" key={field.key}>
            <div className="personality-comparison-bar is-haru"><span style={{ width: `${haruValue}%` }} /><output>{haruValue}</output></div>
            <span>{field.label}</span>
            <div className="personality-comparison-bar is-aoi"><span style={{ width: `${aoiValue}%` }} /><output>{aoiValue}</output></div>
          </div>
        );
      })}
    </section>
  );
}

export function PersonalityStudio({ controller, onClose }: PersonalityStudioProps) {
  const [tab, setTab] = useState<StudioTab>("haru");
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="personality-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="personality-modal" role="dialog" aria-modal="true" aria-labelledby="personality-title" aria-describedby="personality-description">
        <header className="personality-modal-header">
          <div><small>CHARACTER STUDIO</small><h2 id="personality-title">ふたりの個性設定</h2><p id="personality-description">保存した設定は次のターンからHaruとAoiの判断へ反映されます。</p></div>
          <button ref={closeRef} type="button" className="personality-close" onClick={onClose} aria-label="個性設定を閉じる">×</button>
        </header>

        <nav
          className="personality-tabs"
          role="tablist"
          aria-label="個性設定の表示"
          onKeyDown={(event) => {
            const currentIndex = STUDIO_TABS.indexOf(tab);
            let nextIndex: number | undefined;
            if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % STUDIO_TABS.length;
            if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + STUDIO_TABS.length) % STUDIO_TABS.length;
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = STUDIO_TABS.length - 1;
            if (nextIndex === undefined) return;
            event.preventDefault();
            const nextTab = STUDIO_TABS[nextIndex];
            if (!nextTab) return;
            setTab(nextTab);
            requestAnimationFrame(() => document.getElementById(`personality-tab-${nextTab}`)?.focus());
          }}
        >
          {STUDIO_TABS.map((id) => (
            <button key={id} id={`personality-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`personality-panel-${id}`} tabIndex={tab === id ? 0 : -1} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
              {id === "haru" ? controller.settings.characters.haru.profile.name : id === "aoi" ? controller.settings.characters.aoi.profile.name : "比較"}
            </button>
          ))}
        </nav>

        <div className="personality-modal-body" id={`personality-panel-${tab}`} role="tabpanel" aria-labelledby={`personality-tab-${tab}`} tabIndex={0}>
          {tab === "compare" ? (
            <CharacterComparison controller={controller} />
          ) : (
            <CharacterEditor
              character={controller.settings.characters[tab]}
              onChange={(character) => controller.updateCharacter(tab, character)}
              onReset={() => controller.resetCharacter(tab)}
            />
          )}
        </div>

        <footer className="personality-modal-footer">
          <div className="personality-feedback" aria-live="polite">
            {controller.error && <p className="is-error" role="alert">{controller.error}</p>}
            {!controller.error && controller.message && <p>{controller.message}</p>}
            {!controller.error && !controller.message && <p>{controller.isDirty ? "未保存の変更があります。" : controller.savedAt ? `${controller.savedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} に保存しました。` : "現在の設定は保存済みです。"}</p>}
          </div>
          <div className="personality-footer-actions">
            <button type="button" className="is-quiet" onClick={() => controller.resetAll()}>二人とも初期設定へ</button>
            <button type="button" className="is-quiet" disabled={!controller.isDirty} onClick={controller.discard}>変更を取り消す</button>
            <button type="button" className="is-primary" onClick={() => controller.save()}>設定を保存</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
