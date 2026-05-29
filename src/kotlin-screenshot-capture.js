const { execSync, spawnSync } = require("child_process");
const { globSync } = require("glob");
const path = require("path");
const fs = require("fs");
const { MODES, screenshotFilename } = require("./variation-modes");

// Sentinel comment so we can detect our own injections
const SENTINEL = "// FRACTIONATOR_INJECTED";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture screenshots of Android component previews by:
 *  1. Scanning component files for @Preview @Composable functions
 *  2. Generating a FractionatorGalleryActivity.kt that imports and calls each one
 *  3. Registering the gallery activity in AndroidManifest.xml
 *  4. Building the app via ./gradlew assembleDebug
 *  5. Installing on the emulator via adb
 *  6. For each preview: launch gallery activity with intent extra → settle → screencap
 *  7. Cleanup (remove gallery file, restore manifest)
 *
 * @param {ComponentDef[]} components - From the Kotlin component scanner
 * @param {string} projectPath - Android prototype root (where gradlew lives)
 * @param {string} outputDir - Where to write screenshots
 * @param {object} [options]
 * @param {number} [options.settleMs=2000] - ms to wait before capture on a warm
 *   (recomposed) relaunch
 * @param {number} [options.coldStartMs=4000] - ms to wait before capture on the
 *   first launch, which is a cold start and shows the app splash screen
 * @param {string[]} [options.modes=["baseline"]] - display-trait modes to
 *   capture each preview under (see variation-modes.js)
 * @returns {Map<string, object[]>} componentName → [{ path, previewName, id }]
 */
