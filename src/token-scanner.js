const fs = require("fs");
const path = require("path");

/**
 * Design-token scanner.
 *
 * Given a list of source files and a platform token-spec, extract every
 * occurrence of a style token — a color, a type size/style, or a spacing unit —
 * as a flat list of raw occurrences. Aggregation into unique tokens (with counts
 * and resolved values) happens later in token-catalogue.js; this module is only
 * concerned with *finding* occurrences.
 *
 * A token-spec is a per-platform object:
 *   {
 *     stripComments: (src) => string,   // comment stripper for the language
 *     colors:     [ MatcherFn, ... ],
 *     typography: [ MatcherFn, ... ],
 *     spacing:    [ MatcherFn, ... ],
 *   }
 *
 * A MatcherFn receives a single (comment-stripped) line and returns an array of
 * partial occurrences `{ key, display, ...extra }` found on that line — or an
 * empty array. The scanner adds `category`, `relativePath`, and `lineNumber`.
 *
 * @param {string[]} files - Absolute paths to source files
 * @param {string} projectPath - Project root, for computing relative paths
 * @param {object} spec - Platform token-spec (see iosTokenSpec / androidTokenSpec)
 * @returns {Occurrence[]}
 */
function scanTokens(files, projectPath, spec) {
  const occurrences = [];

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const stripped = spec.stripComments(content);
    const relativePath = path.relative(projectPath, filePath);
    const lines = stripped.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      for (const category of ["colors", "typography", "spacing"]) {
        for (const matcher of spec[category]) {
          const hits = matcher(line);
          for (const hit of hits) {
            occurrences.push({
              category,
              relativePath,
              lineNumber,
              ...hit,
            });
          }
        }
      }
    }
  }

  return occurrences;
}

/**
 * Build a MatcherFn from a global RegExp and a mapping function. The mapping
 * function turns a single RegExpMatchArray into a partial occurrence object, or
 * `null` to skip it.
 */
function matcher(regex, map) {
  return (line) => {
    const out = [];
    // Reset lastIndex — the regex is reused across lines.
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(line)) !== null) {
      const hit = map(m);
      if (hit) out.push(hit);
      // Guard against zero-width matches looping forever.
      if (m.index === regex.lastIndex) regex.lastIndex++;
    }
    return out;
  };
}

// SwiftUI system text styles (semantic type tokens).
const SWIFT_TEXT_STYLES = [
  "largeTitle",
  "title",
  "title2",
  "title3",
  "headline",
  "subheadline",
  "body",
  "callout",
  "footnote",
  "caption",
  "caption2",
];

// SwiftUI system semantic colors that are platform-provided, not brand tokens.
const SWIFT_SYSTEM_COLORS = new Set([
  "clear",
  "primary",
  "secondary",
  "accentColor",
  "black",
  "white",
  "gray",
  "red",
  "green",
  "blue",
  "orange",
  "yellow",
  "pink",
  "purple",
  "brown",
  "cyan",
  "mint",
  "indigo",
  "teal",
]);

/**
 * iOS / SwiftUI token-spec.
 *
 * @param {(src: string) => string} stripComments - Swift comment stripper
 */
function iosTokenSpec(stripComments) {
  return {
    stripComments,
    colors: [
      // Named asset color: Color("NHSGreen")
      matcher(/\bColor\(\s*"([^"]+)"\s*\)/g, (m) => ({
        key: m[1],
        display: `Color("${m[1]}")`,
        kind: "asset",
      })),
      // Dot-named color: Color.nhsGreen  /  .foregroundColor(.nhsGreen)
      // We only take the `Color.<name>` form to avoid matching unrelated dot
      // chains; brand extensions are referenced this way throughout.
      matcher(/\bColor\.([a-zA-Z_]\w*)/g, (m) => {
        const name = m[1];
        const isSystem = SWIFT_SYSTEM_COLORS.has(name);
        return {
          key: name,
          display: `Color.${name}`,
          kind: isSystem ? "semantic" : "alias",
        };
      }),
      // Literal RGB: Color(red: 0.9, green: 0.5, blue: 0.0)
      matcher(
        /\bColor\(\s*red:\s*([\d.]+)\s*,\s*green:\s*([\d.]+)\s*,\s*blue:\s*([\d.]+)/g,
        (m) => {
          const hex = rgbFloatToHex(+m[1], +m[2], +m[3]);
          return {
            key: hex,
            display: hex,
            kind: "literal",
            value: { light: hex },
          };
        },
      ),
    ],
    typography: [
      // Explicit size: .system(size: 40, weight: .bold)
      matcher(
        /\.system\(\s*size:\s*(\d+(?:\.\d+)?)\s*(?:,\s*weight:\s*\.(\w+))?[^)]*\)/g,
        (m) => {
          const size = parseFloat(m[1]);
          const weight = m[2] || null;
          return {
            key: weight ? `system-${size}-${weight}` : `system-${size}`,
            display: weight
              ? `.system(size: ${m[1]}, weight: .${weight})`
              : `.system(size: ${m[1]})`,
            kind: "explicit",
            size,
            weight,
          };
        },
      ),
      // Semantic style: .font(.title3)  /  .font(.body.bold())
      matcher(
        new RegExp(`\\.font\\(\\.(${SWIFT_TEXT_STYLES.join("|")})\\b`, "g"),
        (m) => ({
          key: m[1],
          display: `.${m[1]}`,
          kind: "semantic",
        }),
      ),
    ],
    spacing: [
      // Stack spacing: spacing: 16
      matcher(/\bspacing:\s*(\d+(?:\.\d+)?)/g, (m) => spacingHit(m[1], "spacing")),
      // Uniform padding: .padding(16)
      matcher(/\.padding\(\s*(\d+(?:\.\d+)?)\s*\)/g, (m) =>
        spacingHit(m[1], "padding"),
      ),
      // Edge padding: .padding(.vertical, 8)
      matcher(/\.padding\(\s*\.\w+\s*,\s*(\d+(?:\.\d+)?)\s*\)/g, (m) =>
        spacingHit(m[1], "padding"),
      ),
    ],
  };
}

