// Display-trait variations for screenshot capture.
//
// Each mode pins ALL three accessibility/appearance axes (appearance, content
// size, increased contrast) to fixed values, so a variation isolates a single
// axis against a known baseline regardless of the device's pre-existing state.
// The values are applied as global OS trait overrides (iOS: `simctl ui`,
// Android: `adb` settings) — no rebuild is needed between modes.
//
// iOS content-size categories come from `simctl ui content_size`; the default
// is "large". Android font_scale 1.0 is the baseline; ~2.0 approximates iOS
// accessibility-extra-extra-extra-large.

const MODES = {
  baseline: {
    label: "Baseline",
    ios: {
      appearance: "light",
      content_size: "large",
      increase_contrast: "disabled",
    },
    android: { night: "no", font_scale: "1.0", high_text_contrast: "0" },
  },
  dark: {
    label: "Dark",
    ios: {
      appearance: "dark",
      content_size: "large",
      increase_contrast: "disabled",
    },
    android: { night: "yes", font_scale: "1.0", high_text_contrast: "0" },
  },
  type: {
    label: "Large type",
    ios: {
      appearance: "light",
      content_size: "accessibility-extra-extra-extra-large",
      increase_contrast: "disabled",
    },
    android: { night: "no", font_scale: "2.0", high_text_contrast: "0" },
  },
  contrast: {
    label: "High contrast",
    ios: {
      appearance: "light",
      content_size: "large",
      increase_contrast: "enabled",
    },
    android: { night: "no", font_scale: "1.0", high_text_contrast: "1" },
  },
};

// Modes selectable via --variations. Baseline is always captured as the
// reference and is never listed here.
const SELECTABLE = ["dark", "type", "contrast"];

/**
 * Parse a --variations value into an ordered, de-duplicated list of mode ids.
 * Baseline is always first. "all" expands to every selectable mode.
 *
 * @param {string} str - e.g. "dark,type" or "all"
 * @returns {string[]} e.g. ["baseline", "dark", "type"]
 * @throws {Error} on an unknown mode name
 */
function parseVariations(str) {
  if (!str || !str.trim()) return ["baseline"];

  const requested = str
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const selected = [];
  for (const name of requested) {
    if (name === "all") {
      for (const m of SELECTABLE) {
        if (!selected.includes(m)) selected.push(m);
      }
      continue;
    }
    if (!SELECTABLE.includes(name)) {
      throw new Error(
        `Unknown variation "${name}". Valid values: ${SELECTABLE.join(", ")}, all.`,
      );
    }
    if (!selected.includes(name)) selected.push(name);
  }

  return ["baseline", ...selected];
}

/**
 * Screenshot filename for a preview under a given mode. Baseline keeps the
 * bare `${id}.png` so default (no-variations) runs are byte-for-byte
 * compatible with previous output; other modes get a `__${modeId}` suffix.
 *
 * @param {string} id - sanitized preview id
 * @param {string} modeId
 * @returns {string}
 */
function screenshotFilename(id, modeId) {
  return modeId === "baseline" ? `${id}.png` : `${id}__${modeId}.png`;
}

module.exports = { MODES, SELECTABLE, parseVariations, screenshotFilename };