async function captureAndroidScreenshots(
  components,
  projectPath,
  outputDir,
  options = {},
) {
  const { settleMs = 2000, coldStartMs = 4000 } = options;
  const modes = options.modes && options.modes.length ? options.modes : ["baseline"];
  const screenshotsDir = path.join(outputDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });

  // 1. Extract preview functions from component files
  const previews = extractAllKotlinPreviews(components, projectPath);
  if (previews.length === 0) {
    console.log("   No capturable @Preview functions found — skipping screenshots");
    return new Map();
  }
  console.log(
    `   Found ${previews.length} capturable preview functions (${previews.length + countPrivatePreviews(components)} total, ${countPrivatePreviews(components)} private/skipped)`,
  );

  // 2. Detect project structure
  const appModule = findAppModule(projectPath);
  const manifestPath = findManifestPath(appModule);
  const manifestOriginal = fs.readFileSync(manifestPath, "utf-8");
  const namespace = detectNamespace(appModule);
  const applicationId = detectApplicationId(appModule);
  const mainSourceDir = findMainSourceDir(appModule, namespace);

  // 3. Generate gallery activity
  const gallerySource = generateGalleryActivity(previews, namespace);
  const galleryPath = path.join(mainSourceDir, "FractionatorGalleryActivity.kt");

  // 4. Find emulator
  const emulator = findEmulator();
  if (!emulator) {
    console.log("   No Android emulator found — skipping screenshots");
    console.log(
      "   Start an emulator with: emulator -avd <name> (or from Android Studio)",
    );
    return new Map();
  }
  console.log(`   Emulator: ${emulator}`);

  const screenshotMap = new Map();
  let captured = 0;

  // Captured before applying any trait overrides, restored in the finally
  // block so the emulator is left as we found it.
  let originalTraits = null;

  try {
    // Write gallery activity
    fs.writeFileSync(galleryPath, gallerySource, "utf-8");
    console.log(
      `   Injected gallery: ${path.relative(projectPath, galleryPath)}`,
    );

    // Inject gallery activity into manifest
    const patchedManifest = injectManifestActivity(manifestOriginal);
    fs.writeFileSync(manifestPath, patchedManifest, "utf-8");
    console.log(
      `   Patched manifest: ${path.relative(projectPath, manifestPath)}`,
    );

    // 5. Build
    console.log("   Building app (./gradlew assembleDebug)...");
    const gradlew = path.join(projectPath, "gradlew");
    const buildResult = spawnSync(gradlew, ["assembleDebug"], {
      cwd: projectPath,
      timeout: 600_000, // 10 min — Gradle can be slow
      encoding: "utf-8",
      env: { ...process.env },
    });

    if (buildResult.status !== 0) {
      const out = [buildResult.stdout, buildResult.stderr]
        .filter(Boolean)
        .join("\n");
      // Extract just the error lines for a cleaner message
      const errorLines = out
        .split("\n")
        .filter((l) => /\bERROR\b|error:/i.test(l))
        .slice(0, 20)
        .join("\n");
      throw new Error(
        `Gradle build failed:\n${errorLines || out.slice(-5000)}`,
      );
    }
    console.log("   Build succeeded");

    // 6. Install
    const apkPath = findBuiltApk(appModule);
    adb(emulator, ["install", "-r", apkPath]);
    console.log(`   APK installed (${applicationId})`);

    // 7. Screenshot loop. Display-trait modes are the outer loop: each mode is
    // applied once as a global override (no rebuild). Changing font scale or
    // night mode triggers a configuration change that recreates the activity
    // and can kill the process, so we force-stop and re-warm once per mode;
    // each preview within a mode is then a warm recomposition. Baseline trait
    // values are snapshotted first so the emulator can be restored afterwards.
    originalTraits = readAndroidTraits(emulator);

    const totalShots = previews.length * modes.length;
    console.log(
      `   Capturing ${previews.length} previews × ${modes.length} mode${modes.length !== 1 ? "s" : ""} = ${totalShots} (cold start ${coldStartMs}ms, then ${settleMs}ms settle)...`,
    );

    const activityComponent = `${applicationId}/${namespace}.FractionatorGalleryActivity`;

    for (const modeId of modes) {
      const mode = MODES[modeId];
      if (modes.length > 1) console.log(`   Mode: ${mode.label}`);
      applyAndroidMode(emulator, mode.android);

      // The trait change recreates the activity, so start from a clean process
      // and warm up on a throwaway id to absorb the cold-start splash on a
      // trivial frame (see warmUp).
      try {
        adb(emulator, ["shell", "am", "force-stop", applicationId]);
      } catch {
        // non-fatal
      }
      await warmUp(emulator, activityComponent, coldStartMs);

      for (const preview of previews) {
        // Some previews (e.g. ones that open a Chrome Custom Tab or external
        // browser) can send the gallery to the background and get the process
        // killed. A subsequent launch would then be a cold start and capture
        // the splash screen. Guard against it: if the process died, re-warm on
        // the throwaway id first so the splash is absorbed off a trivial frame.
        if (!isProcessAlive(emulator, applicationId)) {
          await warmUp(emulator, activityComponent, coldStartMs);
        }

        // Launch gallery activity with preview ID (warm recomposition)
        const launchResult = launchGallery(
          emulator,
          activityComponent,
          preview.id,
        );

        if (launchResult.status !== 0) {
          console.warn(
            `   ⚠️  Launch failed for ${preview.id} [${modeId}]: ${launchResult.stderr}`,
          );
          continue;
        }

        // Wait for the warm recomposition to render, then capture.
        await sleep(settleMs);

        // Capture screenshot via adb
        const filename = screenshotFilename(sanitize(preview.id), modeId);
        const destFile = path.join(screenshotsDir, filename);

        try {
          const pngData = spawnSync(
            "adb",
            ["-s", emulator, "exec-out", "screencap", "-p"],
            { timeout: 10_000, maxBuffer: 20 * 1024 * 1024 },
          );

          if (
            pngData.status === 0 &&
            pngData.stdout &&
            pngData.stdout.length > 0
          ) {
            fs.writeFileSync(destFile, pngData.stdout);
            const existing = screenshotMap.get(preview.componentName) || [];
            existing.push({
              path: `screenshots/${filename}`,
              previewName: preview.previewName,
              id: preview.id,
              mode: modeId,
              modeLabel: mode.label,
            });
            screenshotMap.set(preview.componentName, existing);
            captured++;
          } else {
            console.warn(`   ⚠️  Screenshot failed for ${preview.id} [${modeId}]`);
          }
        } catch (err) {
          console.warn(
            `   ⚠️  Screenshot error for ${preview.id} [${modeId}]: ${err.message}`,
          );
        }
      }
    }

    console.log(`   Captured ${captured} of ${totalShots} screenshots`);

    // 8. Uninstall
    try {
      adb(emulator, ["shell", "am", "force-stop", applicationId]);
    } catch {
      // non-fatal
    }
  } finally {
    // Restore display traits to how we found them.
    if (originalTraits) {
      restoreAndroidTraits(emulator, originalTraits);
    }
    // Restore everything
    if (fs.existsSync(galleryPath)) {
      fs.unlinkSync(galleryPath);
    }
    fs.writeFileSync(manifestPath, manifestOriginal, "utf-8");
    console.log("   Cleaned up injected files");
  }

  return screenshotMap;
}