/**
 * Android / Jetpack Compose token-spec.
 *
 * @param {(src: string) => string} stripComments - Kotlin comment stripper
 */
function androidTokenSpec(stripComments) {
  return {
    stripComments,
    colors: [
      // Literal hex: Color(0xFFED8B00)
      matcher(/\bColor\(\s*0x([0-9A-Fa-f]{6,8})\s*\)/g, (m) => {
        const hex = argbToHex(m[1]);
        return {
          key: hex,
          display: hex,
          kind: "literal",
          value: { light: hex },
        };
      }),
      // Theme reference: MaterialTheme.colorScheme.primary
      matcher(/\bMaterialTheme\.colorScheme\.(\w+)/g, (m) => ({
        key: m[1],
        display: `colorScheme.${m[1]}`,
        kind: "semantic",
      })),
      // Brand object reference: NHSLightColors.blue. The original object name is
      // kept for resolution, but the display/key drop the Light/Dark word so the
      // two sides of a palette pair collapse into one token (NHSColors.blue).
      matcher(/\b([A-Z]\w*Colors)\.([a-z]\w*)/g, (m) => {
        const base = m[1].replace(/(Light|Dark)/, "");
        return {
          key: `${base}.${m[2]}`,
          display: `${base}.${m[2]}`,
          kind: "alias",
          object: m[1],
          prop: m[2],
        };
      }),
      // Bare Compose constant: Color.White
      matcher(/\bColor\.([A-Z]\w*)/g, (m) => ({
        key: m[1],
        display: `Color.${m[1]}`,
        kind: "semantic",
      })),
    ],
    typography: [
      // Explicit size: fontSize = 16.sp  /  16.sp
      matcher(/\b(\d+(?:\.\d+)?)\.sp\b/g, (m) => {
        const size = parseFloat(m[1]);
        return {
          key: `sp-${size}`,
          display: `${m[1]}.sp`,
          kind: "explicit",
          size,
        };
      }),
      // Theme reference: MaterialTheme.typography.titleLarge
      matcher(/\bMaterialTheme\.typography\.(\w+)/g, (m) => ({
        key: m[1],
        display: `typography.${m[1]}`,
        kind: "semantic",
      })),
    ],
    spacing: [
      // dp units: 16.dp
      matcher(/\b(\d+(?:\.\d+)?)\.dp\b/g, (m) => spacingHit(m[1], "dp", "dp")),
    ],
  };
}

/** Build a spacing occurrence from a numeric string. */
function spacingHit(numStr, context, unit = "pt") {
  return {
    key: `${numStr}`,
    display: `${numStr}`,
    value: parseFloat(numStr),
    unit,
    context,
  };
}

/** Convert 0–1 float RGB components to an uppercase #RRGGBB hex string. */
function rgbFloatToHex(r, g, b) {
  const c = (x) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Convert an ARGB or RGB hex string (without 0x) to #RRGGBB, dropping any
 * leading alpha byte. `FFED8B00` → `#ED8B00`, `ED8B00` → `#ED8B00`.
 */
function argbToHex(hex) {
  const h = hex.length === 8 ? hex.slice(2) : hex;
  return `#${h.toUpperCase()}`;
}

module.exports = {
  scanTokens,
  matcher,
  iosTokenSpec,
  androidTokenSpec,
  rgbFloatToHex,
  argbToHex,
  SWIFT_TEXT_STYLES,
  SWIFT_SYSTEM_COLORS,
};
