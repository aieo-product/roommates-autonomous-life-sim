#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  normalize,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FORMAT_VERSION = 1;
const PORTABLE_FORMATS = new Set([
  "roommates.asset-pack",
  "roommates.character-pack",
  "roommates.room-pack",
  "roommates.project",
]);
const ORIENTATIONS = new Set([
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
  "south-west-to-north-east",
  "south-east-to-north-west",
  "north-east-to-south-west",
  "north-west-to-south-east",
]);
const CARDINAL_DIRECTIONS = ["south", "east", "north", "west"];
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "..");

const defaultTargets = [
  "assets/furniture/manifest.json",
  "assets/characters/manifest.json",
  "docs/room-layout.json",
  "docs/examples/roommates-asset-format-v1/asset-pack.json",
  "docs/examples/roommates-asset-format-v1/character-pack.json",
  "docs/examples/roommates-asset-format-v1/room-pack.json",
];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isPositiveNumber = (value) => isFiniteNumber(value) && value > 0;
const isNonNegativeNumber = (value) => isFiniteNumber(value) && value >= 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const jsonPath = (base, key) => typeof key === "number" ? `${base}[${key}]` : `${base}.${key}`;

const pushError = (errors, source, path, message) => {
  errors.push({ source, path, message });
};

const expectRecord = (value, errors, source, path) => {
  if (!isRecord(value)) {
    pushError(errors, source, path, "must be an object");
    return false;
  }
  return true;
};

const expectArray = (value, errors, source, path, { nonEmpty = false } = {}) => {
  if (!Array.isArray(value)) {
    pushError(errors, source, path, "must be an array");
    return false;
  }
  if (nonEmpty && value.length === 0) {
    pushError(errors, source, path, "must contain at least one item");
  }
  return true;
};

const expectString = (value, errors, source, path, { nonEmpty = true } = {}) => {
  if (typeof value !== "string" || (nonEmpty && value.trim().length === 0)) {
    pushError(errors, source, path, nonEmpty ? "must be a non-empty string" : "must be a string");
    return false;
  }
  return true;
};

const rejectUnknown = (value, allowedKeys, errors, source, path) => {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      pushError(errors, source, jsonPath(path, key), "is not part of Roommates Asset Format v1");
    }
  }
};

const validateId = (value, errors, source, path) => {
  if (expectString(value, errors, source, path) && !ID_PATTERN.test(value)) {
    pushError(errors, source, path, "must use lowercase letters, digits, '.', '_' or '-' and may not start/end with punctuation");
  }
};

const validateBoolean = (value, errors, source, path) => {
  if (typeof value !== "boolean") pushError(errors, source, path, "must be a boolean");
};

const validatePoint = (value, errors, source, path, { nonNegative = false } = {}) => {
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set(["x", "y"]), errors, source, path);
  for (const axis of ["x", "y"]) {
    const valid = nonNegative ? isNonNegativeNumber(value[axis]) : isFiniteNumber(value[axis]);
    if (!valid) {
      pushError(errors, source, jsonPath(path, axis), nonNegative ? "must be a finite number >= 0" : "must be a finite number");
    }
  }
};

const validateSize = (value, errors, source, path, { integer = true, depthKey = "height" } = {}) => {
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set(["width", depthKey]), errors, source, path);
  for (const key of ["width", depthKey]) {
    const valid = integer ? isPositiveInteger(value[key]) : isPositiveNumber(value[key]);
    if (!valid) pushError(errors, source, jsonPath(path, key), `must be a positive ${integer ? "integer" : "number"}`);
  }
};

const validateRect = (value, errors, source, path, { integer = false } = {}) => {
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set(["x", "y", "width", "height"]), errors, source, path);
  for (const key of ["x", "y"]) {
    const valid = integer ? Number.isInteger(value[key]) && value[key] >= 0 : isNonNegativeNumber(value[key]);
    if (!valid) pushError(errors, source, jsonPath(path, key), `must be a non-negative ${integer ? "integer" : "number"}`);
  }
  for (const key of ["width", "height"]) {
    const valid = integer ? isPositiveInteger(value[key]) : isPositiveNumber(value[key]);
    if (!valid) pushError(errors, source, jsonPath(path, key), `must be a positive ${integer ? "integer" : "number"}`);
  }
};

const validateFootprint = (value, errors, source, path, { character = false } = {}) => {
  validateSize(value, errors, source, path, { depthKey: "depth" });
  if (character && isRecord(value) && (value.width !== 1 || value.depth !== 1)) {
    pushError(errors, source, path, "characters must occupy exactly 1 x 1 logical tile");
  }
};

const validateCanvas = (value, errors, source, path) => {
  validateSize(value, errors, source, path);
};

const validateOrientation = (value, errors, source, path) => {
  if (expectString(value, errors, source, path) && !ORIENTATIONS.has(value)) {
    pushError(errors, source, path, `must be one of: ${[...ORIENTATIONS].join(", ")}`);
  }
};

const validateLicense = (value, errors, source, path, { required = true } = {}) => {
  if (value === undefined && !required) return;
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set(["spdx", "attribution", "source"]), errors, source, path);
  if (expectString(value.spdx, errors, source, jsonPath(path, "spdx"))) {
    if (!/^(?:[A-Za-z0-9.-]+|LicenseRef-[A-Za-z0-9.-]+)(?:\s+(?:AND|OR)\s+(?:[A-Za-z0-9.-]+|LicenseRef-[A-Za-z0-9.-]+))*$/.test(value.spdx)) {
      pushError(errors, source, jsonPath(path, "spdx"), "must be an SPDX identifier/expression or LicenseRef-* value");
    }
  }
  expectString(value.attribution, errors, source, jsonPath(path, "attribution"));
  if (value.source !== undefined) expectString(value.source, errors, source, jsonPath(path, "source"));
};

const validateExtensions = (value, errors, source, path) => {
  if (value === undefined) return;
  if (!expectRecord(value, errors, source, path)) return;
  for (const key of Object.keys(value)) {
    if (!key.includes(".")) {
      pushError(errors, source, jsonPath(path, key), "extension keys must be namespaced (for example, org.example.feature)");
    }
  }
};

const safeRelativePath = (value) => {
  if (typeof value !== "string" || value.trim() === "" || isAbsolute(value) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) return false;
  if (value.includes("\0")) return false;
  const rawSegments = value.replaceAll("\\", "/").split("/");
  if (rawSegments.includes("..")) return false;
  const normalized = normalize(value).replaceAll("\\", "/");
  return normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../");
};

