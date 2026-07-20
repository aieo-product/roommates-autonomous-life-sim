import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { AssetRoomPreview } from "./AssetRoomPreview.js";
import {
  formatImportError,
  useAssetManager,
} from "./AssetManagerContext.js";
import {
  ASSET_ORIENTATIONS,
  ROOM_IDS,
  type AssetKind,
  type AssetOrientation,
  type ManagedCharacterAsset,
  type ManagedFurnitureAsset,
  type ManagedPlacement,
  type ValidationIssue,
} from "./model.js";
import { readImageFileAsDataUrl } from "./storage.js";
import "./assets-manager.css";

const ROOM_LABELS: Record<(typeof ROOM_IDS)[number], string> = {
  haru_room: "ハルの部屋",
  aoi_room: "アオイの部屋",
  entry: "玄関",
  washroom: "洗面所",
  hallway: "廊下",
  bathroom: "浴室",
  kitchen: "キッチン",
  dining: "ダイニング",
  living: "リビング",
  balcony: "バルコニー",
};

const ORIENTATION_LABELS: Record<AssetOrientation, string> = {
  "south-west-to-north-east": "南西 → 北東",
  "south-east-to-north-west": "南東 → 北西",
  "north-east-to-south-west": "北東 → 南西",
  "north-west-to-south-east": "北西 → 南東",
};

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const errorAt = (issues: ValidationIssue[], path: string): string | undefined =>
  issues.find((issue) => issue.path === path)?.message;

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  return (
    <div className={`asset-manager-field ${className}`.trim()}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <small id={hintId}>{hint}</small>}
      {error && <span id={errorId} className="asset-manager-field-error">{error}</span>}
    </div>
  );
}

