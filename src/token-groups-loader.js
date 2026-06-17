const fs = require("fs");
const yaml = require("js-yaml");

/**
 * Load and validate a token-groups config — the editorial grouping of tokens
 * into named sections (Core palette, Greyscale, …) that the prototype source
 * can't express on its own.
 *
 * Expected shape (keyed by platform, then category):
 *   ios:
 *     colours:
 *       - heading: "Accent colour"
 *         description: "…"            # optional
 *         tokens: [nhsAccentColor]
 *       - heading: "Core palette"
 *         tokens: [nhsBlue, nhsGreen]
 *   android:
 *     colours: [...]
 *
 * @param {string} groupsPath - Path to the YAML file.
 * @returns {object} - The parsed, validated config (platform → category → defs).
 * @throws {Error} - If the file is missing, unparseable, or malformed.
 */
function loadTokenGroups(groupsPath) {
  let raw;
  try {
    raw = fs.readFileSync(groupsPath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read token-groups file ${groupsPath}: ${err.message}`);
  }

  let doc;
  try {
    doc = yaml.load(raw);
  } catch (err) {
    throw new Error(`Invalid YAML in ${groupsPath}: ${err.message}`);
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(
      `Token-groups file ${groupsPath} must be a map of platform → category → groups.`,
    );
  }

  for (const [platform, categories] of Object.entries(doc)) {
    if (!categories || typeof categories !== "object" || Array.isArray(categories)) {
      throw new Error(
        `Token-groups file ${groupsPath}: "${platform}" must map categories to group lists.`,
      );
    }
    for (const [category, defs] of Object.entries(categories)) {
      if (!Array.isArray(defs)) {
        throw new Error(
          `Token-groups file ${groupsPath}: "${platform}.${category}" must be a list of groups.`,
        );
      }
      defs.forEach((def, i) => {
        const where = `${platform}.${category}[${i}]`;
        if (!def || typeof def !== "object" || typeof def.heading !== "string") {
          throw new Error(
            `Token-groups file ${groupsPath}: ${where} needs a string "heading".`,
          );
        }
        if (!Array.isArray(def.tokens)) {
          throw new Error(
            `Token-groups file ${groupsPath}: ${where} needs a "tokens" list.`,
          );
        }
      });
    }
  }

  return doc;
}

/**
 * Slice the group defs for one platform + category out of a loaded config,
 * returning `undefined` when the config (or that slice) is absent so callers can
 * fall back to the default single-group behaviour.
 */
function groupsFor(config, platform, category) {
  return config?.[platform]?.[category];
}

module.exports = { loadTokenGroups, groupsFor };
