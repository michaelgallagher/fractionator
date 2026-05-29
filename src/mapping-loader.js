const fs = require("fs");
const yaml = require("js-yaml");

/**
 * Load and validate a component-mapping.yaml file.
 *
 * Expected shape:
 *   mappings:
 *     - concept: "Card"
 *       ios: NHSCard
 *       android: NHSCardUI
 *       web: null
 *
 * @param {string} mappingPath - Path to the YAML file.
 * @returns {{mappings: object[]}} - The parsed, validated mapping object.
 * @throws {Error} - If the file is missing, unparseable, or malformed.
 */
function loadMapping(mappingPath) {
  let raw;
  try {
    raw = fs.readFileSync(mappingPath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read mapping file ${mappingPath}: ${err.message}`);
  }

  let doc;
  try {
    doc = yaml.load(raw);
  } catch (err) {
    throw new Error(`Invalid YAML in ${mappingPath}: ${err.message}`);
  }

  if (!doc || typeof doc !== "object" || !Array.isArray(doc.mappings)) {
    throw new Error(
      `Mapping file ${mappingPath} must contain a top-level "mappings" list.`,
    );
  }

  return { mappings: doc.mappings };
}

module.exports = { loadMapping };
