const path = require("path");
const { scanSwiftComponents } = require("./swift-component-scanner");
const { scanUsages } = require("./usage-scanner");
const { groupVariants } = require("./variant-grouper");
const { buildReport } = require("./build-report");
const { captureComponentScreenshots } = require("./swift-screenshot-capture");

/**
 * Main entry point. Scans the provided prototype sources, builds the
 * catalogue, and writes output files.
 */
async function generate(options) {
  const {
    sources,
    outputDir,
    formats,
    componentsDirOverride,
    includeUnused,
  } = options;

  console.log("Fractionator — Component Catalogue\n");

  const catalogue = { platforms: {} };

  // --- iOS / SwiftUI ---
  if (sources.ios) {
    console.log(`Scanning iOS prototype: ${sources.ios}`);

    const { components, allSwiftFiles } = scanSwiftComponents(
      sources.ios,
      componentsDirOverride,
    );
    console.log(
      `   Found ${components.length} components in ${allSwiftFiles.length} Swift files`,
    );

    const usageMap = scanUsages(components, allSwiftFiles, sources.ios);

    let totalUsages = 0;
    for (const usages of usageMap.values()) totalUsages += usages.length;
    console.log(`   Found ${totalUsages} total usages`);

    const variantMap = groupVariants(components, usageMap);

    // Capture screenshots of component previews
    let screenshotMap = new Map();
    if (!options.noScreenshots) {
      try {
        screenshotMap = await captureComponentScreenshots(
          components,
          sources.ios,
          outputDir,
        );
      } catch (err) {
        console.warn(`   ⚠️  Screenshot capture failed: ${err.message}`);
        console.warn("   Continuing without screenshots");
      }
    } else {
      console.log("   Screenshots skipped (--no-screenshots)");
    }

    // Assemble per-component catalogue entries
    const entries = components.map((comp) => {
      const usages = usageMap.get(comp.name) || [];
      const variants = variantMap.get(comp.name) || [];
      const screenshots = screenshotMap.get(comp.name) || [];

      return {
        name: comp.name,
        platform: "ios",
        relativePath: comp.relativePath,
        signature: comp.signature,
        previews: comp.previews,
        screenshots,
        usageCount: usages.length,
        usages: usages.map((u) => ({
          relativePath: u.relativePath,
          lineNumber: u.lineNumber,
          enclosingView: u.enclosingView,
          rawArgs: u.rawArgs,
        })),
        variants: variants.map((v) => ({
          label: v.label,
          count: v.count,
          signatureKey: v.signatureKey,
          usages: v.usages.map((u) => ({
            relativePath: u.relativePath,
            lineNumber: u.lineNumber,
            enclosingView: u.enclosingView,
          })),
        })),
      };
    });

    // Filter unused if not requested
    const filtered = includeUnused
      ? entries
      : entries.filter((e) => e.usageCount > 0);

    catalogue.platforms.ios = {
      projectPath: sources.ios,
      componentCount: components.length,
      usedCount: entries.filter((e) => e.usageCount > 0).length,
      unusedCount: entries.filter((e) => e.usageCount === 0).length,
      components: filtered,
    };

    const unusedNames = entries
      .filter((e) => e.usageCount === 0)
      .map((e) => e.name);
    if (unusedNames.length > 0) {
      console.log(
        `   ${unusedNames.length} unused components${includeUnused ? " (included)" : " (excluded — use --include-unused to show)"}`,
      );
    }
  }

  // --- Android / Compose (Phase 2 — placeholder) ---
  if (sources.android) {
    console.log(`\nAndroid support is not yet implemented (Phase 2)`);
  }

  // --- Web / Nunjucks (Phase 4 — placeholder) ---
  if (sources.web) {
    console.log(`\nWeb support is not yet implemented (Phase 4)`);
  }

  // --- Build output ---
  console.log(`\nWriting output to ${outputDir}`);
  buildReport(catalogue, outputDir, formats);
  console.log("\nDone.");
}

module.exports = { generate };