const safeImageSource = (value) => {
  if (typeof value !== "string" || value.trim() === "" || /^(?:javascript|vbscript):/i.test(value.trim())) return false;
  if (/^data:/i.test(value.trim())) return /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value.trim());
  return /^(?:https?:|blob:|\/|\.\/|\.\.\/)/i.test(value.trim());
};

const validateImageSource = (value, errors, source, path) => {
  if (!expectString(value, errors, source, path)) return;
  if (!safeImageSource(value)) {
    pushError(errors, source, path, "must be an HTTPS, Blob, relative, or image Data URL");
  }
};

const readPngDimensions = (path) => {
  const image = readFileSync(path);
  if (image.length < 24 || !image.subarray(0, 8).equals(PNG_SIGNATURE) || image.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("is not a valid PNG image");
  }
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
};

const validateFile = (value, errors, source, path, options, expectedCanvas) => {
  if (!expectString(value, errors, source, path)) return;
  if (!safeRelativePath(value)) {
    pushError(errors, source, path, "must be a safe path relative to the pack root (absolute paths, URLs and '..' are not allowed)");
    return;
  }
  if (!options.checkFiles) return;
  const filePath = resolve(options.baseDir, value);
  const relativePath = relative(options.baseDir, filePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    pushError(errors, source, path, "resolves outside the pack root");
    return;
  }
  if (!existsSync(filePath)) {
    pushError(errors, source, path, `does not exist: ${value}`);
    return;
  }
  if (value.toLowerCase().endsWith(".png") && expectedCanvas && isRecord(expectedCanvas)) {
    try {
      const dimensions = readPngDimensions(filePath);
      if (dimensions.width !== expectedCanvas.width || dimensions.height !== expectedCanvas.height) {
        pushError(
          errors,
          source,
          path,
          `PNG is ${dimensions.width} x ${dimensions.height}, expected ${expectedCanvas.width} x ${expectedCanvas.height}`,
        );
      }
    } catch (error) {
      pushError(errors, source, path, error instanceof Error ? error.message : "cannot read PNG dimensions");
    }
  }
};

const validateRender = (value, errors, source, path, {
  required = true,
  contentBoundsRequired = required,
  booleansRequired = false,
  fitScaleRequired = false,
  inheritedCanvas,
} = {}) => {
  if (value === undefined && !required) return inheritedCanvas;
  if (!expectRecord(value, errors, source, path)) return inheritedCanvas;
  rejectUnknown(value, new Set(["canvas", "contentBounds", "pivot", "flipX", "flipY", "fitScale"]), errors, source, path);
  const canvas = value.canvas ?? inheritedCanvas;
  if (value.canvas !== undefined) validateCanvas(value.canvas, errors, source, jsonPath(path, "canvas"));
  else if (!canvas && required) pushError(errors, source, jsonPath(path, "canvas"), "is required");
  if (value.contentBounds === undefined) {
    if (contentBoundsRequired) pushError(errors, source, jsonPath(path, "contentBounds"), "is required");
  } else {
    validateRect(value.contentBounds, errors, source, jsonPath(path, "contentBounds"), { integer: true });
  }
  if (value.pivot === undefined) {
    if (required) pushError(errors, source, jsonPath(path, "pivot"), "is required");
  } else {
    validatePoint(value.pivot, errors, source, jsonPath(path, "pivot"), { nonNegative: true });
  }
  if (value.flipX !== undefined) validateBoolean(value.flipX, errors, source, jsonPath(path, "flipX"));
  else if (booleansRequired) pushError(errors, source, jsonPath(path, "flipX"), "is required");
  if (value.flipY !== undefined) validateBoolean(value.flipY, errors, source, jsonPath(path, "flipY"));
  else if (booleansRequired) pushError(errors, source, jsonPath(path, "flipY"), "is required");
  if (value.fitScale !== undefined && !isPositiveNumber(value.fitScale)) {
    pushError(errors, source, jsonPath(path, "fitScale"), "must be a positive number");
  } else if (value.fitScale === undefined && fitScaleRequired) {
    pushError(errors, source, jsonPath(path, "fitScale"), "is required");
  }
  if (isRecord(canvas)) {
    if (isRecord(value.contentBounds)
      && isFiniteNumber(value.contentBounds.x)
      && isFiniteNumber(value.contentBounds.y)
      && isFiniteNumber(value.contentBounds.width)
      && isFiniteNumber(value.contentBounds.height)
      && (value.contentBounds.x + value.contentBounds.width > canvas.width
        || value.contentBounds.y + value.contentBounds.height > canvas.height)) {
      pushError(errors, source, jsonPath(path, "contentBounds"), "must fit inside render.canvas");
    }
    if (isRecord(value.pivot)
      && isFiniteNumber(value.pivot.x)
      && isFiniteNumber(value.pivot.y)
      && (value.pivot.x > canvas.width || value.pivot.y > canvas.height)) {
      pushError(errors, source, jsonPath(path, "pivot"), "must be inside or on the edge of render.canvas");
    }
  }
  return canvas;
};

const validateAssetDefinition = (value, errors, source, path, options, {
  strict = true,
  editor = false,
  inheritedCanvas,
} = {}) => {
  if (!expectRecord(value, errors, source, path)) return;
  if (strict) {
    rejectUnknown(value, new Set([
      "id", "label", "kind", "file", "imageUrl", "footprintTiles", "orientation",
      "anchorIds", "render", "license", "extensions",
    ]), errors, source, path);
  }
  validateId(value.id, errors, source, jsonPath(path, "id"));
  if (value.label !== undefined) expectString(value.label, errors, source, jsonPath(path, "label"));
  else if (strict) pushError(errors, source, jsonPath(path, "label"), "is required");
  if (value.kind !== undefined && !["furniture", "fixture", "prop"].includes(value.kind)) {
    pushError(errors, source, jsonPath(path, "kind"), "must be furniture, fixture or prop");
  }
  if (value.file === undefined) pushError(errors, source, jsonPath(path, "file"), "is required");
  if (editor && value.imageUrl === undefined) pushError(errors, source, jsonPath(path, "imageUrl"), "is required in an editor project");
  validateFootprint(value.footprintTiles, errors, source, jsonPath(path, "footprintTiles"));
  validateOrientation(value.orientation, errors, source, jsonPath(path, "orientation"));
  const canvas = validateRender(value.render, errors, source, jsonPath(path, "render"), {
    required: true,
    contentBoundsRequired: !editor,
    booleansRequired: editor,
    fitScaleRequired: editor,
    inheritedCanvas,
  });
  if (value.file !== undefined) validateFile(value.file, errors, source, jsonPath(path, "file"), options, canvas);
  if (value.imageUrl !== undefined) validateImageSource(value.imageUrl, errors, source, jsonPath(path, "imageUrl"));
  if (value.anchorIds !== undefined && expectArray(value.anchorIds, errors, source, jsonPath(path, "anchorIds"))) {
    const seen = new Set();
    value.anchorIds.forEach((anchorId, index) => {
      const itemPath = jsonPath(jsonPath(path, "anchorIds"), index);
      validateId(anchorId, errors, source, itemPath);
      if (seen.has(anchorId)) pushError(errors, source, itemPath, `duplicates anchor id '${anchorId}'`);
      seen.add(anchorId);
    });
  }
  if (value.license !== undefined) validateLicense(value.license, errors, source, jsonPath(path, "license"));
  validateExtensions(value.extensions, errors, source, jsonPath(path, "extensions"));
};

