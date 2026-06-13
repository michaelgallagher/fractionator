const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const {
  scanSwiftComponents,
  stripSwiftComments,
} = require("./swift-component-scanner");
const {
  scanKotlinComponents,
  stripKotlinComments,
  detectKotlinEnclosingView,
  isInsideKotlinPreview,
} = require("./kotlin-component-scanner");
const { scanUsages } = require("./usage-scanner");
const { groupVariants } = require("./variant-grouper");
const { buildReport } = require("./build-report");
const {
  captureComponentScreenshots,
  analyzePreviews,
} = require("./swift-screenshot-capture");
const {
  captureAndroidScreenshots,
  analyzeKotlinPreviews,
} = require("./kotlin-screenshot-capture");
const { matchComponents } = require("./cross-platform-matcher");
const { generateMappingYaml } = require("./mapping-generator");
const { loadMapping } = require("./mapping-loader");
const {
  scanTokens,
  iosTokenSpec,
  androidTokenSpec,
} = require("./token-scanner");
const {
  buildIosColorResolver,
  buildAndroidColorResolver,
} = require("./color-resolver");
const { buildAndroidTypeResolver } = require("./type-resolver");
const { buildTokenCatalogue } = require("./token-catalogue");

/**
 * Main entry point. Scans the provided prototype sources, builds the
 * catalogue, and writes output files.
 */
