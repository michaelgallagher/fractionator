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

  return { resolve, definitions: buildIosColorDefinitions(assets, aliases) };
}

/**
 * Enumerate the *full* iOS colour-token set for export — every defined token,
 * whether or not the prototype references it. The canonical token names are the
 * `extension Color` alias names (the API, e.g. `nhsBlue`); any asset without an
 * alias is included under its own name so nothing defined is dropped.
 *
 * @param {Map<string,{light?:string,dark?:string}>} assets - asset name → value
 * @param {Map<string,{assetName?:string,hex?:string}>} aliases - alias → target
 * @returns {{token:string, light?:string, dark?:string}[]}
 */
function buildIosColorDefinitions(assets, aliases) {
  const assetByLower = new Map();
  for (const name of assets.keys()) assetByLower.set(name.toLowerCase(), name);
  const realAssetName = (name) =>
    assets.has(name) ? name : assetByLower.get(String(name).toLowerCase());

  const defs = [];
  const seen = new Set(); // token names already emitted
  const coveredAssets = new Set(); // asset names reached via an alias

  // Aliases first, in declaration order — these carry the real API names.
  for (const [alias, target] of aliases) {
    let value = null;
    if (target.assetName) {
      const real = realAssetName(target.assetName);
      if (real) {
        value = assets.get(real);
        coveredAssets.add(real);
      }
    }
    if (!value && target.hex) value = { light: target.hex };
    const def = defValue(value);
    if (!def || seen.has(alias)) continue;
    seen.add(alias);
    defs.push({ token: alias, ...def });
  }

  // Then any asset with no alias pointing at it, so the set stays complete.
  const leftover = [...assets.keys()]
    .filter((name) => !coveredAssets.has(name))
    .sort((a, b) => a.localeCompare(b));
  for (const name of leftover) {
    const def = defValue(assets.get(name));
    if (!def || seen.has(name)) continue;
    seen.add(name);
    defs.push({ token: name, ...def });
  }

  return defs;
}

/** Normalise a `{light?,dark?}` into an emit-ready value, or null if empty. */
function defValue(value) {
  if (!value) return null;
  const out = {};
  if (value.light) out.light = value.light;
  if (value.dark) out.dark = value.dark;
  return out.light || out.dark ? out : null;
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
 * `colors.xml`.
 *
 * Compose has no asset catalog, so light/dark colors are expressed as parallel
 * palette `object`s — e.g. `NHSLightColors` and `NHSDarkColors`, each with the
 * same property names. We pair these by their *scheme base* (the object name
 * with the `Light`/`Dark` word removed) so that a reference to either side
 * resolves to the same `{light, dark}` value and the two collapse into a single
 * token — the same way an iOS asset's light and dark appearances do.
 *
 * @param {string} projectPath - Android project root
 */
function buildAndroidColorResolver(projectPath) {
  const named = new Map(); // "Object.prop" and bare "prop" → hex
  // base scheme (e.g. "NHSColors") + prop → { light?, dark? }
  const schemes = new Map();
  const xmlColors = new Map(); // colors.xml name → hex (light-only)

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
    indexKotlinColorDefs(src, named, schemes);
  }

  readColorsXml(projectPath, named, xmlColors);

  function resolve(key, kind, hit) {
    // Object-qualified brand reference (NHSLightColors.blue) — return the paired
    // light/dark value for its scheme so both sides merge into one token.
    if (hit && hit.object && hit.prop) {
      const { base } = schemeMode(hit.object);
      const paired = schemes.get(`${base}|${hit.prop}`);
      if (paired && (paired.light || paired.dark)) return { ...paired };
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

  return {
    resolve,
    definitions: buildAndroidColorDefinitions(schemes, xmlColors),
  };
}

/**
 * Enumerate the *full* Android colour-token set for export. The token names are
 * the palette property names (`blue`, `paleBlue`), paired across the light/dark
 * objects via `schemes`. High-contrast schemes are excluded so the export shows
 * the default palette — mirroring how the iOS reader drops high-contrast
 * appearances. `colors.xml` names that aren't palette props are appended as
 * light-only tokens.
 *
 * @param {Map<string,{light?:string,dark?:string}>} schemes - "base|prop" → value
 * @param {Map<string,string>} xmlColors - colors.xml name → hex
 * @returns {{token:string, light?:string, dark?:string}[]}
 */
function buildAndroidColorDefinitions(schemes, xmlColors = new Map()) {
  const defs = [];
  const seen = new Set();

  for (const [key, value] of schemes) {
    const sep = key.indexOf("|");
    const base = key.slice(0, sep);
    const prop = key.slice(sep + 1);
    if (/HighContrast/i.test(base)) continue;
    const def = defValue(value);
    if (!def || seen.has(prop)) continue;
    seen.add(prop);
    defs.push({ token: prop, ...def });
  }

  for (const [name, hex] of xmlColors) {
    if (seen.has(name)) continue;
    seen.add(name);
    defs.push({ token: name, light: hex });
  }

  return defs;
}

/**
 * Split a palette object name into its scheme base and light/dark mode.
 * `NHSLightColors` → { base: "NHSColors", mode: "light" }.
 * `NHSHighContrastDarkColors` → { base: "NHSHighContrastColors", mode: "dark" }.
 * A name without Light/Dark is treated as a light-only scheme keyed by itself.
 */
function schemeMode(objectName) {
  if (/Dark/.test(objectName))
    return { base: objectName.replace("Dark", ""), mode: "dark" };
  if (/Light/.test(objectName))
    return { base: objectName.replace("Light", ""), mode: "light" };
  return { base: objectName, mode: "light" };
}

/**
 * Index `val NAME = Color(0x…)` defs, scoped to their enclosing `object`. Fills
 * `named` (bare and `Object.prop` keys) and `schemes` (paired light/dark per
 * scheme base).
 */
function indexKotlinColorDefs(src, named, schemes) {
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
      if (obj) {
        named.set(`${obj.name}.${prop}`, hex);
        if (schemes) {
          const { base, mode } = schemeMode(obj.name);
          const schemeKey = `${base}|${prop}`;
          const entry = schemes.get(schemeKey) || {};
          entry[mode] = hex;
          schemes.set(schemeKey, entry);
        }
      }
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

/**
 * Read `<color name="x">#AARRGGBB</color>` entries from res/values/colors.xml.
 * Fills `named` (for resolution) and, when provided, `xmlColors` (the bare
 * name → hex set used by the full-token export).
 */
function readColorsXml(projectPath, named, xmlColors) {
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
      const hex = argbToHex(m[2]);
      named.set(m[1], hex);
      if (xmlColors) xmlColors.set(m[1], hex);
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
  buildIosColorDefinitions,
  buildAndroidColorDefinitions,
  // exported for tests
  colorsetToHex,
  componentsToHex,
  parseComponent,
  schemeMode,
};