const validateDirectionRows = (value, errors, source, path, rows) => {
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set(CARDINAL_DIRECTIONS), errors, source, path);
  for (const direction of CARDINAL_DIRECTIONS) {
    if (!Number.isInteger(value[direction]) || value[direction] < 0 || value[direction] >= rows) {
      pushError(errors, source, jsonPath(path, direction), `must be an integer row index from 0 to ${Math.max(rows - 1, 0)}`);
    }
  }
};

const validateAnimations = (value, errors, source, path, columns) => {
  if (!expectRecord(value, errors, source, path)) return;
  if (Object.keys(value).length === 0) pushError(errors, source, path, "must define at least one animation");
  for (const [name, animation] of Object.entries(value)) {
    const animationPath = jsonPath(path, name);
    if (!expectRecord(animation, errors, source, animationPath)) continue;
    rejectUnknown(animation, new Set(["frames", "frameDurationMs", "loop"]), errors, source, animationPath);
    if (expectArray(animation.frames, errors, source, jsonPath(animationPath, "frames"), { nonEmpty: true })) {
      animation.frames.forEach((frame, index) => {
        if (!Number.isInteger(frame) || frame < 0 || frame >= columns) {
          pushError(errors, source, jsonPath(jsonPath(animationPath, "frames"), index), `must be an integer column index from 0 to ${Math.max(columns - 1, 0)}`);
        }
      });
    }
    if (!isPositiveInteger(animation.frameDurationMs)) {
      pushError(errors, source, jsonPath(animationPath, "frameDurationMs"), "must be a positive integer");
    }
    if (animation.loop !== undefined) validateBoolean(animation.loop, errors, source, jsonPath(animationPath, "loop"));
  }
};

const validateCharacterDefinition = (value, errors, source, path, options, { editor = false } = {}) => {
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set([
    "id", "label", "name", "runtimeId", "role", "animationPreset", "file", "imageUrl", "sheetUrl",
    "portraitFile", "portraitUrl", "footprintTiles", "orientation", "render", "portrait",
    "spriteSheet", "license", "extensions",
  ]), errors, source, path);
  validateId(value.id, errors, source, jsonPath(path, "id"));
  const label = value.label ?? (editor ? value.name : undefined);
  if (!expectString(label, errors, source, jsonPath(path, "label"))) return;
  expectString(value.role, errors, source, jsonPath(path, "role"));
  if (editor) {
    expectString(value.animationPreset, errors, source, jsonPath(path, "animationPreset"));
    if (value.runtimeId !== undefined && !["haru", "aoi", "navigator"].includes(value.runtimeId)) {
      pushError(errors, source, jsonPath(path, "runtimeId"), "must be haru, aoi or navigator");
    }
  }
  validateFootprint(value.footprintTiles, errors, source, jsonPath(path, "footprintTiles"), { character: true });
  validateOrientation(value.orientation, errors, source, jsonPath(path, "orientation"));
  const frameCanvas = validateRender(value.render, errors, source, jsonPath(path, "render"), {
    required: true,
    contentBoundsRequired: !editor,
    booleansRequired: editor,
    fitScaleRequired: editor,
  });

  if (!editor || value.portrait !== undefined) {
    const portraitPath = jsonPath(path, "portrait");
    if (expectRecord(value.portrait, errors, source, portraitPath)) {
      rejectUnknown(value.portrait, new Set(["file", "canvas"]), errors, source, portraitPath);
      validateCanvas(value.portrait.canvas, errors, source, jsonPath(portraitPath, "canvas"));
      validateFile(value.portrait.file, errors, source, jsonPath(portraitPath, "file"), options, value.portrait.canvas);
    }
  } else {
    validateFile(value.portraitFile, errors, source, jsonPath(path, "portraitFile"), options, undefined);
    validateImageSource(value.portraitUrl, errors, source, jsonPath(path, "portraitUrl"));
  }

  if (!editor || value.spriteSheet !== undefined) {
    const sheetPath = jsonPath(path, "spriteSheet");
    if (expectRecord(value.spriteSheet, errors, source, sheetPath)) {
      rejectUnknown(value.spriteSheet, new Set([
        "file", "canvas", "frameSize", "columns", "rows", "directionRows", "animations",
      ]), errors, source, sheetPath);
      validateCanvas(value.spriteSheet.canvas, errors, source, jsonPath(sheetPath, "canvas"));
      validateCanvas(value.spriteSheet.frameSize, errors, source, jsonPath(sheetPath, "frameSize"));
      const columns = value.spriteSheet.columns;
      const rows = value.spriteSheet.rows;
      if (!isPositiveInteger(columns)) pushError(errors, source, jsonPath(sheetPath, "columns"), "must be a positive integer");
      if (!isPositiveInteger(rows)) pushError(errors, source, jsonPath(sheetPath, "rows"), "must be a positive integer");
      if (isRecord(value.spriteSheet.canvas) && isRecord(value.spriteSheet.frameSize)
        && isPositiveInteger(columns) && isPositiveInteger(rows)
        && (value.spriteSheet.frameSize.width * columns !== value.spriteSheet.canvas.width
          || value.spriteSheet.frameSize.height * rows !== value.spriteSheet.canvas.height)) {
        pushError(errors, source, sheetPath, "canvas must equal frameSize multiplied by columns and rows");
      }
      validateDirectionRows(value.spriteSheet.directionRows, errors, source, jsonPath(sheetPath, "directionRows"), rows);
      validateAnimations(value.spriteSheet.animations, errors, source, jsonPath(sheetPath, "animations"), columns);
      validateFile(value.spriteSheet.file, errors, source, jsonPath(sheetPath, "file"), options, value.spriteSheet.canvas);
      if (isRecord(frameCanvas) && isRecord(value.spriteSheet.frameSize)
        && (frameCanvas.width !== value.spriteSheet.frameSize.width || frameCanvas.height !== value.spriteSheet.frameSize.height)) {
        pushError(errors, source, jsonPath(path, "render.canvas"), "must match spriteSheet.frameSize");
      }
    }
  } else {
    validateFile(value.file, errors, source, jsonPath(path, "file"), options, undefined);
    validateImageSource(value.imageUrl ?? value.sheetUrl, errors, source, jsonPath(path, "imageUrl"));
  }
  if (value.license !== undefined) validateLicense(value.license, errors, source, jsonPath(path, "license"));
  validateExtensions(value.extensions, errors, source, jsonPath(path, "extensions"));
};

