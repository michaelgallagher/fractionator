const fs = require("fs");
const path = require("path");
const { globSync } = require("glob");
const { rgbFloatToHex, argbToHex } = require("./token-scanner");

/**
 * Resolve named/aliased color tokens to concrete hex values so the report can
 * render real swatches. Each platform has its own sources of truth:
 *
 *   iOS     — asset catalogs (`*.colorset/Contents.json`) carry sRGB components
 *             for light and dark appearances; `extension Color` blocks alias
 *             readable names to those assets.
 *   Android — `val x = Color(0xAARRGGBB)` definitions (often grouped in light/
 *             dark palette `object`s) and `res/values/colors.xml`.
 *
 * Resolution is best-effort: anything we can't resolve is simply left without a
 * value and still appears in the catalogue by name.
 */

// --- iOS ---------------------------------------------------------------------

const IGNORE_DIRS = [
  "**/DerivedData/**",
  "**/.build/**",
  "**/build/**",
  "**/Pods/**",
];

/**
 * Build an iOS color resolver.
 *
 * @param {string} projectPath - iOS project root
 * @returns {{ resolve: (key: string, kind: string) => ({light?:string,dark?:string}|null) }}
 */
function buildIosColorResolver(projectPath) {
  const assets = readColorSets(projectPath); // Map<assetName, {light,dark}>
  const aliases = readColorAliases(projectPath); // Map<aliasName, assetName>

  // Case-insensitive index of asset names, for matching Xcode's auto-generated
  // symbols (e.g. `Color.nhsWhite` ↔ asset "NHSWhite").
  const assetByLower = new Map();
  for (const name of assets.keys()) assetByLower.set(name.toLowerCase(), name);

  function lookupAsset(name) {
    if (assets.has(name)) return assets.get(name);
    const ci = assetByLower.get(name.toLowerCase());
    return ci ? assets.get(ci) : null;
  }

  function resolve(key, kind) {
    if (kind === "asset") return lookupAsset(key);
    if (kind === "alias") {
      const target = aliases.get(key);
      if (target) {
        const fromAsset = lookupAsset(target.assetName || "");
        if (fromAsset) return fromAsset;
        if (target.hex) return { light: target.hex };
      }
      // Fall back to Xcode's name-mangling convention (alias ↔ asset).
      return lookupAsset(key);
    }
    return null; // semantic system colors are not resolved
  }

  return { resolve };
}

/** Read every `*.colorset` into a Map<name, {light?, dark?}>. */
function readColorSets(projectPath) {
  const map = new Map();
  const sets = globSync("**/*.colorset", {
    cwd: projectPath,
    absolute: true,
    ignore: IGNORE_DIRS,
  });

  for (const dir of sets) {
    const name = path.basename(dir).replace(/\.colorset$/, "");
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(dir, "Contents.json"), "utf-8"));
    } catch {
      continue;
    }
    const resolved = colorsetToHex(json);
    if (resolved) map.set(name, resolved);
  }
  return map;
}

/**
 * Pick the light and dark hex from a colorset's `Contents.json`. Ignores
 * high-contrast variants so the catalogue shows the default palette.
 */
function colorsetToHex(json) {
  const entries = Array.isArray(json.colors) ? json.colors : [];
  const out = {};

  for (const entry of entries) {
    if (!entry.color) continue;
    const appearances = entry.appearances || [];
    const isHighContrast = appearances.some(
      (a) => a.appearance === "contrast" && a.value === "high",
    );
    if (isHighContrast) continue;

    const isDark = appearances.some(
      (a) => a.appearance === "luminosity" && a.value === "dark",
    );
    const hex = componentsToHex(entry.color);
    if (!hex) continue;

    if (isDark) out.dark = hex;
    else out.light = hex;
  }

  if (!out.light && !out.dark) return null;
  return out;
}

/**
 * Convert a colorset `color` block to #RRGGBB. Components may be 0–1 floats,
 * 0–255 integers, or hex strings ("0xFF"). Handles sRGB and (approximately)
 * display-p3 by treating components as plain RGB.
 */
function componentsToHex(color) {
  const c = color.components;
  if (!c) return null;
  const r = parseComponent(c.red);
  const g = parseComponent(c.green);
  const b = parseComponent(c.blue);
  if (r === null || g === null || b === null) return null;
  return rgbFloatToHex(r, g, b);
}

/** Parse a single colorset component string into a 0–1 float. */
function parseComponent(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (/^0x/i.test(s)) return parseInt(s, 16) / 255;
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  // Float form is 0–1; integer form is 0–255.
  if (s.includes(".") || n <= 1) return n;
  return n / 255;
}

