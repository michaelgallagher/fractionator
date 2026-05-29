/**
 * Cross-platform component alignment.
 *
 * Matches components across platforms so the catalogue can show which concepts
 * are shared, which are named differently, and which exist on only one
 * platform. Matching runs in three passes:
 *
 *   1. Manual mapping (from component-mapping.yaml) — applied first and wins.
 *   2. Exact name match across platforms.
 *   3. Normalized name match (conservative prefix/suffix stripping).
 *
 * Anything left over becomes a "platform-only" concept.
 */

const PLATFORMS = ["ios", "android", "web"];

// Conservative normalization defaults — see docs/plans/component-catalogue.md.
const DEFAULT_PREFIXES = ["NHS"];
const DEFAULT_SUFFIXES = ["UI", "View", "Component"];

/**
 * Normalize a component name for fuzzy matching: strip a known prefix and a
 * known suffix (at most one of each), then lowercase.
 *
 * e.g. with defaults: "NHSCard" → "card", "NHSCardUI" → "card".
 *
 * @param {string} name
 * @param {{prefixes?: string[], suffixes?: string[]}} [config]
 * @returns {string}
 */
function normalizeName(name, config = {}) {
  const prefixes = config.prefixes || DEFAULT_PREFIXES;
  const suffixes = config.suffixes || DEFAULT_SUFFIXES;

  let result = name;

  for (const prefix of prefixes) {
    if (result.length > prefix.length && result.startsWith(prefix)) {
      result = result.slice(prefix.length);
      break;
    }
  }

  for (const suffix of suffixes) {
    if (result.length > suffix.length && result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }

  return result.toLowerCase();
}

/**
 * Match components across platforms.
 *
 * @param {Object<string, {name: string, relativePath?: string}[]>} platformComponents
 *   Per-platform component lists (unfiltered — include unused). Keys are
 *   platform names ("ios", "android", "web").
 * @param {{mappings: object[]}|null} [mapping] - Parsed mapping file, or null.
 * @param {{prefixes?: string[], suffixes?: string[]}} [config] - Normalization config.
 * @returns {AlignmentEntry[]}
 */
function matchComponents(platformComponents, mapping = null, config = {}) {
  // Active platforms (those provided), in canonical order.
  const platforms = PLATFORMS.filter((p) =>
    Array.isArray(platformComponents[p]),
  );

  // Track which component names are still unconsumed, per platform.
  const remaining = {};
  for (const p of platforms) {
    remaining[p] = new Set((platformComponents[p] || []).map((c) => c.name));
  }

  const entries = [];

  // --- Pass 1: manual mapping (wins over auto-matching) ---
  if (mapping && Array.isArray(mapping.mappings)) {
    for (const m of mapping.mappings) {
      const names = {};
      let presentCount = 0;
      const missing = [];

      for (const p of platforms) {
        const name = m[p];
        if (name == null) {
          names[p] = null;
          continue;
        }
        names[p] = name;
        presentCount++;
        if (remaining[p].has(name)) {
          remaining[p].delete(name);
        } else {
          // Named in the mapping but not detected — surface it for curation.
          missing.push(`${p}:${name}`);
        }
      }

      // Skip empty mapping rows (no platform names at all).
      if (presentCount === 0) continue;

      entries.push({
        concept: m.concept || firstName(names),
        source: "mapping",
        platforms: names,
        status: presentCount >= 2 ? "matched" : "platform-only",
        drift: hasDrift(names),
        ...(missing.length > 0 ? { missing } : {}),
      });
    }
  }

  // --- Pass 2: exact name match across platforms ---
  // Build name → [platforms that still have it].
  const exactIndex = new Map();
  for (const p of platforms) {
    for (const name of remaining[p]) {
      if (!exactIndex.has(name)) exactIndex.set(name, []);
      exactIndex.get(name).push(p);
    }
  }

  for (const [name, ps] of exactIndex) {
    if (ps.length < 2) continue; // only one platform — leave for platform-only
    const names = blankNames(platforms);
    for (const p of ps) {
      names[p] = name;
      remaining[p].delete(name);
    }
    entries.push({
      concept: name,
      source: "exact",
      platforms: names,
      status: "matched",
      drift: false,
    });
  }

  // --- Pass 3: normalized name match across platforms ---
  // Group remaining names by normalized key. Only the first remaining name per
  // platform participates (avoids ambiguous many-to-many collapses).
  const normIndex = new Map(); // normKey → { platform → name }
  for (const p of platforms) {
    for (const name of remaining[p]) {
      const key = normalizeName(name, config);
      if (!normIndex.has(key)) normIndex.set(key, {});
      const bucket = normIndex.get(key);
      if (bucket[p] === undefined) bucket[p] = name;
    }
  }

  for (const [, bucket] of normIndex) {
    const ps = Object.keys(bucket);
    if (ps.length < 2) continue;
    const names = blankNames(platforms);
    for (const p of ps) {
      names[p] = bucket[p];
      remaining[p].delete(bucket[p]);
    }
    entries.push({
      concept: prettyConcept(bucket[ps[0]], config),
      source: "normalized",
      platforms: names,
      status: "matched",
      drift: hasDrift(names),
    });
  }

  // --- Pass 4: platform-only leftovers ---
  for (const p of platforms) {
    for (const name of remaining[p]) {
      const names = blankNames(platforms);
      names[p] = name;
      entries.push({
        concept: name,
        source: p,
        platforms: names,
        status: "platform-only",
        drift: false,
      });
    }
  }

  // Stable, readable ordering: matched first, then platform-only; alphabetical
  // within each group.
  entries.sort((a, b) => {
    if (a.status !== b.status) return a.status === "matched" ? -1 : 1;
    return a.concept.localeCompare(b.concept);
  });

  return entries;
}

/** True if the non-null platform names are not all identical. */
function hasDrift(names) {
  const present = Object.values(names).filter((n) => n != null);
  if (present.length < 2) return false;
  return new Set(present).size > 1;
}

/** Build a name map with every platform set to null. */
function blankNames(platforms) {
  const names = {};
  for (const p of platforms) names[p] = null;
  return names;
}

/** First non-null name in a names map, for a fallback concept label. */
function firstName(names) {
  return Object.values(names).find((n) => n != null) || "(unnamed)";
}

/**
 * Title-case a normalized concept label from a representative name. Falls back
 * to the raw name with prefix/suffix stripped but original casing preserved
 * where possible.
 */
function prettyConcept(name, config) {
  const norm = normalizeName(name, config);
  if (!norm) return name;
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}

module.exports = { matchComponents, normalizeName };
