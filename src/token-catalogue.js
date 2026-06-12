/**
 * Aggregate raw token occurrences (from token-scanner) into the catalogue shape
 * consumed by the report: unique tokens per category, each with a usage count,
 * source locations, and — for colors — a resolved hex value.
 */

// Apple's default point sizes for the system text styles, used only to order
// the type scale sensibly (semantic styles have no size in the source).
const SEMANTIC_TYPE_SIZE = {
  largeTitle: 34,
  title: 28,
  title2: 22,
  title3: 20,
  headline: 17,
  body: 17,
  callout: 16,
  subheadline: 15,
  footnote: 13,
  caption: 12,
  caption2: 11,
};

/**
 * @param {Occurrence[]} occurrences - Flat list from scanTokens
 * @param {{resolve: Function}|null} colorResolver - Platform color resolver
 * @param {{resolve: Function}|null} typeResolver - Resolves semantic type roles
 *        (e.g. Compose `typography.bodyLarge`) to point sizes
 * @returns {{ colors: Token[], typography: Token[], spacing: Token[] }}
 */
function buildTokenCatalogue(occurrences, colorResolver, typeResolver) {
  const byCategory = { colors: [], typography: [], spacing: [] };
  for (const o of occurrences) byCategory[o.category].push(o);

  return {
    colors: aggregateColors(byCategory.colors, colorResolver),
    typography: aggregateTypography(byCategory.typography, typeResolver),
    spacing: aggregateSpacing(byCategory.spacing),
  };
}

/**
 * Colors are merged by resolved hex so the palette shows one entry per real
 * color, collecting the various ways it's referenced. Unresolved references
 * (system semantics, theme refs) group by their key.
 */
function aggregateColors(occurrences, resolver) {
  const groups = new Map();

  for (const o of occurrences) {
    const value =
      o.value || (resolver ? resolver.resolve(o.key, o.kind, o) : null);
    // Group by the full light+dark pair so adaptive colors and their
    // non-adapting "Only" twins (same light, different dark) stay distinct.
    const groupKey =
      value && value.light
        ? `hex:${value.light}:${value.dark || ""}`
        : `key:${o.key}`;

    let g = groups.get(groupKey);
    if (!g) {
      g = {
        value: value || null,
        kind: o.kind,
        count: 0,
        displays: new Map(), // display string → sub-count
        locations: [],
      };
      groups.set(groupKey, g);
    }

    g.count++;
    g.displays.set(o.display, (g.displays.get(o.display) || 0) + 1);
    g.locations.push({ relativePath: o.relativePath, lineNumber: o.lineNumber });

    // Prefer a concrete kind and a fuller value (one carrying dark) as we merge.
    if (g.kind === "semantic" && o.kind !== "semantic") g.kind = o.kind;
    if (value) g.value = mergeValue(g.value, value);
  }

  const tokens = [];
  for (const g of groups.values()) {
    const displays = [...g.displays.entries()].sort((a, b) => b[1] - a[1]);
    tokens.push({
      display: displays[0][0],
      aliases: displays.slice(1).map(([d]) => d),
      kind: g.kind,
      value: g.value,
      count: g.count,
      locations: g.locations,
    });
  }

  tokens.sort((a, b) => b.count - a.count || a.display.localeCompare(b.display));
  return tokens;
}

/** Merge two `{light?, dark?}` values, keeping any dark variant that appears. */
function mergeValue(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    light: a.light || b.light,
    ...(a.dark || b.dark ? { dark: a.dark || b.dark } : {}),
  };
}

/** Type tokens group by key; ordered as an ascending scale by point size. */
function aggregateTypography(occurrences, typeResolver) {
  const groups = new Map();

  for (const o of occurrences) {
    let g = groups.get(o.key);
    if (!g) {
      // Size precedence: explicit (e.g. `.system(size:)`, `N.sp`) → iOS system
      // style defaults → platform theme resolution (Compose Typography roles).
      const size =
        o.size != null
          ? o.size
          : SEMANTIC_TYPE_SIZE[o.key] ??
            (typeResolver ? typeResolver.resolve(o.key) : null) ??
            null;
      g = {
        key: o.key,
        display: o.display,
        kind: o.kind,
        size,
        weight: o.weight || null,
        count: 0,
        locations: [],
      };
      groups.set(o.key, g);
    }
    g.count++;
    g.locations.push({ relativePath: o.relativePath, lineNumber: o.lineNumber });
  }

  const tokens = [...groups.values()];
  tokens.sort((a, b) => {
    // Known sizes ascending; unknown sizes sink to the bottom by count.
    if (a.size != null && b.size != null) return a.size - b.size;
    if (a.size != null) return -1;
    if (b.size != null) return 1;
    return b.count - a.count;
  });
  return tokens;
}

/** Spacing tokens group by numeric value; ordered as an ascending scale. */
function aggregateSpacing(occurrences) {
  const groups = new Map();

  for (const o of occurrences) {
    const key = `${o.value}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        value: o.value,
        unit: o.unit,
        count: 0,
        contexts: new Set(),
        locations: [],
      };
      groups.set(key, g);
    }
    g.count++;
    g.contexts.add(o.context);
    g.locations.push({ relativePath: o.relativePath, lineNumber: o.lineNumber });
  }

  const tokens = [...groups.values()].map((g) => ({
    value: g.value,
    unit: g.unit,
    count: g.count,
    contexts: [...g.contexts].sort(),
    locations: g.locations,
  }));
  tokens.sort((a, b) => a.value - b.value);
  return tokens;
}

module.exports = {
  buildTokenCatalogue,
  SEMANTIC_TYPE_SIZE,
};