// ---------------------------------------------------------------------------
// Preview extraction
// ---------------------------------------------------------------------------

/**
 * Scan component files for @Preview @Composable functions.
 * Returns [{ id, componentName, previewName, functionName, packageName }]
 *
 * Processes each file only once (to avoid duplicates when multiple components
 * share a file). Associates each preview function with the best-matching
 * component from the same file based on name similarity.
 *
 * Skips private/internal preview functions (can't be imported by the gallery).
 */
function extractAllKotlinPreviews(components, projectPath) {
  // Group components by file to process each file once
  const fileMap = new Map(); // filePath → [component, ...]
  for (const comp of components) {
    const existing = fileMap.get(comp.filePath) || [];
    existing.push(comp);
    fileMap.set(comp.filePath, existing);
  }

  const previews = [];

  for (const [filePath, fileComponents] of fileMap) {
    const content = fs.readFileSync(filePath, "utf-8");
    const packageName = extractPackageName(content);
    if (!packageName) continue;

    // Extract all preview functions from this file once
    const filePreviews = extractPreviewFunctions(content, packageName);

    // Associate each preview with the best-matching component
    for (const preview of filePreviews) {
      const bestMatch = matchPreviewToComponent(
        preview.functionName,
        fileComponents,
        filePath,
      );
      preview.componentName = bestMatch.name;
      preview.id = `${bestMatch.name}_${sanitize(preview.previewName)}`;
      previews.push(preview);
    }
  }

  return previews;
}

/**
 * Match a preview function to the most likely component in the same file.
 *
 * Strategy:
 * 1. Check if the preview function name contains a component name
 * 2. Check if any component name matches the filename stem
 * 3. Fallback to the first "real" component (skip helper functions/styles)
 */
function matchPreviewToComponent(previewFunctionName, components, filePath) {
  const fnLower = previewFunctionName.toLowerCase();

  // Sort by name length descending so longer (more specific) names match first
  const sorted = [...components].sort(
    (a, b) => b.name.length - a.name.length,
  );

  // 1. Try matching preview function name to a component name
  for (const comp of sorted) {
    if (fnLower.includes(comp.name.toLowerCase())) {
      return comp;
    }
  }

  // 2. Try matching by filename — e.g. NHSPageHeader.kt → NHSPageHeaderScaffold
  if (filePath) {
    const fileStem = path.basename(filePath, ".kt").toLowerCase();
    for (const comp of sorted) {
      if (comp.name.toLowerCase().includes(fileStem)) {
        return comp;
      }
    }
    // Also try the reverse: fileStem contains component name
    for (const comp of sorted) {
      if (fileStem.includes(comp.name.toLowerCase())) {
        return comp;
      }
    }
  }

  // 3. Fallback: first component whose name starts with an uppercase letter
  //    (skip helper functions like getSampleCardData, collapsedTitleAlpha)
  const realComponent = components.find((c) => /^[A-Z]/.test(c.name));
  return realComponent || components[0];
}

/**
 * Count private preview functions across all component files (for reporting).
 * Deduplicates by file path to avoid counting the same file multiple times
 * when it contains multiple components.
 */
function countPrivatePreviews(components) {
  const seen = new Set();
  let count = 0;
  for (const comp of components) {
    if (seen.has(comp.filePath)) continue;
    seen.add(comp.filePath);
    const content = fs.readFileSync(comp.filePath, "utf-8");
    const pattern =
      /@Preview\b(?:\s*\([^)]*\))?\s*@Composable\s+private\s+fun\s+\w+/g;
    while (pattern.exec(content) !== null) count++;
  }
  return count;
}

/**
 * Extract @Preview @Composable function declarations from a single file.
 *
 * Skips private/internal functions (inaccessible from the gallery activity).
 *
 * Returns [{ previewName, functionName, packageName }]
 * (componentName and id are set later by matchPreviewToComponent)
 */