const validatePackHeader = (document, errors, source, format) => {
  if (document.format !== format) pushError(errors, source, "$.format", `must be '${format}'`);
  if (document.formatVersion !== FORMAT_VERSION) pushError(errors, source, "$.formatVersion", `must be ${FORMAT_VERSION}`);
  validateId(document.id, errors, source, "$.id");
  expectString(document.name, errors, source, "$.name");
  if (!expectString(document.packVersion, errors, source, "$.packVersion")) return;
  if (!SEMVER_PATTERN.test(document.packVersion)) pushError(errors, source, "$.packVersion", "must be a semantic version such as 1.0.0");
};

const validateUniqueIds = (items, errors, source, path) => {
  if (!Array.isArray(items)) return;
  const seen = new Set();
  items.forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string") return;
    if (seen.has(item.id)) pushError(errors, source, jsonPath(jsonPath(path, index), "id"), `duplicates id '${item.id}'`);
    seen.add(item.id);
  });
};

const validateAssetPack = (document, errors, source, options) => {
  rejectUnknown(document, new Set([
    "$schema", "format", "formatVersion", "id", "name", "packVersion", "license", "assets", "extensions",
  ]), errors, source, "$");
  validatePackHeader(document, errors, source, "roommates.asset-pack");
  validateLicense(document.license, errors, source, "$.license");
  if (expectArray(document.assets, errors, source, "$.assets", { nonEmpty: true })) {
    document.assets.forEach((asset, index) => validateAssetDefinition(asset, errors, source, `$.assets[${index}]`, options));
    validateUniqueIds(document.assets, errors, source, "$.assets");
  }
  validateExtensions(document.extensions, errors, source, "$.extensions");
};

const validateCharacterPack = (document, errors, source, options) => {
  rejectUnknown(document, new Set([
    "$schema", "format", "formatVersion", "id", "name", "packVersion", "license", "characters", "extensions",
  ]), errors, source, "$");
  validatePackHeader(document, errors, source, "roommates.character-pack");
  validateLicense(document.license, errors, source, "$.license");
  if (expectArray(document.characters, errors, source, "$.characters", { nonEmpty: true })) {
    document.characters.forEach((character, index) => validateCharacterDefinition(
      character,
      errors,
      source,
      `$.characters[${index}]`,
      options,
    ));
    validateUniqueIds(document.characters, errors, source, "$.characters");
  }
  validateExtensions(document.extensions, errors, source, "$.extensions");
};

const validateGrid = (value, errors, source, path) => {
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set(["type", "columns", "rows", "tileSize"]), errors, source, path);
  if (value.type !== "square") pushError(errors, source, jsonPath(path, "type"), "must be 'square'");
  for (const key of ["columns", "rows"]) {
    if (!isPositiveInteger(value[key])) pushError(errors, source, jsonPath(path, key), "must be a positive integer");
  }
  if (value.tileSize !== 1) pushError(errors, source, jsonPath(path, "tileSize"), "must be 1 in Asset Format v1");
};

const validateProjection = (value, errors, source, path) => {
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set(["type", "tileWidthPx", "tileHeightPx", "origin", "cameraDirection"]), errors, source, path);
  if (value.type !== "isometric-cutaway") pushError(errors, source, jsonPath(path, "type"), "must be 'isometric-cutaway'");
  for (const key of ["tileWidthPx", "tileHeightPx"]) {
    if (!isPositiveNumber(value[key])) pushError(errors, source, jsonPath(path, key), "must be a positive number");
  }
  validatePoint(value.origin, errors, source, jsonPath(path, "origin"));
  if (value.cameraDirection !== "south-west-to-north-east") {
    pushError(errors, source, jsonPath(path, "cameraDirection"), "must be 'south-west-to-north-east' in v1");
  }
};

const collectRoomIds = (rooms, result = new Set()) => {
  if (!Array.isArray(rooms)) return result;
  for (const room of rooms) {
    if (!isRecord(room)) continue;
    if (typeof room.id === "string") result.add(room.id);
    collectRoomIds(room.zones, result);
  }
  return result;
};

const collectRoomIdEntries = (rooms, path = "$.rooms", result = []) => {
  if (!Array.isArray(rooms)) return result;
  rooms.forEach((room, index) => {
    if (!isRecord(room)) return;
    const roomPath = `${path}[${index}]`;
    if (typeof room.id === "string") result.push({ id: room.id, path: `${roomPath}.id` });
    collectRoomIdEntries(room.zones, `${roomPath}.zones`, result);
  });
  return result;
};

const validateRoom = (value, errors, source, path, grid) => {
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set(["id", "name", "bounds", "zones", "blocked", "extensions"]), errors, source, path);
  validateId(value.id, errors, source, jsonPath(path, "id"));
  expectString(value.name, errors, source, jsonPath(path, "name"));
  const bounds = Array.isArray(value.bounds) ? value.bounds : [value.bounds];
  if (bounds.length === 0) pushError(errors, source, jsonPath(path, "bounds"), "must contain at least one rectangle");
  bounds.forEach((rect, index) => {
    const rectPath = Array.isArray(value.bounds) ? `${path}.bounds[${index}]` : `${path}.bounds`;
    validateRect(rect, errors, source, rectPath, { integer: true });
    if (isRecord(rect) && isRecord(grid)
      && (rect.x + rect.width > grid.columns || rect.y + rect.height > grid.rows)) {
      pushError(errors, source, rectPath, "must fit inside the declared grid");
    }
  });
  if (value.blocked !== undefined && expectArray(value.blocked, errors, source, jsonPath(path, "blocked"))) {
    value.blocked.forEach((rect, index) => validateRect(rect, errors, source, `${path}.blocked[${index}]`, { integer: true }));
  }
  if (value.zones !== undefined && expectArray(value.zones, errors, source, jsonPath(path, "zones"))) {
    value.zones.forEach((zone, index) => validateRoom(zone, errors, source, `${path}.zones[${index}]`, grid));
  }
  validateExtensions(value.extensions, errors, source, jsonPath(path, "extensions"));
};

