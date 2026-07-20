import { useState } from "react";
import { AssetManagerDialog } from "./AssetManagerDialog.js";

/** One-line App integration: renders the menu button and owns dialog state. */
export function AssetManagerLauncher({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`asset-manager-launcher ${className}`.trim()}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">▦</span> Assets
      </button>
      {open && <AssetManagerDialog onClose={() => setOpen(false)} />}
    </>
  );
}

