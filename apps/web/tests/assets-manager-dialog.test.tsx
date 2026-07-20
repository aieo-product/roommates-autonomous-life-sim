import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AssetManagerDialog,
  AssetManagerProvider,
} from "../src/assets-manager/index.js";

describe("AssetManagerDialog", () => {
  it("renders an accessible modal and the manifest-backed libraries", () => {
    const markup = renderToStaticMarkup(
      <AssetManagerProvider>
        <AssetManagerDialog onClose={() => undefined} />
      </AssetManagerProvider>,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Assets 管理");
    expect(markup).toContain("家具ライブラリ");
    expect(markup).toContain("浴室");
    expect(markup).toContain("JSON 読込");
  });

  it("does not mount the modal when open is false", () => {
    const markup = renderToStaticMarkup(
      <AssetManagerProvider>
        <AssetManagerDialog open={false} onClose={() => undefined} />
      </AssetManagerProvider>,
    );

    expect(markup).toBe("");
  });
});

