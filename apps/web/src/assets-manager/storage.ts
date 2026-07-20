import {
  ASSET_MANAGER_STORAGE_KEY,
  AssetManagerValidationError,
  parseAssetManagerJson,
  serializeAssetManagerDocument,
  type AssetManagerDocument,
} from "./model.js";

export type StorageLoadResult = {
  document: AssetManagerDocument;
  error?: string;
};

export const loadAssetManagerDocument = (
  storage: Pick<Storage, "getItem">,
  fallback: AssetManagerDocument,
  key = ASSET_MANAGER_STORAGE_KEY,
): StorageLoadResult => {
  let saved: string | null;
  try {
    saved = storage.getItem(key);
  } catch {
    return {
      document: structuredClone(fallback),
      error: "ブラウザの保存領域を読み取れませんでした。初期設定を使用します。",
    };
  }
  if (!saved) return { document: structuredClone(fallback) };
  try {
    return { document: parseAssetManagerJson(saved) };
  } catch (error) {
    return {
      document: structuredClone(fallback),
      error: error instanceof AssetManagerValidationError
        ? `保存済み設定を読み込めませんでした: ${error.issues[0]?.message ?? error.message}`
        : "保存済み設定を読み込めませんでした。初期設定を使用します。",
    };
  }
};

export const saveAssetManagerDocument = (
  storage: Pick<Storage, "setItem">,
  document: AssetManagerDocument,
  key = ASSET_MANAGER_STORAGE_KEY,
): string | undefined => {
  try {
    storage.setItem(key, serializeAssetManagerDocument(document));
    return undefined;
  } catch (error) {
    if (error instanceof AssetManagerValidationError) {
      return `設定にエラーがあるため保存できません: ${error.issues[0]?.message ?? error.message}`;
    }
    return "ブラウザの保存容量を超えたため保存できませんでした。大きな画像は URL 指定をお試しください。";
  }
};

export const clearAssetManagerDocument = (
  storage: Pick<Storage, "removeItem">,
  key = ASSET_MANAGER_STORAGE_KEY,
): string | undefined => {
  try {
    storage.removeItem(key);
    return undefined;
  } catch {
    return "ブラウザの保存領域をリセットできませんでした。";
  }
};

export const readImageFileAsDataUrl = (
  file: File,
  maxBytes = 4 * 1024 * 1024,
): Promise<string> => {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("画像ファイルを選択してください。"));
  }
  if (file.size > maxBytes) {
    return Promise.reject(new Error("画像は 4 MB 以下にしてください。"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string" && reader.result.startsWith("data:image/")) {
        resolve(reader.result);
      } else {
        reject(new Error("画像を読み込めませんでした。"));
      }
    });
    reader.addEventListener("error", () => reject(new Error("画像を読み込めませんでした。")));
    reader.readAsDataURL(file);
  });
};

