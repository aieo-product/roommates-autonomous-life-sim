import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createDefaultAssetManagerDocument } from "./defaults.js";
import {
  ASSET_MANAGER_STORAGE_KEY,
  AssetManagerValidationError,
  parseAssetManagerDocument,
  parseAssetManagerJson,
  serializeAssetManagerDocument,
  validateAssetManagerDocument,
  type AssetKind,
  type AssetManagerDocument,
  type ManagedCharacterAsset,
  type ManagedFurnitureAsset,
  type ManagedPlacement,
  type ValidationIssue,
} from "./model.js";
import {
  clearAssetManagerDocument,
  loadAssetManagerDocument,
  saveAssetManagerDocument,
} from "./storage.js";

type AssetForKind<K extends AssetKind> = K extends "furniture"
  ? ManagedFurnitureAsset
  : ManagedCharacterAsset;

export type ResolvedFurniturePlacement = ManagedPlacement & {
  asset: ManagedFurnitureAsset;
  imageUrl: string;
  orientation: ManagedFurnitureAsset["orientation"];
  flipX: boolean;
  flipY: boolean;
};

export type ResolvedCharacterPlacement = ManagedPlacement & {
  asset: ManagedCharacterAsset;
  imageUrl: string;
  portraitUrl: string;
  orientation: ManagedCharacterAsset["orientation"];
  flipX: boolean;
  flipY: boolean;
};

export type AssetManagerController = {
  document: AssetManagerDocument;
  validationIssues: ValidationIssue[];
  persistenceError?: string;
  replaceDocument: (document: AssetManagerDocument) => void;
  importJson: (json: string) => void;
  exportJson: () => string;
  reset: () => void;
  updateAsset: <K extends AssetKind>(kind: K, index: number, patch: Partial<AssetForKind<K>>) => void;
  addAsset: (kind: AssetKind) => void;
  removeAsset: (kind: AssetKind, index: number) => void;
  updatePlacement: (kind: AssetKind, index: number, patch: Partial<ManagedPlacement>) => void;
  addPlacement: (kind: AssetKind, assetId: string) => void;
  removePlacement: (kind: AssetKind, index: number) => void;
  clearPersistenceError: () => void;
};

const AssetManagerContext = createContext<AssetManagerController | null>(null);