const validateDependencies = (value, errors, source, path) => {
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set(["assetPacks", "characterPacks"]), errors, source, path);
  for (const key of ["assetPacks", "characterPacks"]) {
    if (!expectArray(value[key], errors, source, jsonPath(path, key))) continue;
    value[key].forEach((dependency, index) => {
      const dependencyPath = jsonPath(jsonPath(path, key), index);
      if (!expectRecord(dependency, errors, source, dependencyPath)) return;
      rejectUnknown(dependency, new Set(["id", "version"]), errors, source, dependencyPath);
      validateId(dependency.id, errors, source, jsonPath(dependencyPath, "id"));
      expectString(dependency.version, errors, source, jsonPath(dependencyPath, "version"));
    });
  }
};

const validatePlacement = (value, errors, source, path, roomIds, { character = false } = {}) => {
  if (!expectRecord(value, errors, source, path)) return;
  rejectUnknown(value, new Set([
    "instanceId", "assetId", "roomId", "floorContact", "orientation", "facing", "flipX", "flipY", "displayScale",
  ]), errors, source, path);
  validateId(value.instanceId, errors, source, jsonPath(path, "instanceId"));
  validateId(value.assetId, errors, source, jsonPath(path, "assetId"));
  validateId(value.roomId, errors, source, jsonPath(path, "roomId"));
  if (typeof value.roomId === "string" && roomIds.size > 0 && !roomIds.has(value.roomId)) {
    pushError(errors, source, jsonPath(path, "roomId"), `references unknown room '${value.roomId}'`);
  }
  validatePoint(value.floorContact, errors, source, jsonPath(path, "floorContact"), { nonNegative: true });
  if (value.orientation !== undefined) validateOrientation(value.orientation, errors, source, jsonPath(path, "orientation"));
  if (value.facing !== undefined) {
    if (!character) pushError(errors, source, jsonPath(path, "facing"), "is only valid for character placements");
    else if (!CARDINAL_DIRECTIONS.includes(value.facing)) pushError(errors, source, jsonPath(path, "facing"), "must be north, east, south or west");
  }
  if (value.flipX !== undefined) validateBoolean(value.flipX, errors, source, jsonPath(path, "flipX"));
  if (value.flipY !== undefined) validateBoolean(value.flipY, errors, source, jsonPath(path, "flipY"));
  if (value.displayScale !== undefined && !isPositiveNumber(value.displayScale)) {
    pushError(errors, source, jsonPath(path, "displayScale"), "must be a positive number");
  }
};

const validatePlacements = (value, errors, source, path, roomIds, { editor = false } = {}) => {
  if (!expectRecord(value, errors, source, path)) return;
  const assetKey = editor ? "furniture" : "assets";
  rejectUnknown(value, new Set([assetKey, "characters"]), errors, source, path);
  for (const [key, character] of [[assetKey, false], ["characters", true]]) {
    if (!expectArray(value[key], errors, source, jsonPath(path, key))) continue;
    value[key].forEach((placement, index) => validatePlacement(
      placement,
      errors,
      source,
      `${path}.${key}[${index}]`,
      roomIds,
      { character },
    ));
    const asIds = value[key].map((placement) => isRecord(placement) ? { id: placement.instanceId } : placement);
    validateUniqueIds(asIds, errors, source, jsonPath(path, key));
  }
};

const validateRoomPack = (document, errors, source) => {
  rejectUnknown(document, new Set([
    "$schema", "format", "formatVersion", "id", "name", "packVersion", "license",
    "grid", "projection", "dependencies", "rooms", "placements", "extensions",
  ]), errors, source, "$");
  validatePackHeader(document, errors, source, "roommates.room-pack");
  validateLicense(document.license, errors, source, "$.license");
  validateGrid(document.grid, errors, source, "$.grid");
  validateProjection(document.projection, errors, source, "$.projection");
  validateDependencies(document.dependencies, errors, source, "$.dependencies");
  if (expectArray(document.rooms, errors, source, "$.rooms", { nonEmpty: true })) {
    document.rooms.forEach((room, index) => validateRoom(room, errors, source, `$.rooms[${index}]`, document.grid));
    const seen = new Set();
    for (const entry of collectRoomIdEntries(document.rooms)) {
      if (seen.has(entry.id)) pushError(errors, source, entry.path, `duplicates room or zone id '${entry.id}'`);
      seen.add(entry.id);
    }
  }
  validatePlacements(document.placements, errors, source, "$.placements", collectRoomIds(document.rooms));
  validateExtensions(document.extensions, errors, source, "$.extensions");
};

const validateProject = (document, errors, source, options) => {
  rejectUnknown(document, new Set([
    "$schema", "format", "formatVersion", "id", "name", "packVersion", "license",
    "grid", "projection", "rooms", "assets", "placements", "extensions",
  ]), errors, source, "$");
  if (document.formatVersion !== FORMAT_VERSION) pushError(errors, source, "$.formatVersion", `must be ${FORMAT_VERSION}`);
  validateId(document.id, errors, source, "$.id");
  expectString(document.name, errors, source, "$.name");
  if (document.packVersion !== undefined) {
    expectString(document.packVersion, errors, source, "$.packVersion");
    if (typeof document.packVersion === "string" && !SEMVER_PATTERN.test(document.packVersion)) {
      pushError(errors, source, "$.packVersion", "must be a semantic version such as 1.0.0");
    }
  }
  validateLicense(document.license, errors, source, "$.license", { required: false });
  if (document.grid !== undefined) validateGrid(document.grid, errors, source, "$.grid");
  if (document.projection !== undefined) validateProjection(document.projection, errors, source, "$.projection");
  if (document.rooms !== undefined && expectArray(document.rooms, errors, source, "$.rooms")) {
    document.rooms.forEach((room, index) => validateRoom(room, errors, source, `$.rooms[${index}]`, document.grid));
  }
  if (expectRecord(document.assets, errors, source, "$.assets")) {
    rejectUnknown(document.assets, new Set(["furniture", "characters"]), errors, source, "$.assets");
    if (expectArray(document.assets.furniture, errors, source, "$.assets.furniture")) {
      document.assets.furniture.forEach((asset, index) => validateAssetDefinition(
        asset,
        errors,
        source,
        `$.assets.furniture[${index}]`,
        options,
        { editor: true },
      ));
      validateUniqueIds(document.assets.furniture, errors, source, "$.assets.furniture");
    }
    if (expectArray(document.assets.characters, errors, source, "$.assets.characters")) {
      document.assets.characters.forEach((character, index) => validateCharacterDefinition(
        character,
        errors,
        source,
        `$.assets.characters[${index}]`,
        options,
        { editor: true },
      ));
      validateUniqueIds(document.assets.characters, errors, source, "$.assets.characters");
    }
  }
  validatePlacements(document.placements, errors, source, "$.placements", collectRoomIds(document.rooms), { editor: true });
  if (isRecord(document.assets) && isRecord(document.placements)) {
    for (const key of ["furniture", "characters"]) {
      const ids = new Set(Array.isArray(document.assets[key])
        ? document.assets[key].map((asset) => isRecord(asset) ? asset.id : undefined)
        : []);
      if (!Array.isArray(document.placements[key])) continue;
      document.placements[key].forEach((placement, index) => {
        if (isRecord(placement) && typeof placement.assetId === "string" && !ids.has(placement.assetId)) {
          pushError(errors, source, `$.placements.${key}[${index}].assetId`, `references unknown ${key} asset '${placement.assetId}'`);
        }
      });
    }
  }
  validateExtensions(document.extensions, errors, source, "$.extensions");
};