function ImageFileButton({
  label,
  onRead,
  onError,
}: {
  label: string;
  onRead: (dataUrl: string) => void;
  onError: (message: string) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      onRead(await readImageFileAsDataUrl(file));
    } catch (error) {
      onError(error instanceof Error ? error.message : "画像を読み込めませんでした。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="asset-manager-upload">
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        onChange={(event) => void handleFile(event)}
      />
      <label htmlFor={id} aria-disabled={busy}>{busy ? "読込中…" : label}</label>
    </span>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  error,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
}) {
  return (
    <input
      id={id}
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

export function AssetManagerDialog({
  open = true,
  onClose,
}: {
  open?: boolean;
  onClose: () => void;
}) {
  const controller = useAssetManager();
  const project = controller.document;
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const fieldPrefix = useId().replace(/:/g, "");
  const [kind, setKind] = useState<AssetKind>("furniture");
  const [assetIndex, setAssetIndex] = useState(0);
  const [placementOrdinal, setPlacementOrdinal] = useState(0);
  const [status, setStatus] = useState<string>();

  const assets = project.assets[kind] as Array<ManagedFurnitureAsset | ManagedCharacterAsset>;
  const boundedAssetIndex = Math.min(assetIndex, Math.max(assets.length - 1, 0));
  const asset = assets[boundedAssetIndex];
  const assetBasePath = `assets.${kind}.${boundedAssetIndex}`;
  const placementEntries = useMemo(() => {
    if (!asset) return [];
    return project.placements[kind]
      .map((placement, index) => ({ placement, index }))
      .filter(({ placement }) => placement.assetId === asset.id);
  }, [asset, kind, project.placements]);
  const boundedPlacementOrdinal = Math.min(
    placementOrdinal,
    Math.max(placementEntries.length - 1, 0),
  );
  const placementEntry = placementEntries[boundedPlacementOrdinal];
  const placement = placementEntry?.placement;
  const placementPath = placementEntry
    ? `placements.${kind}.${placementEntry.index}`
    : undefined;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = globalThis.document.activeElement instanceof HTMLElement
      ? globalThis.document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      globalThis.document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    setAssetIndex((index) => Math.min(index, Math.max(assets.length - 1, 0)));
  }, [assets.length]);

  useEffect(() => {
    setPlacementOrdinal(0);
  }, [boundedAssetIndex, kind]);

  if (!open) return null;

  const updateAsset = (
    patch: Partial<ManagedFurnitureAsset> | Partial<ManagedCharacterAsset>,
  ) => {
    if (kind === "furniture") {
      controller.updateAsset("furniture", boundedAssetIndex, patch as Partial<ManagedFurnitureAsset>);
    } else {
      controller.updateAsset("characters", boundedAssetIndex, patch as Partial<ManagedCharacterAsset>);
    }
  };

  const updateRender = (patch: Partial<(typeof asset)["render"]>) => {
    if (!asset) return;
    updateAsset({ render: { ...asset.render, ...patch } });
  };

  const updateCanvasDimension = (axis: "width" | "height", value: number) => {
    if (!asset) return;
    const previousCanvas = asset.render.canvas;
    const bounds = asset.render.contentBounds;
    const contentBounds = bounds
      && bounds.x === 0
      && bounds.y === 0
      && bounds.width === previousCanvas.width
      && bounds.height === previousCanvas.height
      ? { ...bounds, [axis]: value }
      : bounds;
    updateRender({
      canvas: { ...previousCanvas, [axis]: value },
      ...(contentBounds ? { contentBounds } : {}),
    });
  };

  const updateCurrentPlacement = (patch: Partial<ManagedPlacement>) => {
    if (!placementEntry) return;
    controller.updatePlacement(kind, placementEntry.index, patch);
  };

  const switchKind = (nextKind: AssetKind) => {
    setKind(nextKind);
    setAssetIndex(0);
    setPlacementOrdinal(0);
    setStatus(undefined);
  };

  const addAsset = () => {
    const nextIndex = project.assets[kind].length;
    controller.addAsset(kind);
    setAssetIndex(nextIndex);
    setPlacementOrdinal(0);
    setStatus(kind === "furniture" ? "新しい家具を追加しました。" : "新しいキャラクターを追加しました。");
  };

  const removeAsset = () => {
    if (!asset || !window.confirm(`「${asset.label}」と、その配置を削除しますか？`)) return;
    controller.removeAsset(kind, boundedAssetIndex);
    setAssetIndex(Math.max(0, boundedAssetIndex - 1));
    setPlacementOrdinal(0);
    setStatus("asset を削除しました。");
  };

  const addPlacement = () => {
    if (!asset) return;
    controller.addPlacement(kind, asset.id);
    setPlacementOrdinal(placementEntries.length);
    setStatus("新しい配置を追加しました。");
  };

  const removePlacement = () => {
    if (!placementEntry || !window.confirm(`配置「${placementEntry.placement.instanceId}」を削除しますか？`)) return;
    controller.removePlacement(kind, placementEntry.index);
    setPlacementOrdinal(Math.max(0, boundedPlacementOrdinal - 1));
    setStatus("配置を削除しました。");
  };

  const exportJson = () => {
    try {
      const blob = new Blob([controller.exportJson()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement("a");
      link.href = url;
      link.download = `${project.id || "roommates-project"}.json`;
      globalThis.document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus("JSON を書き出しました。");
    } catch (error) {
      setStatus(formatImportError(error));
    }
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setStatus("JSON は 10 MB 以下にしてください。");
      return;
    }
    try {
      controller.importJson(await file.text());
      setAssetIndex(0);
      setPlacementOrdinal(0);
      setStatus("JSON を読み込み、プレビューへ反映しました。");
    } catch (error) {
      setStatus(`読み込みエラー: ${formatImportError(error)}`);
    }
  };

  const reset = () => {
    if (!window.confirm("画像と配置の変更を破棄して、同梱 manifest の初期値へ戻しますか？")) return;
    controller.reset();
    setAssetIndex(0);
    setPlacementOrdinal(0);
    setStatus("初期 manifest に戻しました。");
  };

  const idFor = (name: string) => `${fieldPrefix}-${name}`;
  const issueFor = (suffix: string) => errorAt(controller.validationIssues, `${assetBasePath}.${suffix}`);
  const placementIssueFor = (suffix: string) => placementPath
    ? errorAt(controller.validationIssues, `${placementPath}.${suffix}`)
    : undefined;

  return (
    <div
      className="asset-manager-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="asset-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="asset-manager-header">
          <div>
            <small>ROOMMATES PLATFORM TOOLS</small>
            <h2 id={titleId}>Assets 管理</h2>
            <p id={descriptionId}>1マス規格で画像・占有サイズ・接地点・部屋配置を編集します。変更はこの端末へ自動保存され、プレビューへ即時反映されます。</p>
          </div>
          <button ref={closeButtonRef} className="asset-manager-close" type="button" onClick={onClose} aria-label="Assets 管理を閉じる">×</button>
        </header>

        <div className="asset-manager-toolbar" aria-label="asset 種類とデータ操作">
          <div className="asset-manager-kind-tabs" role="tablist" aria-label="asset 種類">
            <button type="button" role="tab" aria-selected={kind === "furniture"} onClick={() => switchKind("furniture")}>家具 <span>{project.assets.furniture.length}</span></button>
            <button type="button" role="tab" aria-selected={kind === "characters"} onClick={() => switchKind("characters")}>キャラクター <span>{project.assets.characters.length}</span></button>
          </div>
          <div className="asset-manager-data-actions">
            <input ref={importInputRef} type="file" accept="application/json,.json" onChange={(event) => void importJson(event)} aria-label="Assets JSON を読み込む" />
            <button type="button" onClick={() => importInputRef.current?.click()}>JSON 読込</button>
            <button type="button" onClick={exportJson} disabled={controller.validationIssues.length > 0}>JSON 書出</button>
            <button type="button" className="is-danger-quiet" onClick={reset}>初期化</button>
          </div>
        </div>

        {(controller.persistenceError || controller.validationIssues.length > 0 || status) && (
          <div className={`asset-manager-status ${controller.validationIssues.length > 0 ? "has-error" : ""}`} role="status" aria-live="polite">
            {controller.persistenceError && <p>{controller.persistenceError}</p>}
            {controller.validationIssues.length > 0 && (
              <p><strong>{controller.validationIssues.length}件の入力エラー</strong> — 赤い項目を修正すると自動保存と JSON 書出が再開します。</p>
            )}
            {status && <p>{status}</p>}
          </div>
        )}

        <div className="asset-manager-workspace">
          <nav className="asset-manager-library" aria-label={kind === "furniture" ? "家具一覧" : "キャラクター一覧"}>
            <div className="asset-manager-library-heading">
              <strong>{kind === "furniture" ? "家具ライブラリ" : "キャラクター"}</strong>
              <button type="button" onClick={addAsset}>＋ 追加</button>
            </div>
            <div className="asset-manager-asset-list">
              {assets.map((item, index) => (
                <button
                  type="button"
                  key={`${item.id}-${index}`}
                  className={boundedAssetIndex === index ? "is-selected" : ""}
                  aria-pressed={boundedAssetIndex === index}
                  onClick={() => {
                    setAssetIndex(index);
                    setPlacementOrdinal(0);
                    setStatus(undefined);
                  }}
                >
                  <span className="asset-manager-thumb"><img src={kind === "characters" ? (item as ManagedCharacterAsset).portraitUrl : item.imageUrl} alt="" /></span>
                  <span><strong>{item.label}</strong><small>{item.id}</small></span>
                  <em>{item.footprintTiles.width}×{item.footprintTiles.depth}</em>
                </button>
              ))}
              {assets.length === 0 && <p className="asset-manager-empty">まだ登録がありません。「追加」から作成できます。</p>}
            </div>
          </nav>

          {asset ? (
            <div className="asset-manager-editor">
              <section className="asset-manager-form-section" aria-labelledby={`${fieldPrefix}-basic-title`}>
                <div className="asset-manager-section-heading">
                  <div><small>DEFINITION</small><h3 id={`${fieldPrefix}-basic-title`}>Asset 定義</h3></div>
                  <button type="button" className="is-danger-quiet" onClick={removeAsset}>Asset を削除</button>
                </div>

                <div className="asset-manager-image-card">
                  <div className="asset-manager-image-preview">
                    <img
                      src={kind === "characters" ? (asset as ManagedCharacterAsset).portraitUrl : asset.imageUrl}
                      alt={`${asset.label}のプレビュー`}
                      style={{ transform: `scale(${asset.render.flipX ? -1 : 1}, ${asset.render.flipY ? -1 : 1})` }}
                    />
                  </div>
                  <div>
                    <strong>{asset.label}</strong>
                    <span>{asset.render.canvas.width} × {asset.render.canvas.height}px</span>
                    <span>pivot {asset.render.pivot.x}, {asset.render.pivot.y}</span>
                  </div>
                </div>

                <div className="asset-manager-form-grid">
                  <Field label="Asset ID" htmlFor={idFor("asset-id")} error={issueFor("id")}>
                    <input id={idFor("asset-id")} value={asset.id} aria-invalid={issueFor("id") ? true : undefined} aria-describedby={issueFor("id") ? `${idFor("asset-id")}-error` : undefined} onChange={(event) => updateAsset({ id: event.target.value })} />
                  </Field>
                  <Field label="表示名" htmlFor={idFor("asset-label")} error={issueFor("label")}>
                    <input id={idFor("asset-label")} value={asset.label} aria-invalid={issueFor("label") ? true : undefined} aria-describedby={issueFor("label") ? `${idFor("asset-label")}-error` : undefined} onChange={(event) => updateAsset({ label: event.target.value })} />
                  </Field>
                  <Field label={kind === "characters" ? "スプライト画像 URL / Data URL" : "画像 URL / Data URL"} htmlFor={idFor("asset-image")} error={issueFor("imageUrl")} className="is-wide">
                    <div className="asset-manager-url-row">
                      <input id={idFor("asset-image")} value={asset.imageUrl} aria-invalid={issueFor("imageUrl") ? true : undefined} aria-describedby={issueFor("imageUrl") ? `${idFor("asset-image")}-error` : undefined} onChange={(event) => updateAsset({ imageUrl: event.target.value })} />
                      <ImageFileButton label="画像を選択" onRead={(imageUrl) => updateAsset({ imageUrl })} onError={setStatus} />
                    </div>
                  </Field>
                  {kind === "characters" && (
                    <>
                      <Field label="ポートレート URL / Data URL" htmlFor={idFor("portrait-image")} error={issueFor("portraitUrl")} className="is-wide">
                        <div className="asset-manager-url-row">
                          <input id={idFor("portrait-image")} value={(asset as ManagedCharacterAsset).portraitUrl} aria-invalid={issueFor("portraitUrl") ? true : undefined} aria-describedby={issueFor("portraitUrl") ? `${idFor("portrait-image")}-error` : undefined} onChange={(event) => updateAsset({ portraitUrl: event.target.value })} />
                          <ImageFileButton label="画像を選択" onRead={(portraitUrl) => updateAsset({ portraitUrl })} onError={setStatus} />
                        </div>
                      </Field>
                      <Field label="Portrait の相対 file" htmlFor={idFor("portrait-file")} error={issueFor("portraitFile")}>
                        <input id={idFor("portrait-file")} value={(asset as ManagedCharacterAsset).portraitFile} aria-invalid={issueFor("portraitFile") ? true : undefined} onChange={(event) => updateAsset({ portraitFile: event.target.value })} />
                      </Field>
                      <Field label="Runtime slot" htmlFor={idFor("runtime-id")} error={issueFor("runtimeId")}>
                        <select id={idFor("runtime-id")} value={(asset as ManagedCharacterAsset).runtimeId ?? ""} aria-invalid={issueFor("runtimeId") ? true : undefined} onChange={(event) => updateAsset({ runtimeId: event.target.value ? event.target.value as ManagedCharacterAsset["runtimeId"] : undefined })}>
                          <option value="">未割当</option>
                          <option value="haru">Haru</option>
                          <option value="aoi">Aoi</option>
                          <option value="navigator">デコピン</option>
                        </select>
                      </Field>
                      <Field label="Role" htmlFor={idFor("character-role")} error={issueFor("role")}>
                        <input id={idFor("character-role")} value={(asset as ManagedCharacterAsset).role} aria-invalid={issueFor("role") ? true : undefined} onChange={(event) => updateAsset({ role: event.target.value })} />
                      </Field>
                      <Field label="Animation preset" htmlFor={idFor("animation-preset")} error={issueFor("animationPreset")}>
                        <input id={idFor("animation-preset")} value={(asset as ManagedCharacterAsset).animationPreset} aria-invalid={issueFor("animationPreset") ? true : undefined} onChange={(event) => updateAsset({ animationPreset: event.target.value })} />
                      </Field>
                    </>
                  )}
                  <Field label="Pack 内の相対 file" htmlFor={idFor("asset-file")} error={issueFor("file")} hint="JSON 書出後に OSS asset pack へ移す際のパスです。" className="is-wide">
                    <input id={idFor("asset-file")} value={asset.file} aria-invalid={issueFor("file") ? true : undefined} aria-describedby={issueFor("file") ? `${idFor("asset-file")}-error` : `${idFor("asset-file")}-hint`} onChange={(event) => updateAsset({ file: event.target.value })} />
                  </Field>
                </div>
              </section>

              <section className="asset-manager-form-section" aria-labelledby={`${fieldPrefix}-scale-title`}>
                <div className="asset-manager-section-heading"><div><small>GRID STANDARD</small><h3 id={`${fieldPrefix}-scale-title`}>サイズ・向き</h3></div><span className="asset-manager-grid-badge">1 TILE = 1 CHARACTER</span></div>
                <div className="asset-manager-form-grid is-compact">
                  <Field label="占有 幅 (マス)" htmlFor={idFor("footprint-width")} error={issueFor("footprintTiles.width")}>
                    <NumberInput id={idFor("footprint-width")} value={asset.footprintTiles.width} min={1} max={24} error={issueFor("footprintTiles.width")} onChange={(width) => updateAsset({ footprintTiles: { ...asset.footprintTiles, width } })} />
                  </Field>
                  <Field label="占有 奥行 (マス)" htmlFor={idFor("footprint-depth")} error={issueFor("footprintTiles.depth")}>
                    <NumberInput id={idFor("footprint-depth")} value={asset.footprintTiles.depth} min={1} max={18} error={issueFor("footprintTiles.depth")} onChange={(depth) => updateAsset({ footprintTiles: { ...asset.footprintTiles, depth } })} />
                  </Field>
                  <Field label="Pivot X (px)" htmlFor={idFor("pivot-x")} error={issueFor("render.pivot.x")}>
                    <NumberInput id={idFor("pivot-x")} value={asset.render.pivot.x} min={-8192} max={8192} error={issueFor("render.pivot.x")} onChange={(x) => updateRender({ pivot: { ...asset.render.pivot, x } })} />
                  </Field>
                  <Field label="Pivot Y (px)" htmlFor={idFor("pivot-y")} error={issueFor("render.pivot.y")}>
                    <NumberInput id={idFor("pivot-y")} value={asset.render.pivot.y} min={-8192} max={8192} error={issueFor("render.pivot.y")} onChange={(y) => updateRender({ pivot: { ...asset.render.pivot, y } })} />
                  </Field>
                  <Field label="規格への Fit" htmlFor={idFor("fit-scale")} error={issueFor("render.fitScale")} hint="1.0 が footprint 規格どおりです。">
                    <NumberInput id={idFor("fit-scale")} value={asset.render.fitScale} min={0.1} max={4} step={0.05} error={issueFor("render.fitScale")} onChange={(fitScale) => updateRender({ fitScale })} />
                  </Field>
                  <Field label="基本の向き" htmlFor={idFor("orientation")} error={issueFor("orientation")}>
                    <select id={idFor("orientation")} value={asset.orientation} aria-invalid={issueFor("orientation") ? true : undefined} onChange={(event) => updateAsset({ orientation: event.target.value as AssetOrientation })}>
                      {ASSET_ORIENTATIONS.map((orientation) => <option value={orientation} key={orientation}>{ORIENTATION_LABELS[orientation]}</option>)}
                    </select>
                  </Field>
                  <fieldset className="asset-manager-flips">
                    <legend>反転</legend>
                    <label><input type="checkbox" checked={asset.render.flipX} onChange={(event) => updateRender({ flipX: event.target.checked })} /> 左右反転</label>
                    <label><input type="checkbox" checked={asset.render.flipY} onChange={(event) => updateRender({ flipY: event.target.checked })} /> 上下反転</label>
                  </fieldset>
                </div>
                <details className="asset-manager-advanced">
                  <summary>画像キャンバス / Content bounds</summary>
                  <p>画像の透明余白を除いた領域を登録すると、異なるデザインでも同じマス幅へ正確にフィットします。</p>
                  <div className="asset-manager-form-grid is-compact">
                    <Field label="Canvas 幅 (px)" htmlFor={idFor("canvas-width")} error={issueFor("render.canvas.width")}>
                      <NumberInput id={idFor("canvas-width")} value={asset.render.canvas.width} min={1} max={8192} error={issueFor("render.canvas.width")} onChange={(value) => updateCanvasDimension("width", value)} />
                    </Field>
                    <Field label="Canvas 高さ (px)" htmlFor={idFor("canvas-height")} error={issueFor("render.canvas.height")}>
                      <NumberInput id={idFor("canvas-height")} value={asset.render.canvas.height} min={1} max={8192} error={issueFor("render.canvas.height")} onChange={(value) => updateCanvasDimension("height", value)} />
                    </Field>
                    <label className="asset-manager-bounds-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(asset.render.contentBounds)}
                        onChange={(event) => updateRender({
                          contentBounds: event.target.checked
                            ? { x: 0, y: 0, ...asset.render.canvas }
                            : undefined,
                        })}
                      />
                      透明余白を除く
                    </label>
                    {asset.render.contentBounds && (
                      <>
                        <Field label="Bounds X" htmlFor={idFor("bounds-x")} error={issueFor("render.contentBounds.x")}>
                          <NumberInput id={idFor("bounds-x")} value={asset.render.contentBounds.x} min={0} max={8192} error={issueFor("render.contentBounds.x")} onChange={(x) => updateRender({ contentBounds: { ...asset.render.contentBounds!, x } })} />
                        </Field>
                        <Field label="Bounds Y" htmlFor={idFor("bounds-y")} error={issueFor("render.contentBounds.y")}>
                          <NumberInput id={idFor("bounds-y")} value={asset.render.contentBounds.y} min={0} max={8192} error={issueFor("render.contentBounds.y")} onChange={(y) => updateRender({ contentBounds: { ...asset.render.contentBounds!, y } })} />
                        </Field>
                        <Field label="Bounds 幅" htmlFor={idFor("bounds-width")} error={issueFor("render.contentBounds.width")}>
                          <NumberInput id={idFor("bounds-width")} value={asset.render.contentBounds.width} min={1} max={8192} error={issueFor("render.contentBounds.width")} onChange={(width) => updateRender({ contentBounds: { ...asset.render.contentBounds!, width } })} />
                        </Field>
                        <Field label="Bounds 高さ" htmlFor={idFor("bounds-height")} error={issueFor("render.contentBounds.height")}>
                          <NumberInput id={idFor("bounds-height")} value={asset.render.contentBounds.height} min={1} max={8192} error={issueFor("render.contentBounds.height")} onChange={(height) => updateRender({ contentBounds: { ...asset.render.contentBounds!, height } })} />
                        </Field>
                      </>
                    )}
                  </div>
                </details>
              </section>

              <section className="asset-manager-form-section" aria-labelledby={`${fieldPrefix}-placement-title`}>
                <div className="asset-manager-section-heading">
                  <div><small>PLACEMENT</small><h3 id={`${fieldPrefix}-placement-title`}>部屋・接地点</h3></div>
                  <button type="button" onClick={addPlacement}>＋ 配置を追加</button>
                </div>
                {placementEntries.length > 0 ? (
                  <>
                    <div className="asset-manager-placement-tabs" role="tablist" aria-label={`${asset.label}の配置`}>
                      {placementEntries.map(({ placement: item }, ordinal) => (
                        <button key={item.instanceId} type="button" role="tab" aria-selected={boundedPlacementOrdinal === ordinal} onClick={() => setPlacementOrdinal(ordinal)}>{item.instanceId}</button>
                      ))}
                    </div>
                    {placement && (
                      <div className="asset-manager-form-grid is-placement">
                        <Field label="Instance ID" htmlFor={idFor("instance-id")} error={placementIssueFor("instanceId")} className="is-wide">
                          <input id={idFor("instance-id")} value={placement.instanceId} aria-invalid={placementIssueFor("instanceId") ? true : undefined} onChange={(event) => updateCurrentPlacement({ instanceId: event.target.value })} />
                        </Field>
                        <Field label="部屋" htmlFor={idFor("room-id")} error={placementIssueFor("roomId")}>
                          <input id={idFor("room-id")} list={`${fieldPrefix}-rooms`} value={placement.roomId} aria-invalid={placementIssueFor("roomId") ? true : undefined} onChange={(event) => updateCurrentPlacement({ roomId: event.target.value })} />
                          <datalist id={`${fieldPrefix}-rooms`}>{ROOM_IDS.map((roomId) => <option value={roomId} key={roomId}>{ROOM_LABELS[roomId]}</option>)}</datalist>
                        </Field>
                        <Field label="Floor contact X" htmlFor={idFor("floor-x")} error={placementIssueFor("floorContact.x")}>
                          <NumberInput id={idFor("floor-x")} value={placement.floorContact.x} min={0} max={24} step={0.1} error={placementIssueFor("floorContact.x")} onChange={(x) => updateCurrentPlacement({ floorContact: { ...placement.floorContact, x } })} />
                        </Field>
                        <Field label="Floor contact Y" htmlFor={idFor("floor-y")} error={placementIssueFor("floorContact.y")}>
                          <NumberInput id={idFor("floor-y")} value={placement.floorContact.y} min={0} max={18} step={0.1} error={placementIssueFor("floorContact.y")} onChange={(y) => updateCurrentPlacement({ floorContact: { ...placement.floorContact, y } })} />
                        </Field>
                        <Field label="配置ごとの向き" htmlFor={idFor("placement-orientation")} error={placementIssueFor("orientation")}>
                          <select id={idFor("placement-orientation")} value={placement.orientation ?? ""} aria-invalid={placementIssueFor("orientation") ? true : undefined} onChange={(event) => updateCurrentPlacement({ orientation: event.target.value ? event.target.value as AssetOrientation : undefined })}>
                            <option value="">Asset の基本向き</option>
                            {ASSET_ORIENTATIONS.map((orientation) => <option value={orientation} key={orientation}>{ORIENTATION_LABELS[orientation]}</option>)}
                          </select>
                        </Field>
                        <Field label="配置ごとの左右反転" htmlFor={idFor("placement-flip-x")}>
                          <select id={idFor("placement-flip-x")} value={placement.flipX === undefined ? "" : String(placement.flipX)} onChange={(event) => updateCurrentPlacement({ flipX: event.target.value === "" ? undefined : event.target.value === "true" })}>
                            <option value="">Asset の基本設定</option>
                            <option value="false">反転しない</option>
                            <option value="true">左右反転</option>
                          </select>
                        </Field>
                        <Field label="配置ごとの上下反転" htmlFor={idFor("placement-flip-y")}>
                          <select id={idFor("placement-flip-y")} value={placement.flipY === undefined ? "" : String(placement.flipY)} onChange={(event) => updateCurrentPlacement({ flipY: event.target.value === "" ? undefined : event.target.value === "true" })}>
                            <option value="">Asset の基本設定</option>
                            <option value="false">反転しない</option>
                            <option value="true">上下反転</option>
                          </select>
                        </Field>
                        <button type="button" className="asset-manager-remove-placement is-danger-quiet" onClick={removePlacement}>この配置を削除</button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="asset-manager-empty is-inline">まだ部屋に配置されていません。「配置を追加」で接地点を設定できます。</p>
                )}
              </section>
            </div>
          ) : (
            <div className="asset-manager-editor asset-manager-empty-editor"><p>左上の「追加」から asset を登録してください。</p></div>
          )}

          <aside className="asset-manager-preview-column" aria-label="選択中 asset のプレビュー">
            {asset && <AssetRoomPreview asset={asset} placement={placement} character={kind === "characters"} />}
            <section className="asset-manager-spec-card">
              <small>ASSET CONTRACT</small>
              <h3>差し替え規格</h3>
              <ol>
                <li><strong>1 × 1 マス</strong>がキャラクター1人分</li>
                <li>画像の足元を <strong>pivot</strong> に合わせる</li>
                <li>家具は占有する正方形マス数を登録</li>
                <li>配置は <strong>room + floorContact</strong> で管理</li>
              </ol>
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
}