const uniqueId = (prefix: string, ids: Iterable<string>): string => {
  const used = new Set(ids);
  if (!used.has(prefix)) return prefix;
  let suffix = 2;
  while (used.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
};

const starterRender = {
  canvas: { width: 256, height: 256 },
  pivot: { x: 128, y: 236 },
  flipX: false,
  flipY: false,
  fitScale: 1,
};

const placeholderImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256' viewBox='0 0 256 256'%3E%3Crect width='256' height='256' rx='24' fill='%23f4efe8'/%3E%3Cpath d='M64 176l46-52 34 34 22-24 30 42H64z' fill='%23b7a99a'/%3E%3Ccircle cx='92' cy='86' r='18' fill='%23d06f58'/%3E%3C/svg%3E";

const createStarterFurniture = (id: string): ManagedFurnitureAsset => ({
  id,
  label: "新しい家具",
  file: `${id}.png`,
  imageUrl: placeholderImage,
  footprintTiles: { width: 1, depth: 1 },
  orientation: "south-west-to-north-east",
  anchorIds: [],
  render: structuredClone(starterRender),
});

const createStarterCharacter = (id: string): ManagedCharacterAsset => ({
  id,
  label: "新しいキャラクター",
  role: "resident",
  animationPreset: "walk",
  file: `${id}/walk-cycle.png`,
  imageUrl: placeholderImage,
  portraitFile: `${id}/portrait.png`,
  portraitUrl: placeholderImage,
  footprintTiles: { width: 1, depth: 1 },
  orientation: "south-west-to-north-east",
  render: {
    canvas: { width: 128, height: 128 },
    pivot: { x: 64, y: 118 },
    flipX: false,
    flipY: false,
    fitScale: 1,
  },
});

const getBrowserStorage = (): Storage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function AssetManagerProvider({
  children,
  initialDocument,
  storageKey = ASSET_MANAGER_STORAGE_KEY,
  storage = getBrowserStorage(),
}: {
  children: ReactNode;
  initialDocument?: AssetManagerDocument;
  storageKey?: string;
  storage?: Storage;
}) {
  const defaultsRef = useRef<AssetManagerDocument>(
    structuredClone(initialDocument ?? createDefaultAssetManagerDocument()),
  );
  const initial = useMemo(() => {
    if (!storage) return { document: structuredClone(defaultsRef.current) };
    return loadAssetManagerDocument(storage, defaultsRef.current, storageKey);
  }, [storage, storageKey]);
  const [document, setDocument] = useState<AssetManagerDocument>(initial.document);
  const [persistenceError, setPersistenceError] = useState<string | undefined>(initial.error);
  const validationIssues = useMemo(() => validateAssetManagerDocument(document), [document]);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!storage) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (validationIssues.length > 0) return;
    setPersistenceError(saveAssetManagerDocument(storage, document, storageKey));
  }, [document, storage, storageKey, validationIssues.length]);

  const replaceDocument = useCallback((next: AssetManagerDocument) => {
    setDocument(parseAssetManagerDocument(next));
    setPersistenceError(undefined);
  }, []);

  const importJson = useCallback((json: string) => {
    setDocument(parseAssetManagerJson(json));
    setPersistenceError(undefined);
  }, []);

  const exportJson = useCallback(() => serializeAssetManagerDocument(document), [document]);

  const reset = useCallback(() => {
    setDocument(structuredClone(defaultsRef.current));
    setPersistenceError(storage
      ? clearAssetManagerDocument(storage, storageKey)
      : undefined);
  }, [storage, storageKey]);

  const updateAsset = useCallback(<K extends AssetKind>(
    kind: K,
    index: number,
    patch: Partial<AssetForKind<K>>,
  ) => {
    setDocument((previous) => {
      const next = structuredClone(previous);
      const assets = next.assets[kind] as Array<ManagedFurnitureAsset | ManagedCharacterAsset>;
      const current = assets[index];
      if (!current) return previous;
      const oldId = current.id;
      const updated = { ...current, ...patch } as ManagedFurnitureAsset | ManagedCharacterAsset;
      // Placement references use the public asset ID. Refusing an in-editor
      // duplicate prevents a later rename from ambiguously reassigning every
      // instance that shares that ID. Imported duplicates are still surfaced
      // by the document validator.
      if (
        updated.id !== oldId
        && assets.some((candidate, candidateIndex) => (
          candidateIndex !== index && candidate.id === updated.id
        ))
      ) {
        return previous;
      }
      assets[index] = updated;
      if (updated.id !== oldId) {
        next.placements[kind].forEach((placement) => {
          if (placement.assetId === oldId) placement.assetId = updated.id;
        });
      }
      return next;
    });
  }, []);

  const addAsset = useCallback((kind: AssetKind): void => {
    setDocument((previous) => {
      const next = structuredClone(previous);
      const assets = next.assets[kind] as Array<ManagedFurnitureAsset | ManagedCharacterAsset>;
      const id = uniqueId(
        kind === "furniture" ? "new-furniture" : "new-character",
        assets.map((asset) => asset.id),
      );
      assets.push(kind === "furniture" ? createStarterFurniture(id) : createStarterCharacter(id));
      const instanceId = uniqueId(`${id}-start`, next.placements[kind].map((item) => item.instanceId));
      next.placements[kind].push({
        instanceId,
        assetId: id,
        roomId: kind === "furniture" ? "living" : "haru_room",
        floorContact: kind === "furniture" ? { x: 18, y: 12 } : { x: 4, y: 4 },
      });
      return next;
    });
  }, []);

  const removeAsset = useCallback((kind: AssetKind, index: number) => {
    setDocument((previous) => {
      const next = structuredClone(previous);
      const assets = next.assets[kind] as Array<ManagedFurnitureAsset | ManagedCharacterAsset>;
      const removed = assets[index];
      if (!removed) return previous;
      assets.splice(index, 1);
      next.placements[kind] = next.placements[kind].filter(
        (placement) => placement.assetId !== removed.id,
      );
      return next;
    });
  }, []);

  const updatePlacement = useCallback((
    kind: AssetKind,
    index: number,
    patch: Partial<ManagedPlacement>,
  ) => {
    setDocument((previous) => {
      const current = previous.placements[kind][index];
      if (!current) return previous;
      const next = structuredClone(previous);
      next.placements[kind][index] = { ...current, ...patch };
      return next;
    });
  }, []);

  const addPlacement = useCallback((kind: AssetKind, assetId: string): void => {
    setDocument((previous) => {
      const next = structuredClone(previous);
      const placements = next.placements[kind];
      placements.push({
        instanceId: uniqueId(`${assetId}-instance`, placements.map((item) => item.instanceId)),
        assetId,
        roomId: "living",
        floorContact: { x: 18, y: 12 },
      });
      return next;
    });
  }, []);

  const removePlacement = useCallback((kind: AssetKind, index: number) => {
    setDocument((previous) => {
      if (!previous.placements[kind][index]) return previous;
      const next = structuredClone(previous);
      next.placements[kind].splice(index, 1);
      return next;
    });
  }, []);

  const value = useMemo<AssetManagerController>(() => ({
    document,
    validationIssues,
    persistenceError,
    replaceDocument,
    importJson,
    exportJson,
    reset,
    updateAsset,
    addAsset,
    removeAsset,
    updatePlacement,
    addPlacement,
    removePlacement,
    clearPersistenceError: () => setPersistenceError(undefined),
  }), [
    addAsset,
    addPlacement,
    document,
    exportJson,
    importJson,
    persistenceError,
    removeAsset,
    removePlacement,
    replaceDocument,
    reset,
    updateAsset,
    updatePlacement,
    validationIssues,
  ]);

  return <AssetManagerContext.Provider value={value}>{children}</AssetManagerContext.Provider>;
}