const validateLegacyFurniture = (document, errors, source, options) => {
  if (!Number.isInteger(document.version) || document.version < 1) pushError(errors, source, "$.version", "must be a positive integer");
  const isRuntimeV5 = Number.isInteger(document.version) && document.version >= 5;
  if (isRuntimeV5 && document.format !== "roommates-grid-assets") {
    pushError(errors, source, "$.format", "must be 'roommates-grid-assets' for runtime manifest v5+");
  }
  if (isRuntimeV5) {
    if (!expectRecord(document.grid, errors, source, "$.grid")) return;
    for (const key of ["columns", "rows"]) {
      if (!isPositiveInteger(document.grid[key])) pushError(errors, source, `$.grid.${key}`, "must be a positive integer");
    }
    for (const key of ["tileWidth", "tileHeight"]) {
      if (!isPositiveNumber(document.grid[key])) pushError(errors, source, `$.grid.${key}`, "must be a positive number");
    }
    validateFootprint(document.grid.characterFootprint, errors, source, "$.grid.characterFootprint", { character: true });
  }
  if (document.canvas !== undefined) validateCanvas(document.canvas, errors, source, "$.canvas");
  if (document.pivot !== undefined) validatePoint(document.pivot, errors, source, "$.pivot", { nonNegative: true });
  if (expectArray(document.assets, errors, source, "$.assets", { nonEmpty: true })) {
    document.assets.forEach((asset, index) => {
      const path = `$.assets[${index}]`;
      if (!expectRecord(asset, errors, source, path)) return;
      validateId(asset.id, errors, source, `${path}.id`);
      validateFootprint(asset.footprintTiles, errors, source, `${path}.footprintTiles`);
      validateOrientation(asset.orientation, errors, source, `${path}.orientation`);
      const legacyRender = asset.render ?? {
        canvas: document.canvas,
        pivot: asset.pivot ?? document.pivot,
        flipX: asset.flipX,
        flipY: asset.flipY,
      };
      const canvas = validateRender(legacyRender, errors, source, `${path}.render`, {
        required: isRuntimeV5,
        contentBoundsRequired: isRuntimeV5,
        fitScaleRequired: isRuntimeV5,
        inheritedCanvas: document.canvas,
      });
      validateFile(asset.file, errors, source, `${path}.file`, options, canvas);
      if (asset.flipX !== undefined) validateBoolean(asset.flipX, errors, source, `${path}.flipX`);
      if (asset.flipY !== undefined) validateBoolean(asset.flipY, errors, source, `${path}.flipY`);
    });
    validateUniqueIds(document.assets, errors, source, "$.assets");
  }
  const assetIds = new Set(Array.isArray(document.assets) ? document.assets.map((asset) => asset?.id) : []);
  const instances = document.defaultScene?.instances;
  if (expectArray(instances, errors, source, "$.defaultScene.instances")) {
    const seen = new Set();
    instances.forEach((instance, index) => {
      const path = `$.defaultScene.instances[${index}]`;
      if (!expectRecord(instance, errors, source, path)) return;
      validateId(instance.instanceId, errors, source, `${path}.instanceId`);
      validateId(instance.assetId, errors, source, `${path}.assetId`);
      if (!assetIds.has(instance.assetId)) pushError(errors, source, `${path}.assetId`, `references unknown asset '${instance.assetId}'`);
      if (seen.has(instance.instanceId)) pushError(errors, source, `${path}.instanceId`, `duplicates instance '${instance.instanceId}'`);
      seen.add(instance.instanceId);
      if (instance.roomId !== undefined) validateId(instance.roomId, errors, source, `${path}.roomId`);
      validatePoint(instance.floorContact, errors, source, `${path}.floorContact`, { nonNegative: true });
      if (instance.displayScale !== undefined && !isPositiveNumber(instance.displayScale)) {
        pushError(errors, source, `${path}.displayScale`, "must be a positive number");
      }
    });
  }
};

const validateLegacyCharacters = (document, errors, source, options) => {
  if (!Number.isInteger(document.version) || document.version < 1) pushError(errors, source, "$.version", "must be a positive integer");
  validateCanvas(document.frameSize, errors, source, "$.frameSize");
  validateCanvas(document.displaySize, errors, source, "$.displaySize");
  validatePoint(document.pivot, errors, source, "$.pivot", { nonNegative: true });
  validateFootprint(
    { width: document.logicalTileFootprint?.width, depth: document.logicalTileFootprint?.height },
    errors,
    source,
    "$.logicalTileFootprint",
    { character: true },
  );
  if (!expectRecord(document.sheet, errors, source, "$.sheet")) return;
  const sheetCanvas = { width: document.sheet.width, height: document.sheet.height };
  validateCanvas(sheetCanvas, errors, source, "$.sheet");
  if (!isPositiveInteger(document.sheet.columns)) pushError(errors, source, "$.sheet.columns", "must be a positive integer");
  if (!isPositiveInteger(document.sheet.rows)) pushError(errors, source, "$.sheet.rows", "must be a positive integer");
  if (isRecord(document.frameSize)
    && document.frameSize.width * document.sheet.columns !== document.sheet.width) {
    pushError(errors, source, "$.sheet.width", "must equal frameSize.width multiplied by sheet.columns");
  }
  if (isRecord(document.frameSize)
    && document.frameSize.height * document.sheet.rows !== document.sheet.height) {
    pushError(errors, source, "$.sheet.height", "must equal frameSize.height multiplied by sheet.rows");
  }
  if (!Array.isArray(document.directionOrder) || CARDINAL_DIRECTIONS.some((direction) => !document.directionOrder.includes(direction))) {
    pushError(errors, source, "$.directionOrder", "must contain south, east, north and west");
  }
  if (expectArray(document.characters, errors, source, "$.characters", { nonEmpty: true })) {
    document.characters.forEach((character, index) => {
      const path = `$.characters[${index}]`;
      if (!expectRecord(character, errors, source, path)) return;
      validateId(character.id, errors, source, `${path}.id`);
      expectString(character.name, errors, source, `${path}.name`);
      expectString(character.role, errors, source, `${path}.role`);
      expectString(character.animationPreset, errors, source, `${path}.animationPreset`);
      if (!isRecord(document.animationPresets?.[character.animationPreset])) {
        pushError(errors, source, `${path}.animationPreset`, `references unknown preset '${character.animationPreset}'`);
      }
      validateFile(character.sheet, errors, source, `${path}.sheet`, options, sheetCanvas);
      validateFile(character.portrait, errors, source, `${path}.portrait`, options, { width: 256, height: 256 });
    });
    validateUniqueIds(document.characters, errors, source, "$.characters");
  }
};

