const { execSync, spawnSync, spawn } = require("child_process");
const { globSync } = require("glob");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { MODES, screenshotFilename } = require("./variation-modes");
const { stripKotlinComments } = require("./kotlin-component-scanner");

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
 * @returns {Map<string, object>} previewId → { id, functionName, previewName,
 *   sourceFile, renders, fallbackComponent, screenshots: [{ path, mode, ... }] }.
 *   Attribution to components/showcases is done downstream from `renders`.
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

  // Ensure ANDROID_HOME is set so Gradle can find the SDK, falling back to the
  // standard per-OS install location when the env var is unset.
  ensureAndroidHome();

  // 1. Extract preview functions from component files
  const previews = extractAllKotlinPreviews(components, projectPath);
  if (previews.length === 0) {
    console.log("   No capturable @Preview functions found — skipping screenshots");
    return new Map();
  }
  const skippedCount = countSkippedKotlinPreviews(components);
  console.log(
    `   Found ${previews.length} capturable preview functions (${previews.length + skippedCount} total, ${skippedCount} private/parameterized/skipped)`,
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

  // 4. Find or boot emulator
  const emulator = await findOrStartEmulator();
  if (!emulator) {
    console.log("   No Android emulator found and no AVDs available — skipping screenshots");
    console.log("   Create an AVD in Android Studio, then re-run");
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
        .filter((l) => /\bERROR\b|error:|^e: /i.test(l))
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

    // Component-only capture pulls the gallery's rendered PNGs from the app's
    // private files via `run-as`, which works for debuggable (debug) builds.
    // Probe once; if it's unavailable, fall back to full-screen captures.
    const componentCapture = canRunAs(emulator, applicationId);
    console.log(
      componentCapture
        ? "   Component-only capture enabled"
        : "   run-as unavailable — using full-screen captures",
    );

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

        const filename = screenshotFilename(sanitize(preview.id), modeId);
        const destFile = path.join(screenshotsDir, filename);

        // Clear any stale rendered files so their presence reflects this launch.
        if (componentCapture) {
          clearRendered(emulator, applicationId, preview.id);
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

        // Prefer the gallery's component-only render (pulled via run-as); fall
        // back to a full-screen screencap when there's no rendered image.
        let cropped = false;
        if (componentCapture) {
          const done = await waitForMarker(
            emulator,
            applicationId,
            preview.id,
            settleMs + 6000,
            250,
          );
          if (done && pullRendered(emulator, applicationId, preview.id, destFile)) {
            cropped = true;
          } else if (!done) {
            await sleep(settleMs);
          }
        } else {
          // Wait for the warm recomposition to render, then capture.
          await sleep(settleMs);
        }

        if (!cropped) {
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
            } else {
              console.warn(`   ⚠️  Screenshot failed for ${preview.id} [${modeId}]`);
              continue;
            }
          } catch (err) {
            console.warn(
              `   ⚠️  Screenshot error for ${preview.id} [${modeId}]: ${err.message}`,
            );
            continue;
          }
        }

        // Record by preview id. Attribution to components/showcases happens
        // downstream from the preview's `renders` set, so the same capture can
        // belong to several components (a showcase) without being duplicated.
        let rec = screenshotMap.get(preview.id);
        if (!rec) {
          rec = {
            id: preview.id,
            functionName: preview.functionName,
            previewName: preview.previewName,
            sourceFile: preview.sourceFile,
            renders: preview.renders || [],
            fallbackComponent: preview.fallbackComponent || null,
            screenshots: [],
          };
          screenshotMap.set(preview.id, rec);
        }
        rec.screenshots.push({
          path: `screenshots/${filename}`,
          previewName: preview.previewName,
          id: preview.id,
          mode: modeId,
          modeLabel: mode.label,
          cropped,
        });
        captured++;
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
 * Scan component files for capturable @Preview @Composable functions.
 * Returns [{ id, functionName, previewName, packageName, renders,
 * fallbackComponent, sourceFile }] — one entry per capturable preview.
 *
 * Processes each file once. `renders` is the set of known component names the
 * preview body calls (its real subjects); `fallbackComponent` is the legacy
 * name/file best-match, used only when a preview renders no known component.
 * Skips private and parameterised preview functions (see classifyKotlinPreviewSkip).
 */
function extractAllKotlinPreviews(components, projectPath) {
  // The full set of known component names — a preview can render components
  // imported from other files, so attribution is global, not per-file.
  const componentNames = new Set(components.map((c) => c.name));

  // Group components by file to process each file once
  const fileMap = new Map(); // filePath → [component, ...]
  for (const comp of components) {
    const existing = fileMap.get(comp.filePath) || [];
    existing.push(comp);
    fileMap.set(comp.filePath, existing);
  }

  const previews = [];
  const seenIds = new Set();

  for (const [filePath, fileComponents] of fileMap) {
    const content = fs.readFileSync(filePath, "utf-8");
    const packageName = extractPackageName(content);
    if (!packageName) continue;

    const relativePath = path.relative(projectPath, filePath);
    const records = extractPreviewFunctionRecords(
      content,
      packageName,
      componentNames,
    ).filter((r) => !r.skip);

    for (const preview of records) {
      // Preview-centric, component-independent id (the gallery imports and calls
      // the function by name). Deduped so two same-named functions don't collide.
      let id = sanitize(preview.functionName);
      if (seenIds.has(id)) {
        let n = 2;
        while (seenIds.has(`${id}_${n}`)) n++;
        id = `${id}_${n}`;
      }
      seenIds.add(id);

      // Fallback owner for previews whose body renders no known component
      // (e.g. a whole-screen preview) — keeps today's name/file heuristic.
      const fallback = matchPreviewToComponent(
        preview.functionName,
        fileComponents,
        filePath,
      );

      previews.push({
        id,
        functionName: preview.functionName,
        previewName: preview.previewName,
        packageName: preview.packageName,
        renders: preview.renders,
        fallbackComponent: fallback ? fallback.name : null,
        sourceFile: relativePath,
      });
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
 * Count preview functions we skip across all component files (for reporting).
 * Deduplicates by file path to avoid counting the same file multiple times
 * when it contains multiple components.
 */
function countSkippedKotlinPreviews(components) {
  const seen = new Set();
  let count = 0;
  for (const comp of components) {
    if (seen.has(comp.filePath)) continue;
    seen.add(comp.filePath);
    let content;
    try {
      content = fs.readFileSync(comp.filePath, "utf-8");
    } catch {
      continue;
    }
    const pkg = extractPackageName(content) || "";
    for (const rec of extractPreviewFunctionRecords(content, pkg)) {
      if (rec.skip) count++;
    }
  }
  return count;
}

/**
 * Extract every @Preview @Composable function in a file, with a skip
 * classification. Returns
 * [{ previewName, functionName, packageName, skip, renders }] where `skip` is
 * null for capturable previews or a short reason otherwise, and `renders` is the
 * set of known component names the preview body calls (empty unless
 * `componentNames` is supplied).
 */
function extractPreviewFunctionRecords(content, packageName, componentNames = null) {
  const results = [];

  // @Preview, then any number of further annotations (e.g. multipreview helpers),
  // then @Composable fun NAME(. @Preview may carry args: @Preview(name = "...").
  const pattern =
    /@Preview\b(?:\s*\([^)]*\))?\s*(?:@\w+(?:\s*\([^)]*\))?\s*)*@Composable\s+(?:(private|internal)\s+)?fun\s+(\w+)\s*\(/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const visibility = match[1]; // private, internal, or undefined
    const functionName = match[2];
    // The match ends on the opening '(' of the parameter list.
    const openParen = pattern.lastIndex - 1;
    const closeParen = matchDelimiter(content, openParen, "(", ")");
    const params =
      closeParen > openParen ? content.slice(openParen + 1, closeParen) : "";
    const previewName = derivePreviewName(match[0], functionName);
    const skip = classifyKotlinPreviewSkip(visibility, params);

    let renders = [];
    if (componentNames && componentNames.size) {
      const body = extractFunctionBody(content, closeParen);
      renders = detectRenderedComponents(body, componentNames, functionName);
    }

    results.push({ previewName, functionName, packageName, skip, renders });
  }

  return results;
}

/**
 * The set of known component names a preview body renders — i.e. the component
 * names it calls (`Name(`). This is the evidence used to attribute a preview to
 * one component or recognise it as a multi-component showcase. Comments and
 * strings are stripped first so a name in a comment/string doesn't false-match.
 */
function detectRenderedComponents(body, componentNames, selfName) {
  if (!body) return [];
  const stripped = stripKotlinComments(body);
  const found = [];
  for (const name of componentNames) {
    if (name === selfName) continue;
    // Composable components are PascalCase; skip lowercase helper functions the
    // scanner may have picked up (e.g. getSampleCardData).
    if (!/^[A-Z]/.test(name)) continue;
    if (new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(stripped)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * Inner text of the `{ ... }` body that follows a function's parameter list.
 * `closeParenIndex` is the index of the parameter list's closing ')'. Returns ""
 * when no body brace is found.
 */
function extractFunctionBody(content, closeParenIndex) {
  if (closeParenIndex < 0) return "";
  const braceOpen = content.indexOf("{", closeParenIndex);
  if (braceOpen === -1) return "";
  const braceClose = matchDelimiter(content, braceOpen, "{", "}");
  return braceClose === -1
    ? content.slice(braceOpen + 1)
    : content.slice(braceOpen + 1, braceClose);
}

/**
 * Index of the delimiter matching the one at `openIndex` (e.g. the ')' closing an
 * '('), honouring nesting and ignoring delimiters inside string literals. Returns
 * -1 if unbalanced.
 */
function matchDelimiter(content, openIndex, open, close) {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === stringChar && content[i - 1] !== "\\") inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Capturable @Preview functions from a file (skip === null).
 * Returns [{ previewName, functionName, packageName }].
 */
function extractPreviewFunctions(content, packageName) {
  return extractPreviewFunctionRecords(content, packageName).filter(
    (r) => !r.skip,
  );
}

/**
 * Decide whether a @Preview function can be called from the generated gallery.
 * Returns null when it can, or a short reason when it can't.
 */
function classifyKotlinPreviewSkip(visibility, params) {
  // A private top-level fun is file-scoped, so the gallery (a different file)
  // can't call it. `internal` is module-visible and the gallery lives in the
  // same module, so those are fine to call — don't skip them.
  if (visibility === "private") {
    return "private preview (not visible to the generated gallery)";
  }
  // The gallery invokes each preview as `fn()`. A parameter without a default —
  // including @PreviewParameter providers — makes that call fail to compile,
  // which would take the whole gallery build (and every screenshot) down. Skip
  // it rather than emit an uncompilable call.
  if (params && requiresArguments(params)) {
    return "parameterized preview (requires arguments the gallery can't supply)";
  }
  return null;
}

/** Derive a human-readable preview name from the annotation or function name. */
function derivePreviewName(annotationText, functionName) {
  const nameParam = annotationText.match(/name\s*=\s*"([^"]+)"/);
  if (nameParam) return nameParam[1];
  const stripped = functionName.replace(/Preview$/, "").replace(/Dark$/, "");
  const label = stripped
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
  return label || "Default";
}

/**
 * Static analysis of every component's @Preview functions — which exist and, for
 * those we can't capture, why. Needs no emulator, so the report can explain a
 * missing preview even when capture is skipped or fails.
 *
 * @returns {Map<string, {previewName: string, skip: string|null}[]>}
 *   componentName → one entry per @Preview found, associated to its component the
 *   same way the capture path associates them.
 */
function analyzeKotlinPreviews(components, projectPath) {
  const fileMap = new Map(); // filePath → [component, ...]
  for (const comp of components) {
    const existing = fileMap.get(comp.filePath) || [];
    existing.push(comp);
    fileMap.set(comp.filePath, existing);
  }

  const map = new Map();
  for (const [filePath, fileComponents] of fileMap) {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const packageName = extractPackageName(content) || "";
    for (const rec of extractPreviewFunctionRecords(content, packageName)) {
      const best = matchPreviewToComponent(
        rec.functionName,
        fileComponents,
        filePath,
      );
      const list = map.get(best.name) || [];
      list.push({ previewName: rec.previewName, skip: rec.skip });
      map.set(best.name, list);
    }
  }
  return map;
}

/**
 * Whether a Kotlin parameter list has any parameter the gallery can't satisfy by
 * calling `fn()` — i.e. a parameter with no default value. @PreviewParameter
 * providers count as required (they have no default), so they're caught here too.
 */
function requiresArguments(paramStr) {
  return splitTopLevel(paramStr).some(
    (p) => p.trim().length > 0 && !paramHasDefault(p),
  );
}

/** Split a parameter list on top-level commas (ignoring nesting and strings). */
function splitTopLevel(str) {
  const out = [];
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let cur = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      cur += ch;
      if (ch === stringChar && str[i - 1] !== "\\") inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ">" && str[i - 1] !== "-") depth--; // '>' but not the '->' arrow
    if (ch === "," && depth <= 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Whether a single parameter declaration carries a default value (`= ...`). */
function paramHasDefault(param) {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  for (let i = 0; i < param.length; i++) {
    const ch = param[i];
    if (inString) {
      if (ch === stringChar && param[i - 1] !== "\\") inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ">" && param[i - 1] !== "-") depth--;
    else if (ch === "=" && depth <= 0) {
      const prev = param[i - 1];
      const next = param[i + 1];
      // A default assignment '=', not a comparison (==, !=, <=, >=).
      if (
        prev !== "=" &&
        prev !== "!" &&
        prev !== "<" &&
        prev !== ">" &&
        next !== "="
      ) {
        return true;
      }
    }
  }
  return false;
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
 * Generate FractionatorGalleryActivity.kt — an Activity that imports all public
 * @Preview functions and renders the selected one based on an intent extra.
 *
 * The selected preview is both displayed (so the full-screen capture fallback
 * still works) and recorded to a `GraphicsLayer`, which is converted to a
 * component-sized PNG via `toImageBitmap()` — the Compose analog of iOS's
 * `ImageRenderer`. The capture happens on an inner Box that wraps the component:
 * the root `Box(fillMaxSize)` passes loose constraints down, so the inner Box
 * sizes to the component's content (a button crops tight; a `fillMaxWidth`
 * component gets screen width with content height; a full-screen layout gets the
 * window, but without the system bars). The PNG and a completion marker are
 * written to the app's internal `files/` dir, where the capture loop collects
 * them via `run-as`.
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
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import kotlinx.coroutines.delay
import java.io.File
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
            FractionatorGallery(previewId) { id, bitmap -> saveResult(id, bitmap) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        previewId = intent.getStringExtra("fractionator_preview_id") ?: ""
    }

    // Write the component PNG (when one was produced) plus a marker that always
    // signals completion, so the capture loop can fall back immediately rather
    // than waiting out a timeout.
    private fun saveResult(id: String, bitmap: Bitmap?) {
        try {
            if (bitmap != null) {
                File(filesDir, "\$id.png").outputStream().use { out ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                }
            }
        } catch (_: Throwable) {
        }
        try {
            File(filesDir, "\$id.rendered").writeBytes(ByteArray(0))
        } catch (_: Throwable) {
        }
    }
}

@Composable
private fun FractionatorGallery(
    previewId: String,
    onResult: (String, Bitmap?) -> Unit,
) {
    val graphicsLayer = rememberGraphicsLayer()
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.drawWithContent {
                graphicsLayer.record { this@drawWithContent.drawContent() }
                drawLayer(graphicsLayer)
            }
        ) {
            FractionatorGalleryContent(previewId)
        }
    }

    LaunchedEffect(previewId) {
        // Skip the warm-up / empty ids — nothing to capture.
        if (previewId.isEmpty() || previewId.startsWith("__fractionator")) {
            return@LaunchedEffect
        }
        // Let the recomposition settle before recording the layer.
        delay(500)
        val bitmap = try {
            graphicsLayer.toImageBitmap().asAndroidBitmap()
        } catch (e: Throwable) {
            Log.e("Fractionator", "capture failed for \$previewId", e)
            null
        }
        // Drop a blank/uniform capture — a GraphicsLayer can't record some content
        // (WebView, AndroidView, async images), yielding an empty bitmap. Passing
        // null writes no PNG, so the capture loop falls back to a full-screen
        // screencap of the displayed preview instead of saving a white box.
        val result = if (bitmap != null && !isBlankBitmap(bitmap)) bitmap else null
        onResult(previewId, result)
    }
}

@Composable
private fun FractionatorGalleryContent(previewId: String) {
    when (previewId) {
${cases}
        else -> Text("Unknown preview: $previewId")
    }
}

// True when the bitmap carries essentially no visible content — every sampled
// pixel the same colour (a blank or fully-transparent canvas). The content is
// drawn into a small software bitmap and checked for any colour/alpha variance,
// so real content stays well clear of the threshold while a uniform canvas is
// caught. Wrapped so it can never crash the capture: toImageBitmap() yields a
// Config.HARDWARE bitmap (getPixels() is illegal on those), so we draw it through
// a Canvas into an ARGB_8888 sample we can read; any failure just keeps the image.
private fun isBlankBitmap(source: Bitmap): Boolean {
    return try {
        val w = minOf(source.width, 32).coerceAtLeast(1)
        val h = minOf(source.height, 32).coerceAtLeast(1)
        val sample = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(sample).drawBitmap(
            source,
            Rect(0, 0, source.width, source.height),
            Rect(0, 0, w, h),
            null,
        )
        val pixels = IntArray(w * h)
        sample.getPixels(pixels, 0, w, 0, 0, w, h)
        val first = pixels[0]
        val fa = (first ushr 24) and 0xFF
        val fr = (first ushr 16) and 0xFF
        val fg = (first ushr 8) and 0xFF
        val fb = first and 0xFF
        var blank = true
        for (p in pixels) {
            if (kotlin.math.abs(((p ushr 24) and 0xFF) - fa) > 8 ||
                kotlin.math.abs(((p ushr 16) and 0xFF) - fr) > 8 ||
                kotlin.math.abs(((p ushr 8) and 0xFF) - fg) > 8 ||
                kotlin.math.abs((p and 0xFF) - fb) > 8
            ) {
                blank = false
                break
            }
        }
        blank
    } catch (_: Throwable) {
        // Never let the blank check crash the capture; keep the rendered image.
        false
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
 * Ensure process.env.ANDROID_HOME points at an SDK so Gradle (and adb) can find
 * it without the user exporting the variable first.
 *
 * Honours an already-set ANDROID_HOME / ANDROID_SDK_ROOT when it exists on
 * disk; otherwise falls back to the standard per-OS install location. Returns
 * the resolved path, or null if nothing was found (the Gradle build will then
 * surface its own SDK-not-found error).
 */
function ensureAndroidHome() {
  const existing = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (existing && fs.existsSync(existing)) {
    if (!process.env.ANDROID_HOME) process.env.ANDROID_HOME = existing;
    return process.env.ANDROID_HOME;
  }

  const home = os.homedir();
  let candidate;
  if (process.platform === "darwin") {
    candidate = path.join(home, "Library", "Android", "sdk");
  } else if (process.platform === "win32") {
    candidate = path.join(
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "Android",
      "Sdk",
    );
  } else {
    candidate = path.join(home, "Android", "Sdk");
  }

  if (fs.existsSync(candidate)) {
    process.env.ANDROID_HOME = candidate;
    console.log(`   Using detected Android SDK: ${candidate}`);
    return candidate;
  }

  return null;
}

/**
 * Find a running emulator, or boot the first available AVD if none is running.
 * Returns the device serial or null if nothing is available.
 */
async function findOrStartEmulator() {
  const running = findEmulator();
  if (running) return running;

  const androidHome = process.env.ANDROID_HOME;
  if (!androidHome) return null;

  const emulatorBin = path.join(androidHome, "emulator", "emulator");
  if (!fs.existsSync(emulatorBin)) return null;

  let avds;
  try {
    const out = execSync(`"${emulatorBin}" -list-avds`, {
      encoding: "utf-8",
      timeout: 10_000,
    });
    avds = out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }

  if (avds.length === 0) return null;

  const avd = avds[0];
  console.log(`   No running emulator — booting AVD: ${avd}`);

  spawn(
    emulatorBin,
    ["-avd", avd, "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot-save"],
    { detached: true, stdio: "ignore" },
  ).unref();

  // Poll for the emulator to appear and fully boot (up to 2 min)
  const deadline = Date.now() + 120_000;
  let serial = null;
  while (Date.now() < deadline) {
    await sleep(3_000);
    serial = findEmulator();
    if (!serial) continue;
    try {
      const booted = execSync(`adb -s ${serial} shell getprop sys.boot_completed`, {
        encoding: "utf-8",
        timeout: 5_000,
      }).trim();
      if (booted === "1") {
        console.log(`   Emulator ready (${serial})`);
        return serial;
      }
    } catch {
      // still booting
    }
  }

  return null;
}

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
 * Whether `run-as <appId>` works on this device — true for debuggable (debug)
 * builds, which lets us read the gallery's rendered PNGs from the app's private
 * `files/` directory. Probed once; gates component-only capture.
 */
function canRunAs(device, appId) {
  const res = spawnSync(
    "adb",
    ["-s", device, "exec-out", "run-as", appId, "ls"],
    { encoding: "utf-8", timeout: 10_000 },
  );
  // `adb exec-out` doesn't propagate the remote exit code, so don't trust
  // res.status: a working run-as lists the app home dir (non-empty stdout); a
  // broken one ("unknown package") writes to stderr, leaving stdout empty.
  return !!res.stdout && res.stdout.trim().length > 0;
}

/** Delete a preview's stale rendered PNG and completion marker. */
function clearRendered(device, appId, id) {
  spawnSync(
    "adb",
    [
      "-s",
      device,
      "exec-out",
      "run-as",
      appId,
      "rm",
      "-f",
      `files/${id}.png`,
      `files/${id}.rendered`,
    ],
    { encoding: "utf-8", timeout: 10_000 },
  );
}

/** Whether the gallery's completion marker for a preview exists yet. */
function markerExists(device, appId, id) {
  // List the whole files/ dir and look for an exact entry. `ls <missing-file>`
  // can't be used: through `adb exec-out` it exits 0 and prints its "No such
  // file" error (which contains the filename) to stdout, so any per-file check
  // false-matches. A directory listing has no such error text.
  const res = spawnSync(
    "adb",
    ["-s", device, "exec-out", "run-as", appId, "ls", "files"],
    { encoding: "utf-8", timeout: 10_000 },
  );
  if (!res.stdout) return false;
  return res.stdout.split(/\s+/).includes(`${id}.rendered`);
}

/** Poll for the completion marker up to a timeout. */
async function waitForMarker(device, appId, id, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (markerExists(device, appId, id)) return true;
    await sleep(intervalMs);
  }
  return markerExists(device, appId, id);
}

/**
 * Copy the gallery's rendered component PNG out of the app's private files via
 * `run-as` (binary-clean through `exec-out`). Returns true if one was written.
 */
function pullRendered(device, appId, id, destFile) {
  const res = spawnSync(
    "adb",
    ["-s", device, "exec-out", "run-as", appId, "cat", `files/${id}.png`],
    { timeout: 15_000, maxBuffer: 64 * 1024 * 1024 },
  );
  // Validate the PNG signature — `cat` of a missing file (or any error) prints
  // text to stdout that adb doesn't distinguish from a real payload, so a
  // length check alone would write garbage and report success.
  const out = res.stdout;
  if (res.status === 0 && out && out.length > 8 && isPng(out)) {
    fs.writeFileSync(destFile, out);
    return true;
  }
  return false;
}

/** Whether a Buffer starts with the 8-byte PNG signature. */
function isPng(buf) {
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
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

module.exports = {
  captureAndroidScreenshots,
  analyzeKotlinPreviews,
  // Exported for unit tests.
  extractPreviewFunctionRecords,
  detectRenderedComponents,
};