export const useAssetManager = (): AssetManagerController => {
  const context = useContext(AssetManagerContext);
  if (!context) throw new Error("useAssetManager must be used inside AssetManagerProvider");
  return context;
};

export const resolveFurnitureScene = (
  document: AssetManagerDocument,
): ResolvedFurniturePlacement[] => {
  const assets = new Map(document.assets.furniture.map((asset) => [asset.id, asset]));
  return document.placements.furniture.flatMap((placement) => {
    const asset = assets.get(placement.assetId);
    if (!asset) return [];
    return [{
      ...placement,
      asset,
      imageUrl: asset.imageUrl,
      orientation: placement.orientation ?? asset.orientation,
      flipX: placement.flipX ?? asset.render.flipX,
      flipY: placement.flipY ?? asset.render.flipY,
    }];
  });
};

export const resolveCharacterScene = (
  document: AssetManagerDocument,
): ResolvedCharacterPlacement[] => {
  const assets = new Map(document.assets.characters.map((asset) => [asset.id, asset]));
  return document.placements.characters.flatMap((placement) => {
    const asset = assets.get(placement.assetId);
    if (!asset) return [];
    return [{
      ...placement,
      asset,
      imageUrl: asset.imageUrl,
      portraitUrl: asset.portraitUrl,
      orientation: placement.orientation ?? asset.orientation,
      flipX: placement.flipX ?? asset.render.flipX,
      flipY: placement.flipY ?? asset.render.flipY,
    }];
  });
};

export const useManagedFurnitureScene = (): ResolvedFurniturePlacement[] => {
  const { document } = useAssetManager();
  return useMemo(() => resolveFurnitureScene(document), [document]);
};

export const useManagedCharacterScene = (): ResolvedCharacterPlacement[] => {
  const { document } = useAssetManager();
  return useMemo(() => resolveCharacterScene(document), [document]);
};

export const useManagedCharacterAsset = (
  runtimeOrAssetId: "haru" | "aoi" | "navigator" | string,
): ManagedCharacterAsset | undefined => {
  const { document } = useAssetManager();
  return useMemo(
    () => document.assets.characters.find(
      (asset) => asset.runtimeId === runtimeOrAssetId || asset.id === runtimeOrAssetId,
    ),
    [document, runtimeOrAssetId],
  );
};

export const formatImportError = (error: unknown): string => {
  if (error instanceof AssetManagerValidationError) {
    return error.issues.slice(0, 4).map((issue) => `${issue.path}: ${issue.message}`).join(" / ");
  }
  return error instanceof Error ? error.message : "設定を読み込めませんでした。";
};