const validateLegacyRoomLayout = (document, errors, source) => {
  if (!Number.isInteger(document.schemaVersion) || document.schemaVersion < 1) pushError(errors, source, "$.schemaVersion", "must be a positive integer");
  validateId(document.layoutId, errors, source, "$.layoutId");
  if (!expectRecord(document.grid, errors, source, "$.grid")) return;
  if (!isPositiveInteger(document.grid.width)) pushError(errors, source, "$.grid.width", "must be a positive integer");
  if (!isPositiveInteger(document.grid.interiorHeight)) pushError(errors, source, "$.grid.interiorHeight", "must be a positive integer");
  if (!isNonNegativeNumber(document.grid.balconyHeight)) pushError(errors, source, "$.grid.balconyHeight", "must be a finite number >= 0");
  const rows = (document.grid.interiorHeight ?? 0) + (document.grid.balconyHeight ?? 0);
  if (expectArray(document.rooms, errors, source, "$.rooms", { nonEmpty: true })) {
    const grid = { columns: document.grid.width, rows };
    document.rooms.forEach((room, index) => {
      if (!isRecord(room)) return;
      validateId(room.id, errors, source, `$.rooms[${index}].id`);
      const bounds = Array.isArray(room.bounds) ? room.bounds : [room.bounds];
      bounds.forEach((rect, rectIndex) => {
        const path = Array.isArray(room.bounds) ? `$.rooms[${index}].bounds[${rectIndex}]` : `$.rooms[${index}].bounds`;
        validateRect(rect, errors, source, path);
        if (isRecord(rect) && rect.x + rect.width > grid.columns) pushError(errors, source, path, "extends beyond grid width");
        if (isRecord(rect) && rect.y + rect.height > grid.rows) pushError(errors, source, path, "extends beyond grid height");
      });
    });
  }
};

export const detectManifestKind = (document) => {
  if (!isRecord(document)) return "unknown";
  if (PORTABLE_FORMATS.has(document.format)) return document.format;
  if (Array.isArray(document.assets) && isRecord(document.defaultScene)) return "legacy-furniture";
  if (Array.isArray(document.characters) && isRecord(document.frameSize)) return "legacy-characters";
  if (document.schemaVersion !== undefined && Array.isArray(document.rooms) && isRecord(document.grid)) return "legacy-room-layout";
  return "unknown";
};

export const validateManifestDocument = (document, {
  source = "<memory>",
  baseDir = repositoryRoot,
  checkFiles = false,
} = {}) => {
  const errors = [];
  const options = { baseDir, checkFiles };
  const kind = detectManifestKind(document);
  if (!expectRecord(document, errors, source, "$")) return { valid: false, kind, errors };
  switch (kind) {
    case "roommates.asset-pack": validateAssetPack(document, errors, source, options); break;
    case "roommates.character-pack": validateCharacterPack(document, errors, source, options); break;
    case "roommates.room-pack": validateRoomPack(document, errors, source); break;
    case "roommates.project": validateProject(document, errors, source, options); break;
    case "legacy-furniture": validateLegacyFurniture(document, errors, source, options); break;
    case "legacy-characters": validateLegacyCharacters(document, errors, source, options); break;
    case "legacy-room-layout": validateLegacyRoomLayout(document, errors, source); break;
    default:
      pushError(errors, source, "$.format", `must be one of ${[...PORTABLE_FORMATS].join(", ")} or a supported repository manifest`);
  }
  return { valid: errors.length === 0, kind, errors };
};

const roomBoundsById = (rooms, result = new Map()) => {
  if (!Array.isArray(rooms)) return result;
  for (const room of rooms) {
    if (!isRecord(room)) continue;
    const bounds = Array.isArray(room.bounds) ? room.bounds : [room.bounds];
    if (typeof room.id === "string") result.set(room.id, bounds.filter(isRecord));
    roomBoundsById(room.zones, result);
  }
  return result;
};

const containsFootprint = (bounds, footprint, floorContact) => {
  if (!Array.isArray(bounds) || !isRecord(footprint) || !isRecord(floorContact)) return false;
  const left = floorContact.x - footprint.width;
  const top = floorContact.y - footprint.depth;
  const right = floorContact.x;
  const bottom = floorContact.y;
  return bounds.some((rect) => left >= rect.x && top >= rect.y && right <= rect.x + rect.width && bottom <= rect.y + rect.height);
};

const footprintRect = (footprint, floorContact) => ({
  x: floorContact.x - footprint.width,
  y: floorContact.y - footprint.depth,
  width: footprint.width,
  height: footprint.depth,
});

const rectsOverlap = (left, right) => left.x < right.x + right.width
  && left.x + left.width > right.x
  && left.y < right.y + right.height
  && left.y + left.height > right.y;

const validateResolvedPlacements = ({
  placements,
  definitions,
  bounds,
  errors,
  source,
  path,
}) => {
  const resolved = [];
  if (!Array.isArray(placements)) return resolved;
  placements.forEach((placement, index) => {
    if (!isRecord(placement)) return;
    const definition = definitions.get(placement.assetId);
    if (!definition) {
      pushError(errors, source, `${path}[${index}].assetId`, `references unknown asset '${placement.assetId}'`);
      return;
    }
    const footprint = definition.footprintTiles;
    if (bounds.has(placement.roomId) && !containsFootprint(bounds.get(placement.roomId), footprint, placement.floorContact)) {
      pushError(errors, source, `${path}[${index}].floorContact`, `places ${placement.assetId} outside room '${placement.roomId}'`);
    }
    if (isRecord(footprint) && isRecord(placement.floorContact)) {
      resolved.push({ placement, index, rect: footprintRect(footprint, placement.floorContact) });
    }
  });
  return resolved;
};