async function generate(options) {
  const { sources, outputDir, formats, componentsDirOverride, includeUnused } =
    options;

  console.log("🧬 Fractionator\n");

  const catalogue = { platforms: {}, tokens: {} };

  // Unfiltered component lists per platform, for cross-platform matching.
  // (Unused components still matter for alignment, so this is collected from
  // the full entry list — before the --include-unused filter.)
  const platformComponents = {};

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

    // Static preview diagnostics (no simulator needed): which previews exist
    // and, for those we can't capture, why. Drives the report's "no preview" /
    // "skipped" status so missing previews are explained, not silently absent.
    const previewDiagnostics = analyzePreviews(components, sources.ios);

    // Capture screenshots of component previews
    let screenshotMap = new Map();
    if (!options.noScreenshots && !options.initMapping) {
      try {
        screenshotMap = await captureComponentScreenshots(
          components,
          sources.ios,
          outputDir,
          { modes: options.variations },
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
        previewDiagnostics: previewDiagnostics.get(comp.name) || [],
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

    platformComponents.ios = entries.map((e) => ({
      name: e.name,
      relativePath: e.relativePath,
    }));

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

    // Design tokens — colors, type sizes, spacing — across all Swift files.
    const iosTokenOccurrences = scanTokens(
      allSwiftFiles,
      sources.ios,
      iosTokenSpec(stripSwiftComments),
    );
    catalogue.tokens.ios = buildTokenCatalogue(
      iosTokenOccurrences,
      buildIosColorResolver(sources.ios),
    );
    logTokenSummary(catalogue.tokens.ios);

    const unusedNames = entries
      .filter((e) => e.usageCount === 0)
      .map((e) => e.name);
    if (unusedNames.length > 0) {
      console.log(
        `   ${unusedNames.length} unused components${includeUnused ? " (included)" : " (excluded — use --include-unused to show)"}`,
      );
    }
  }

  // --- Android / Compose ---
  if (sources.android) {
    console.log(`Scanning Android prototype: ${sources.android}`);

    const { components: androidComponents, allKotlinFiles } =
      scanKotlinComponents(sources.android, componentsDirOverride);
    console.log(
      `   Found ${androidComponents.length} components in ${allKotlinFiles.length} Kotlin files`,
    );

    const kotlinLangConfig = {
      stripComments: stripKotlinComments,
      detectEnclosingView: detectKotlinEnclosingView,
      isInsidePreview: isInsideKotlinPreview,
      fileExtension: ".kt",
    };

    const androidUsageMap = scanUsages(
      androidComponents,
      allKotlinFiles,
      sources.android,
      kotlinLangConfig,
    );

    let totalAndroidUsages = 0;
    for (const usages of androidUsageMap.values())
      totalAndroidUsages += usages.length;
    console.log(`   Found ${totalAndroidUsages} total usages`);

    const androidVariantMap = groupVariants(androidComponents, androidUsageMap);

    // Static preview diagnostics (no emulator needed): which previews exist and,
    // for those we can't capture, why. Drives the report's "no preview" /
    // "skipped" status so missing previews are explained, not silently absent.
    const androidPreviewDiagnostics = analyzeKotlinPreviews(
      androidComponents,
      sources.android,
    );

    // Capture screenshots of component previews
    let androidScreenshotMap = new Map();
    if (!options.noScreenshots && !options.initMapping) {
      try {
        androidScreenshotMap = await captureAndroidScreenshots(
          androidComponents,
          sources.android,
          outputDir,
          { modes: options.variations },
        );
      } catch (err) {
        console.warn(`   ⚠️  Screenshot capture failed: ${err.message}`);
        console.warn("   Continuing without screenshots");
      }
    } else {
      console.log("   Screenshots skipped (--no-screenshots)");
    }

    // Assemble per-component catalogue entries
    const androidEntries = androidComponents.map((comp) => {
      const usages = androidUsageMap.get(comp.name) || [];
      const variants = androidVariantMap.get(comp.name) || [];
      const screenshots = androidScreenshotMap.get(comp.name) || [];

      return {
        name: comp.name,
        platform: "android",
        relativePath: comp.relativePath,
        signature: comp.signature,
        previews: comp.previews,
        previewDiagnostics: androidPreviewDiagnostics.get(comp.name) || [],
        screenshots,
        overloads: comp.overloads || 1,
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

    platformComponents.android = androidEntries.map((e) => ({
      name: e.name,
      relativePath: e.relativePath,
    }));

    // Filter unused if not requested
    const androidFiltered = includeUnused
      ? androidEntries
      : androidEntries.filter((e) => e.usageCount > 0);

    catalogue.platforms.android = {
      projectPath: sources.android,
      componentCount: androidComponents.length,
      usedCount: androidEntries.filter((e) => e.usageCount > 0).length,
      unusedCount: androidEntries.filter((e) => e.usageCount === 0).length,
      components: androidFiltered,
    };

    // Design tokens — colors, type sizes, spacing — across all Kotlin files.
    const androidTokenOccurrences = scanTokens(
      allKotlinFiles,
      sources.android,
      androidTokenSpec(stripKotlinComments),
    );
    catalogue.tokens.android = buildTokenCatalogue(
      androidTokenOccurrences,
      buildAndroidColorResolver(sources.android),
      buildAndroidTypeResolver(sources.android),
    );
    logTokenSummary(catalogue.tokens.android);

    const unusedAndroid = androidEntries
      .filter((e) => e.usageCount === 0)
      .map((e) => e.name);
    if (unusedAndroid.length > 0) {
      console.log(
        `   ${unusedAndroid.length} unused components${includeUnused ? " (included)" : " (excluded — use --include-unused to show)"}`,
      );
    }
  }

  // --- Web / Nunjucks (Phase 4 — placeholder) ---
  if (sources.web) {
    console.log(`\nWeb support is not yet implemented (Phase 4)`);
  }

  // --- Cross-platform alignment (Phase 3) ---

  // --init-mapping: write a starter mapping file and exit before building the
  // report. Screenshot capture is already skipped above when initMapping is set.
  if (options.initMapping) {
    const yamlText = generateMappingYaml(platformComponents);
    fs.mkdirSync(outputDir, { recursive: true });
    const mappingFile = path.join(outputDir, "component-mapping.yaml");
    fs.writeFileSync(mappingFile, yamlText);
    console.log(`\nWrote starter mapping to ${mappingFile}`);
    console.log("Curate it, then re-run with --mapping <path>.");
    return;
  }

  let mapping = null;
  if (options.mappingPath) {
    mapping = loadMapping(options.mappingPath);
    console.log(`\nLoaded component mapping: ${options.mappingPath}`);
  }

  // Alignment is only meaningful across 2+ platforms.
  if (Object.keys(platformComponents).length >= 2) {
    catalogue.alignment = matchComponents(platformComponents, mapping);
    const matched = catalogue.alignment.filter(
      (a) => a.status === "matched",
    ).length;
    console.log(
      `\nCross-platform alignment: ${matched} matched concept${matched !== 1 ? "s" : ""}, ${catalogue.alignment.length - matched} platform-only`,
    );
  }

  // --- Build output ---
  console.log(`\nWriting output to ${outputDir}`);
  buildReport(catalogue, outputDir, formats);
  console.log("\n🎨 Done.");

  // Open the HTML report in the default browser, unless suppressed.
  if (formats.includes("html") && options.open !== false) {
    const reportPath = path.join(outputDir, "index.html");
    openInBrowser(reportPath);
  }
}

/**
 * Open a file in the system default application (a browser, for index.html).
 * Best-effort and non-blocking — failures are reported but don't stop the run.
 */
function openInBrowser(filePath) {
  const opener =
    process.platform === "darwin"
      ? { cmd: "open", args: [filePath] }
      : process.platform === "win32"
        ? { cmd: "cmd", args: ["/c", "start", "", filePath] }
        : { cmd: "xdg-open", args: [filePath] };

  try {
    const child = spawn(opener.cmd, opener.args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", (err) => {
      console.warn(`   Could not open browser: ${err.message}`);
      console.warn(`   Open it manually: ${filePath}`);
    });
    child.unref();
    console.log(`Opening ${filePath}`);
  } catch (err) {
    console.warn(`   Could not open browser: ${err.message}`);
    console.warn(`   Open it manually: ${filePath}`);
  }
}

/** Print a one-line summary of the tokens captured for a platform. */
function logTokenSummary(tokens) {
  console.log(
    `   ${tokens.colors.length} colors, ${tokens.typography.length} type sizes, ${tokens.spacing.length} spacing units`,
  );
}

module.exports = { generate };