function extractPreviewFunctions(content, packageName) {
  const results = [];

  // Match @Preview followed by @Composable fun (with optional params/modifiers)
  // @Preview can have optional annotation arguments: @Preview(name = "...", ...)
  const pattern =
    /@Preview\b(?:\s*\([^)]*\))?\s*@Composable\s+(?:(private|internal)\s+)?fun\s+(\w+)\s*\(/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const visibility = match[1]; // private, internal, or undefined
    const functionName = match[2];

    // Skip private/internal functions — can't be imported by gallery
    if (visibility === "private" || visibility === "internal") continue;

    // Extract preview name from @Preview annotation
    const annotationText = match[0];
    const nameParam = annotationText.match(/name\s*=\s*"([^"]+)"/);

    let previewName;
    if (nameParam) {
      previewName = nameParam[1];
    } else {
      // Generate a name from the function name
      const stripped = functionName
        .replace(/Preview$/, "")
        .replace(/Dark$/, "");
      const label = stripped
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .trim();
      previewName = label || "Default";
    }

    results.push({
      previewName,
      functionName,
      packageName,
    });
  }

  return results;
}

/**
 * Extract the package declaration from a Kotlin file.
 */
function extractPackageName(content) {
  const match = content.match(/^package\s+([\w.]+)/m);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Gallery generation
// ---------------------------------------------------------------------------

/**
 * Generate FractionatorGalleryActivity.kt — an Activity that imports all
 * public @Preview functions and renders the selected one based on an intent extra.
 */
function generateGalleryActivity(previews, targetPackage) {
  // Collect unique imports
  const imports = new Set();
  for (const p of previews) {
    if (p.packageName !== targetPackage) {
      imports.add(`import ${p.packageName}.${p.functionName}`);
    }
  }

  const importLines = [...imports].sort().join("\n");

  const cases = previews
    .map(
      (p) => `            "${p.id}" -> ${p.functionName}()`,
    )
    .join("\n");

  return `${SENTINEL}
package ${targetPackage}

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
${importLines}

class FractionatorGalleryActivity : ComponentActivity() {
    // Held as snapshot state so warm relaunches (onNewIntent) recompose the
    // gallery without restarting the process — only the first launch is a cold
    // start, so the app splash screen is shown at most once.
    private var previewId by mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        previewId = intent.getStringExtra("fractionator_preview_id") ?: ""
        setContent {
            FractionatorGalleryContent(previewId)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        previewId = intent.getStringExtra("fractionator_preview_id") ?: ""
    }
}

@Composable
private fun FractionatorGalleryContent(previewId: String) {
    when (previewId) {
${cases}
        else -> Text("Unknown preview: $previewId")
    }
}
`;
}

// ---------------------------------------------------------------------------
// Manifest injection
// ---------------------------------------------------------------------------

/**
 * Inject the gallery activity declaration into AndroidManifest.xml.
 * Adds it inside the <application> tag.
 */
function injectManifestActivity(manifestContent) {
  if (manifestContent.includes("FractionatorGalleryActivity")) {
    return manifestContent; // already injected
  }

  const injection = `
        <!-- ${SENTINEL} -->
        <activity
            android:name=".FractionatorGalleryActivity"
            android:launchMode="singleTop"
            android:exported="true" />`;

  // Insert before the closing </application> tag
  const closingTag = "</application>";
  const pos = manifestContent.lastIndexOf(closingTag);
  if (pos === -1) {
    throw new Error(
      "Could not find </application> in AndroidManifest.xml",
    );
  }

  return (
    manifestContent.slice(0, pos) +
    injection +
    "\n    " +
    manifestContent.slice(pos)
  );
}

// ---------------------------------------------------------------------------
// Project structure helpers
// ---------------------------------------------------------------------------

/**
 * Find the app module directory. In most Android projects this is
 * `<projectRoot>/app/`, but some projects use a different name.
 */
function findAppModule(projectPath) {
  // Check for app/ first (most common)
  const appDir = path.join(projectPath, "app");
  if (
    fs.existsSync(path.join(appDir, "build.gradle.kts")) ||
    fs.existsSync(path.join(appDir, "build.gradle"))
  ) {
    return appDir;
  }

  // Search for a module with an AndroidManifest.xml
  const manifests = globSync("*/src/main/AndroidManifest.xml", {
    cwd: projectPath,
    absolute: true,
  });
  if (manifests.length > 0) {
    return path.dirname(path.dirname(path.dirname(manifests[0])));
  }

  throw new Error(
    `Could not find app module in ${projectPath}. Expected app/ directory with build.gradle.kts`,
  );
}

/**
 * Find the AndroidManifest.xml for the app module.
 */
function findManifestPath(appModule) {
  const manifest = path.join(appModule, "src", "main", "AndroidManifest.xml");
  if (fs.existsSync(manifest)) return manifest;
  throw new Error(`AndroidManifest.xml not found at ${manifest}`);
}

/**
 * Detect the namespace from the app module's build.gradle.kts.
 * Falls back to extracting from the manifest or Kotlin source files.
 */
function detectNamespace(appModule) {
  // Try build.gradle.kts first
  for (const gradleFile of ["build.gradle.kts", "build.gradle"]) {
    const gradlePath = path.join(appModule, gradleFile);
    if (!fs.existsSync(gradlePath)) continue;
    const content = fs.readFileSync(gradlePath, "utf-8");
    const match = content.match(/namespace\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  }

  // Fallback: extract from Kotlin source files
  const ktFiles = globSync("src/main/**/*.kt", {
    cwd: appModule,
    absolute: true,
  });
  for (const f of ktFiles.slice(0, 5)) {
    const content = fs.readFileSync(f, "utf-8");
    const match = content.match(/^package\s+([\w.]+)/m);
    if (match) {
      // Use the shortest package prefix (likely the namespace)
      return match[1].split(".").slice(0, -1).join(".") || match[1];
    }
  }

  throw new Error(
    "Could not detect Android namespace. Ensure build.gradle.kts has a namespace declaration.",
  );
}

/**
 * Detect the applicationId from the app module's build.gradle.kts.
 * Falls back to the namespace if not explicitly set.
 */
function detectApplicationId(appModule) {
  for (const gradleFile of ["build.gradle.kts", "build.gradle"]) {
    const gradlePath = path.join(appModule, gradleFile);
    if (!fs.existsSync(gradlePath)) continue;
    const content = fs.readFileSync(gradlePath, "utf-8");
    const match = content.match(/applicationId\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  }

  // Fallback to namespace
  return detectNamespace(appModule);
}

/**
 * Find the main source directory matching the namespace package structure.
 */
function findMainSourceDir(appModule, namespace) {
  const packagePath = namespace.replace(/\./g, path.sep);
  const sourceDir = path.join(appModule, "src", "main", "java", packagePath);
  if (fs.existsSync(sourceDir)) return sourceDir;

  // Try kotlin/ source set
  const kotlinDir = path.join(appModule, "src", "main", "kotlin", packagePath);
  if (fs.existsSync(kotlinDir)) return kotlinDir;

  throw new Error(
    `Could not find source directory for package ${namespace} in ${appModule}`,
  );
}

// ---------------------------------------------------------------------------
// Build / ADB helpers
// ---------------------------------------------------------------------------

/**
 * Find a running Android emulator via adb.
 * Returns the device serial (e.g. "emulator-5554") or null.
 */
function findEmulator() {
  try {
    const output = execSync("adb devices", {
      encoding: "utf-8",
      timeout: 10_000,
    });
    const lines = output.split("\n").filter((l) => l.includes("\tdevice"));
    // Prefer emulator over physical device
    const emulator = lines.find((l) => l.startsWith("emulator-"));
    if (emulator) return emulator.split("\t")[0];
    // Fall back to first connected device
    if (lines.length > 0) return lines[0].split("\t")[0];
    return null;
  } catch {
    return null;
  }
}

// Throwaway preview id — hits the gallery's "unknown preview" branch, which
// renders trivial Text so the cold-start splash clears quickly.
const WARMUP_ID = "__fractionator_warmup__";

/**
 * Launch the gallery activity for a given preview id (does not wait/settle).
 */
function launchGallery(device, activityComponent, previewId) {
  return spawnSync(
    "adb",
    [
      "-s",
      device,
      "shell",
      "am",
      "start",
      "-n",
      activityComponent,
      "--es",
      "fractionator_preview_id",
      previewId,
    ],
    { encoding: "utf-8", timeout: 15_000 },
  );
}

/**
 * Launch the gallery on the throwaway warm-up id and wait out the cold start,
 * so the splash screen is absorbed on a trivial frame rather than a real
 * component capture.
 */
async function warmUp(device, activityComponent, coldStartMs) {
  launchGallery(device, activityComponent, WARMUP_ID);
  await sleep(coldStartMs);
}

/**
 * Whether the app process is currently running on the device.
 */
function isProcessAlive(device, applicationId) {
  const result = spawnSync(
    "adb",
    ["-s", device, "shell", "pidof", applicationId],
    { encoding: "utf-8", timeout: 10_000 },
  );
  return result.status === 0 && result.stdout.trim().length > 0;
}

/**
 * Run an adb command targeting a specific device.
 */
function adb(device, args) {
  const result = spawnSync("adb", ["-s", device, ...args], {
    encoding: "utf-8",
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`adb ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Find the built debug APK in the app module's build output.
 */
function findBuiltApk(appModule) {
  const apkDir = path.join(appModule, "build", "outputs", "apk", "debug");
  const apks = globSync("*.apk", { cwd: apkDir, absolute: true });
  if (apks.length > 0) return apks[0];

  // Try intermediates
  const allApks = globSync("build/outputs/**/*.apk", {
    cwd: appModule,
    absolute: true,
  });
  if (allApks.length > 0) return allApks[0];

  throw new Error(
    `No APK found in ${apkDir}. Check that the build succeeded.`,
  );
}

// ---------------------------------------------------------------------------
// Display-trait control
// ---------------------------------------------------------------------------

/**
 * Read the emulator's current night mode / font scale / high-contrast-text
 * settings so they can be restored after capture. A missing setting reads back
 * as "null" (preserved verbatim so restore can `delete` it rather than guess a
 * default — the baseline isn't necessarily the device default).
 */
function readAndroidTraits(device) {
  const nightOut = adbTry(device, ["shell", "cmd", "uimode", "night"]);
  const nightMatch = (nightOut || "").match(/night\s*(?:mode)?\s*:?\s*(\w+)/i);
  return {
    night: nightMatch ? nightMatch[1].toLowerCase() : "no",
    font_scale: (
      adbTry(device, ["shell", "settings", "get", "system", "font_scale"]) || ""
    ).trim(),
    high_text_contrast: (
      adbTry(device, [
        "shell",
        "settings",
        "get",
        "secure",
        "high_text_contrast_enabled",
      ]) || ""
    ).trim(),
  };
}

/**
 * Apply a set of display traits via adb (night mode, font scale, high-contrast
 * text). Tolerant of individual settings failing — warns and continues.
 */
function applyAndroidMode(device, traits) {
  adbTry(device, ["shell", "cmd", "uimode", "night", traits.night]);
  adbTry(device, [
    "shell",
    "settings",
    "put",
    "system",
    "font_scale",
    traits.font_scale,
  ]);
  adbTry(device, [
    "shell",
    "settings",
    "put",
    "secure",
    "high_text_contrast_enabled",
    traits.high_text_contrast,
  ]);
}

/**
 * Restore traits captured by readAndroidTraits. Settings that were unset
 * ("null") are deleted rather than written, so the emulator returns to its
 * original state instead of an assumed default.
 */
function restoreAndroidTraits(device, original) {
  adbTry(device, ["shell", "cmd", "uimode", "night", original.night || "no"]);
  restoreSetting(device, "system", "font_scale", original.font_scale);
  restoreSetting(
    device,
    "secure",
    "high_text_contrast_enabled",
    original.high_text_contrast,
  );
}

/**
 * Put a setting back to its captured value, or delete it if it was unset.
 */
function restoreSetting(device, namespace, key, value) {
  if (!value || value === "null") {
    adbTry(device, ["shell", "settings", "delete", namespace, key]);
  } else {
    adbTry(device, ["shell", "settings", "put", namespace, key, value]);
  }
}

/**
 * Run an adb command, returning stdout on success or null on failure (warning
 * rather than throwing). Used for best-effort trait reads/writes.
 */
function adbTry(device, args) {
  const result = spawnSync("adb", ["-s", device, ...args], {
    encoding: "utf-8",
    timeout: 15_000,
  });
  if (result.status !== 0) {
    console.warn(
      `   ⚠️  adb ${args.join(" ")} failed: ${(result.stderr || "").trim()}`,
    );
    return null;
  }
  return result.stdout;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 200);
}

module.exports = { captureAndroidScreenshots };