const validatePlacementCollisions = (resolved, errors, source, path) => {
  for (let index = 0; index < resolved.length; index += 1) {
    const left = resolved[index];
    for (let candidateIndex = index + 1; candidateIndex < resolved.length; candidateIndex += 1) {
      const right = resolved[candidateIndex];
      if (left.placement.roomId === right.placement.roomId && rectsOverlap(left.rect, right.rect)) {
        pushError(
          errors,
          source,
          `${path}[${right.index}].floorContact`,
          `overlaps instance '${left.placement.instanceId}' in room '${right.placement.roomId}'`,
        );
      }
    }
  }
};

export const validateManifestSet = (entries) => {
  const errors = [];
  const results = entries.map(({ document, ...options }) => validateManifestDocument(document, options));
  for (const result of results) errors.push(...result.errors);

  const portableAssets = new Map();
  const portableCharacters = new Map();
  const packs = new Map();
  entries.forEach(({ document, source = "<memory>" }) => {
    if (!isRecord(document) || typeof document.format !== "string") return;
    if (typeof document.id === "string") {
      if (packs.has(document.id)) pushError(errors, source, "$.id", `duplicates loaded pack id '${document.id}'`);
      else packs.set(document.id, { document, source });
    }
    if (document.format === "roommates.asset-pack" && Array.isArray(document.assets)) {
      document.assets.forEach((asset, index) => {
        if (isRecord(asset) && typeof asset.id === "string") {
          if (portableAssets.has(asset.id)) pushError(errors, source, `$.assets[${index}].id`, `duplicates loaded asset id '${asset.id}'`);
          else portableAssets.set(asset.id, asset);
        }
      });
    }
    if (document.format === "roommates.character-pack" && Array.isArray(document.characters)) {
      document.characters.forEach((character, index) => {
        if (isRecord(character) && typeof character.id === "string") {
          if (portableCharacters.has(character.id)) pushError(errors, source, `$.characters[${index}].id`, `duplicates loaded character id '${character.id}'`);
          else portableCharacters.set(character.id, character);
        }
      });
    }
  });

  entries.forEach(({ document, source = "<memory>" }) => {
    if (!isRecord(document) || document.format !== "roommates.room-pack") return;
    for (const [key, expectedFormat] of [["assetPacks", "roommates.asset-pack"], ["characterPacks", "roommates.character-pack"]]) {
      for (const dependency of document.dependencies?.[key] ?? []) {
        const found = packs.get(dependency?.id);
        if (found && found.document.format !== expectedFormat) {
          pushError(errors, source, `$.dependencies.${key}`, `'${dependency.id}' is ${found.document.format}, expected ${expectedFormat}`);
        }
      }
    }
    const bounds = roomBoundsById(document.rooms);
    const resolvedAssets = validateResolvedPlacements({
      placements: document.placements?.assets,
      definitions: portableAssets,
      bounds,
      errors,
      source,
      path: "$.placements.assets",
    });
    const resolvedCharacters = validateResolvedPlacements({
      placements: document.placements?.characters,
      definitions: portableCharacters,
      bounds,
      errors,
      source,
      path: "$.placements.characters",
    });
    validatePlacementCollisions(resolvedAssets, errors, source, "$.placements.assets");
    validatePlacementCollisions(resolvedCharacters, errors, source, "$.placements.characters");
    for (const character of resolvedCharacters) {
      for (const asset of resolvedAssets) {
        if (character.placement.roomId === asset.placement.roomId && rectsOverlap(character.rect, asset.rect)) {
          pushError(
            errors,
            source,
            `$.placements.characters[${character.index}].floorContact`,
            `overlaps asset instance '${asset.placement.instanceId}' in room '${character.placement.roomId}'`,
          );
        }
      }
    }
  });

  const legacyFurnitureEntry = entries.find(({ document }) => detectManifestKind(document) === "legacy-furniture");
  const legacyRoomEntry = entries.find(({ document }) => detectManifestKind(document) === "legacy-room-layout");
  if (legacyFurnitureEntry && legacyRoomEntry) {
    const source = legacyFurnitureEntry.source ?? "<memory>";
    const bounds = roomBoundsById(legacyRoomEntry.document.rooms);
    const definitions = new Map(legacyFurnitureEntry.document.assets.map((asset) => [asset.id, asset]));
    const resolved = validateResolvedPlacements({
      placements: legacyFurnitureEntry.document.defaultScene?.instances,
      definitions,
      bounds,
      errors,
      source,
      path: "$.defaultScene.instances",
    });
    validatePlacementCollisions(resolved, errors, source, "$.defaultScene.instances");
  }
  return { valid: errors.length === 0, errors, results };
};

const parseJsonFile = (filePath) => {
  const source = relative(repositoryRoot, filePath) || filePath;
  try {
    return { document: JSON.parse(readFileSync(filePath, "utf8")), source };
  } catch (error) {
    return {
      source,
      parseError: {
        source,
        path: "$",
        message: error instanceof Error ? `invalid JSON: ${error.message}` : "invalid JSON",
      },
    };
  }
};

export const validateFiles = (paths, { checkFiles = true } = {}) => {
  const entries = [];
  const errors = [];
  for (const rawPath of paths) {
    const filePath = resolve(repositoryRoot, rawPath);
    if (!existsSync(filePath)) {
      errors.push({ source: rawPath, path: "$", message: "manifest file does not exist" });
      continue;
    }
    const parsed = parseJsonFile(filePath);
    if (parsed.parseError) {
      errors.push(parsed.parseError);
      continue;
    }
    entries.push({
      document: parsed.document,
      source: parsed.source,
      baseDir: dirname(filePath),
      checkFiles: checkFiles && !parsed.source.startsWith("docs/examples/"),
    });
  }
  const validated = validateManifestSet(entries);
  return { valid: errors.length === 0 && validated.valid, errors: [...errors, ...validated.errors], results: validated.results };
};

const formatError = (error) => `${error.source} ${error.path}: ${error.message}`;

const runCli = () => {
  const args = process.argv.slice(2);
  const schemaOnlyIndex = args.indexOf("--schema-only");
  const schemaOnly = schemaOnlyIndex >= 0;
  if (schemaOnly) args.splice(schemaOnlyIndex, 1);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node scripts/validate-assets.mjs [--schema-only] [manifest.json ...]");
    console.log("Without paths, validates the repository manifests and v1 examples.");
    return;
  }
  const paths = args.length > 0 ? args : defaultTargets;
  const result = validateFiles(paths, { checkFiles: !schemaOnly });
  if (!result.valid) {
    console.error(`Asset validation failed with ${result.errors.length} error(s):`);
    result.errors.forEach((error) => console.error(`- ${formatError(error)}`));
    process.exitCode = 1;
    return;
  }
  const kinds = result.results.map((entry) => entry.kind).join(", ");
  console.log(`Validated ${result.results.length} manifest(s): ${kinds}`);
};

const isEntrypoint = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) runCli();