/**
 * Parse `extension Color { static let name = Color("Asset") }` declarations into
 * a Map<aliasName, {assetName?, hex?}>. Literal `Color(red:green:blue:)` aliases
 * resolve directly to hex.
 */
function readColorAliases(projectPath) {
  const map = new Map();
  const files = globSync("**/*.swift", {
    cwd: projectPath,
    absolute: true,
    ignore: [...IGNORE_DIRS, "**/*Tests/**"],
  });

  const assetAlias = /static\s+(?:let|var)\s+(\w+)\s*(?::\s*Color)?\s*=\s*Color\(\s*"([^"]+)"\s*\)/g;
  const rgbAlias =
    /static\s+(?:let|var)\s+(\w+)\s*(?::\s*Color)?\s*=\s*Color\(\s*red:\s*([\d.]+)\s*,\s*green:\s*([\d.]+)\s*,\s*blue:\s*([\d.]+)/g;

  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    let m;
    while ((m = assetAlias.exec(src)) !== null) {
      map.set(m[1], { assetName: m[2] });
    }
    while ((m = rgbAlias.exec(src)) !== null) {
      map.set(m[1], { hex: rgbFloatToHex(+m[2], +m[3], +m[4]) });
    }
  }
  return map;
}

// --- Android -----------------------------------------------------------------

/**
 * Build an Android color resolver from `val x = Color(0x…)` definitions and
 * `colors.xml`. Definitions inside an `object Foo { … }` are indexed both as
 * `Foo.x` and as bare `x` (last definition wins for the bare form).
 *
 * @param {string} projectPath - Android project root
 */
function buildAndroidColorResolver(projectPath) {
  const named = new Map(); // "Object.prop" and bare "prop" → hex

  const files = globSync("**/*.kt", {
    cwd: projectPath,
    absolute: true,
    ignore: IGNORE_DIRS,
  });

  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    indexKotlinColorDefs(src, named);
  }

  readColorsXml(projectPath, named);

  function resolve(key, kind, hit) {
    // Object-qualified brand reference (NHSLightColors.blue).
    if (hit && hit.object && hit.prop) {
      const hex =
        named.get(`${hit.object}.${hit.prop}`) || named.get(hit.prop);
      return hex ? { light: hex } : null;
    }
    // Bare Compose constants (Color.White).
    const constant = COMPOSE_CONSTANTS[key];
    if (constant) return { light: constant };
    const byName = named.get(key);
    return byName ? { light: byName } : null;
  }

  return { resolve };
}

/** Index `val NAME = Color(0x…)` defs, scoped to their enclosing `object`. */
function indexKotlinColorDefs(src, named) {
  const lines = src.split("\n");
  const objectStack = [];
  let depth = 0;

  for (const line of lines) {
    const objMatch = line.match(/\bobject\s+(\w+)/);
    if (objMatch) objectStack.push({ name: objMatch[1], depth });

    const valMatch = line.match(/\bval\s+(\w+)\s*=\s*Color\(\s*0x([0-9A-Fa-f]+)\s*\)/);
    if (valMatch) {
      const hex = argbToHex(valMatch[2]);
      const prop = valMatch[1];
      named.set(prop, hex); // bare (last wins)
      const obj = objectStack[objectStack.length - 1];
      if (obj) named.set(`${obj.name}.${prop}`, hex);
    }

    // Track brace depth to pop objects as their blocks close.
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        while (objectStack.length && objectStack[objectStack.length - 1].depth >= depth)
          objectStack.pop();
      }
    }
  }
}

/** Read `<color name="x">#AARRGGBB</color>` entries from res/values/colors.xml. */
function readColorsXml(projectPath, named) {
  const files = globSync("**/res/values*/colors.xml", {
    cwd: projectPath,
    absolute: true,
    ignore: IGNORE_DIRS,
  });
  const entry = /<color\s+name="([^"]+)"\s*>\s*#([0-9A-Fa-f]+)\s*<\/color>/g;
  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    let m;
    while ((m = entry.exec(src)) !== null) {
      named.set(m[1], argbToHex(m[2]));
    }
  }
}

// Common Jetpack Compose `Color.*` constants.
const COMPOSE_CONSTANTS = {
  White: "#FFFFFF",
  Black: "#000000",
  Red: "#FF0000",
  Green: "#00FF00",
  Blue: "#0000FF",
  Yellow: "#FFFF00",
  Cyan: "#00FFFF",
  Magenta: "#FF00FF",
  Gray: "#888888",
  LightGray: "#CCCCCC",
  DarkGray: "#444444",
};

module.exports = {
  buildIosColorResolver,
  buildAndroidColorResolver,
  // exported for tests
  colorsetToHex,
  componentsToHex,
  parseComponent,
};
