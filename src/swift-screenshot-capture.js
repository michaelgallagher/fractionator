const { execSync, spawnSync } = require("child_process");
const { globSync } = require("glob");
const path = require("path");
const fs = require("fs");
const {
  extractBraceBlock,
  stripSwiftComments,
} = require("./swift-component-scanner");
const { MODES, screenshotFilename } = require("./variation-modes");

// Sentinel comment so we can detect our own injections
const SENTINEL = "// FRACTIONATOR_INJECTED";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture screenshots of component previews by:
 *  1. Extracting #Preview bodies from component source files
 *  2. Generating a FractionatorGallery.swift with all previews as cases
 *  3. Injecting a launch-arg handler into the app entry point
 *  4. Building the app (app target only — no test target)
 *  5. For each preview: terminate → launch with arg → settle → screenshot
 *  6. Cleanup (restore all injected files, uninstall app)
 *
 * @param {ComponentDef[]} components - From the component scanner
 * @param {string} projectPath - iOS prototype root
 * @param {string} outputDir - Where to write screenshots
 * @param {object} [options]
 * @param {number} [options.settleMs=1500] - ms to wait after launch
 * @param {string[]} [options.modes=["baseline"]] - display-trait modes to
 *   capture each preview under (see variation-modes.js)
 * @returns {Map<string, object>} previewId → { id, previewName, sourceFile,
 *   renders, fallbackComponent, screenshots: [{ path, mode, ... }] }. Attribution
 *   to components/showcases is done downstream from `renders`.
 */
async function captureComponentScreenshots(
  components,
  projectPath,
  outputDir,
  options = {},
) {
  const { settleMs = 1500 } = options;
  const modes = options.modes && options.modes.length ? options.modes : ["baseline"];
  const screenshotsDir = path.join(outputDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });

  // Stable DerivedData path per project
  const projectSlug = path
    .basename(projectPath)
    .replace(/[^a-zA-Z0-9_-]/g, "-");
  const derivedDataPath = `/tmp/fractionator-derived-data-${projectSlug}`;

  // 1. Extract preview bodies from component files
  const previews = extractAllPreviews(components, projectPath);
  if (previews.length === 0) {
    console.log("   No #Preview blocks found — skipping screenshots");
    return new Map();
  }
  console.log(`   Found ${previews.length} preview blocks`);

  // 2. Generate gallery source file
  const gallerySource = generateGallerySource(previews);
  const galleryDir = findSourceDir(projectPath);
  const galleryPath = path.join(galleryDir, "FractionatorGallery.swift");

  // 3. Find and patch the app entry point
  const appEntryPath = findAppEntryPoint(projectPath);
  const appEntryOriginal = fs.readFileSync(appEntryPath, "utf-8");

  const screenshotMap = new Map();
  let captured = 0;

  // Captured before applying any trait overrides, restored in the finally
  // block so the simulator is left as we found it.
  let simulatorUdid = null;
  let originalTraits = null;

  try {
    // Write gallery file
    fs.writeFileSync(galleryPath, gallerySource, "utf-8");
    console.log(
      `   Injected gallery: ${path.relative(projectPath, galleryPath)}`,
    );

    // Inject launch-arg handler into app entry point
    const patchedEntry = injectAppEntryHandler(appEntryOriginal);
    fs.writeFileSync(appEntryPath, patchedEntry, "utf-8");
    console.log(
      `   Patched app entry: ${path.relative(projectPath, appEntryPath)}`,
    );

    // 4. Build
    const xcodeProject = findXcodeProject(projectPath);
    const isWorkspace = xcodeProject.endsWith(".xcworkspace");
    const projectFlag = isWorkspace ? "-workspace" : "-project";
    const scheme = getScheme(xcodeProject, projectFlag);

    const simulator = findOrBootSimulator();
    simulatorUdid = simulator.udid;
    console.log(`   Simulator: ${simulator.name} (${simulator.udid})`);

    console.log("   Building app...");
    const buildResult = spawnSync(
      "xcodebuild",
      [
        "build",
        projectFlag,
        xcodeProject,
        "-scheme",
        scheme,
        "-destination",
        `platform=iOS Simulator,id=${simulator.udid}`,
        "-derivedDataPath",
        derivedDataPath,
        "-quiet",
      ],
      {
        cwd: projectPath,
        timeout: 300_000,
        encoding: "utf-8",
        env: { ...process.env, DEVELOPER_DIR: findDeveloperDir() },
      },
    );

    if (buildResult.status !== 0) {
      const out = [buildResult.stdout, buildResult.stderr]
        .filter(Boolean)
        .join("\n");
      // Extract just the error lines for a cleaner message
      const errorLines = out
        .split("\n")
        .filter((l) => /\berror:/.test(l))
        .join("\n");
      throw new Error(
        `xcodebuild build failed:\n${errorLines || out.slice(-5000)}`,
      );
    }

    // 5. Install
    const appPath = findBuiltApp(derivedDataPath);
    const bundleId = extractBundleId(appPath);
    run("xcrun", ["simctl", "install", simulator.udid, appPath]);
    console.log(`   App installed (${bundleId})`);

    // Disable animations for cleaner screenshots
    run("xcrun", [
      "simctl",
      "spawn",
      simulator.udid,
      "defaults",
      "write",
      bundleId,
      "UIAnimationDragCoefficient",
      "-float",
      "0",
    ]);

    // Locate the app's data container so we can collect the component-sized PNGs
    // the gallery writes to Documents. If this fails we fall back to full-screen
    // captures for every preview.
    let dataContainer = null;
    try {
      dataContainer = run("xcrun", [
        "simctl",
        "get_app_container",
        simulator.udid,
        bundleId,
        "data",
      ]).trim();
    } catch (err) {
      console.warn(
        `   ⚠️  Could not locate app data container (${err.message}); using full-screen captures`,
      );
    }

    // 6. Screenshot loop. Display-trait modes are the outer loop: each mode is
    // applied once as a global override (no rebuild), then every preview is
    // captured under it. Baseline trait values are snapshotted first so the
    // simulator can be restored afterwards.
    originalTraits = readIosTraits(simulator.udid);

    const totalShots = previews.length * modes.length;
    console.log(
      `   Capturing ${previews.length} previews × ${modes.length} mode${modes.length !== 1 ? "s" : ""} = ${totalShots} (${settleMs}ms settle)...`,
    );

    for (const modeId of modes) {
      const mode = MODES[modeId];
      if (modes.length > 1) console.log(`   Mode: ${mode.label}`);
      applyIosMode(simulator.udid, mode.ios);
      // Let the trait change propagate before the per-preview launches.
      await sleep(settleMs);

      for (const preview of previews) {
        const ok = await captureOneIosPreview(
          simulator.udid,
          bundleId,
          dataContainer,
          preview,
          modeId,
          screenshotsDir,
          screenshotMap,
          settleMs,
        );
        if (ok) captured++;
      }
    }

    console.log(`   Captured ${captured} of ${totalShots} screenshots`);

    // 7. Uninstall
    try {
      run("xcrun", ["simctl", "terminate", simulator.udid, bundleId]);
      run("xcrun", ["simctl", "uninstall", simulator.udid, bundleId]);
    } catch {
      // non-fatal
    }
  } finally {
    // Restore display traits to how we found them.
    if (simulatorUdid && originalTraits) {
      applyIosMode(simulatorUdid, originalTraits);
    }
    // Restore everything
    if (fs.existsSync(galleryPath)) {
      fs.unlinkSync(galleryPath);
    }
    fs.writeFileSync(appEntryPath, appEntryOriginal, "utf-8");
    console.log("   Cleaned up injected files");
  }

  return screenshotMap;
}

// ---------------------------------------------------------------------------
// Per-preview capture & display-trait control
// ---------------------------------------------------------------------------

/**
 * Capture a single preview under the already-applied display mode.
 *
 * Prefers the component-sized PNG the gallery renders via `ImageRenderer` (pulled
 * from the app's Documents directory); falls back to a full-screen `simctl io`
 * capture when no rendered image appears — e.g. previews `ImageRenderer` can't
 * render (sheets, async content) or runtimes earlier than iOS 16.
 *
 * Terminates any running instance, clears any stale rendered file, launches the
 * gallery on the preview id, settles, collects the result, and records it.
 * Returns true on success.
 */
async function captureOneIosPreview(
  udid,
  bundleId,
  dataContainer,
  preview,
  modeId,
  screenshotsDir,
  screenshotMap,
  settleMs,
) {
  // Terminate any running instance
  spawnSync("xcrun", ["simctl", "terminate", udid, bundleId], {
    encoding: "utf-8",
  });

  // The gallery writes `<id>.png` (the component image, if it rendered) and
  // always `<id>.rendered` (a completion marker) into Documents. Clear any stale
  // copies first so their presence unambiguously reflects this launch.
  const renderedSrc = dataContainer
    ? path.join(dataContainer, "Documents", `${preview.id}.png`)
    : null;
  const markerSrc = dataContainer
    ? path.join(dataContainer, "Documents", `${preview.id}.rendered`)
    : null;
  for (const stale of [renderedSrc, markerSrc]) {
    if (stale && fs.existsSync(stale)) {
      try {
        fs.unlinkSync(stale);
      } catch {
        // non-fatal
      }
    }
  }

  // Launch with gallery arg
  const launchResult = spawnSync(
    "xcrun",
    ["simctl", "launch", udid, bundleId, "-fractionatorPreview", preview.id],
    { encoding: "utf-8", timeout: 15_000 },
  );

  if (launchResult.status !== 0) {
    console.warn(
      `   ⚠️  Launch failed for ${preview.id} [${modeId}]: ${launchResult.stderr}`,
    );
    return false;
  }

  // Wait for the gallery to finish (the marker), polling rather than assuming a
  // fixed delay — cold-start time varies. Once the marker appears, the render
  // attempt is complete, so we can decide immediately. If it never appears (no
  // data container, or pre-iOS 16), settle and fall back to a screenshot.
  const filename = screenshotFilename(sanitize(preview.id), modeId);
  const destFile = path.join(screenshotsDir, filename);

  const done = markerSrc
    ? await waitForFile(markerSrc, settleMs + 5000, 150)
    : false;
  if (!done) {
    await sleep(settleMs);
  }

  // Prefer the component-only image the gallery rendered.
  let cropped = false;
  if (
    renderedSrc &&
    fs.existsSync(renderedSrc) &&
    fs.statSync(renderedSrc).size > 0
  ) {
    try {
      fs.copyFileSync(renderedSrc, destFile);
      cropped = true;
    } catch {
      // fall through to full-screen capture
    }
  }

  // Fall back to a full-screen capture of the displayed preview.
  if (!cropped) {
    const shotResult = spawnSync(
      "xcrun",
      ["simctl", "io", udid, "screenshot", destFile],
      { encoding: "utf-8", timeout: 10_000 },
    );
    if (
      !(
        shotResult.status === 0 &&
        fs.existsSync(destFile) &&
        fs.statSync(destFile).size > 0
      )
    ) {
      console.warn(`   ⚠️  Screenshot failed for ${preview.id} [${modeId}]`);
      return false;
    }
  }

  // Record by preview id. Attribution to components/showcases happens downstream
  // from the preview's `renders` set, so one capture can belong to several
  // components (a showcase) without being duplicated.
  let rec = screenshotMap.get(preview.id);
  if (!rec) {
    rec = {
      id: preview.id,
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
    modeLabel: MODES[modeId].label,
    cropped,
  });
  return true;
}

/**
 * Read the simulator's current appearance / content size / increase-contrast
 * settings so they can be restored after capture. Values that come back as
 * "unsupported"/"unknown" are dropped (and skipped on restore).
 */
function readIosTraits(udid) {
  const traits = {};
  for (const option of ["appearance", "content_size", "increase_contrast"]) {
    const result = spawnSync("xcrun", ["simctl", "ui", udid, option], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    const value = (result.stdout || "").trim();
    if (value && value !== "unsupported" && value !== "unknown") {
      traits[option] = value;
    }
  }
  return traits;
}

/**
 * Apply a set of display traits via `simctl ui`. Tolerant of individual
 * settings failing (e.g. a trait unsupported on an older runtime) — warns and
 * continues rather than aborting the whole capture.
 */
function applyIosMode(udid, traits) {
  for (const [option, value] of Object.entries(traits)) {
    const result = spawnSync("xcrun", ["simctl", "ui", udid, option, value], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (result.status !== 0) {
      console.warn(
        `   ⚠️  Could not set ${option}=${value}: ${(result.stderr || "").trim()}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Preview extraction
// ---------------------------------------------------------------------------

/**
 * Extract capturable #Preview blocks across all component files, preview-centric.
 * Each file is processed once; a preview's `renders` set (the known components its
 * body constructs) drives attribution downstream — one component, several (a
 * showcase), or none (the name/file fallback).
 *
 * Returns [{ id, previewName, body, wrapper, renders, fallbackComponent,
 * sourceFile }].
 */
function extractAllPreviews(components, projectPath) {
  const componentNames = new Set(components.map((c) => c.name));

  // Group components by file so a file shared by several components is read once
  // (and a preview isn't duplicated across them).
  const fileMap = new Map(); // filePath → [component, ...]
  for (const comp of components) {
    const arr = fileMap.get(comp.filePath) || [];
    arr.push(comp);
    fileMap.set(comp.filePath, arr);
  }

  const previews = [];
  const seenIds = new Set();

  for (const [filePath, fileComponents] of fileMap) {
    const content = fs.readFileSync(filePath, "utf-8");
    const relativePath = path.relative(projectPath, filePath);
    const fileStem = path.basename(filePath, ".swift");
    // The file's namesake component (or its first) backs previews that render no
    // known component — e.g. a whole-screen preview.
    const fallback =
      fileComponents.find((c) => c.name === fileStem) || fileComponents[0];

    const records = extractPreviewRecords(content).filter((r) => !r.skip);
    for (const rec of records) {
      let id = sanitize(`${fileStem}_${rec.previewName}`);
      if (seenIds.has(id)) {
        let n = 2;
        while (seenIds.has(`${id}_${n}`)) n++;
        id = `${id}_${n}`;
      }
      seenIds.add(id);

      previews.push({
        id,
        previewName: rec.previewName,
        body: rec.body,
        wrapper: rec.wrapper,
        renders: detectRenderedComponents(rec.body, componentNames, null),
        fallbackComponent: fallback ? fallback.name : null,
        sourceFile: relativePath,
      });
    }
  }

  return previews;
}

/**
 * The set of known component names a #Preview body constructs — its real
 * subjects. SwiftUI components are used as `Name(...)`, so we match `Name(`
 * against the known component names, after stripping comments/strings so a name
 * in a comment or string literal doesn't false-match.
 */
function detectRenderedComponents(body, componentNames, selfName) {
  if (!body) return [];
  const stripped = stripSwiftComments(body).replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const found = [];
  for (const name of componentNames) {
    if (name === selfName) continue;
    if (new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(stripped)) {
      found.push(name);
    }
  }
  return found;
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract all #Preview { ... } blocks from a file, with a skip classification.
 * Returns [{ previewName, body, wrapper, skip }] where:
 *  - `skip` is null for capturable previews, or a short human-readable reason;
 *  - `wrapper` is non-null for `@Previewable @State` previews we can capture by
 *    hoisting the state into a generated wrapper View (see parsePreviewableState).
 * Identity and component attribution are assigned by the caller from the body.
 */
function extractPreviewRecords(content) {
  const results = [];

  // Collect names of private/fileprivate types in this file so we can
  // skip previews that reference them (they'd be inaccessible from our
  // generated gallery file).
  const privateTypes = collectPrivateTypes(content);

  // Match #Preview("Name") { ... } and #Preview { ... }
  const pattern = /#Preview\s*(?:\(\s*"([^"]*)"\s*\))?\s*\{/g;
  let match;
  let defaultIndex = 0;

  while ((match = pattern.exec(content)) !== null) {
    const previewName = match[1] || `Default${defaultIndex++ > 0 ? "_" + defaultIndex : ""}`;
    const bracePos = content.lastIndexOf("{", match.index + match[0].length);

    const block = extractBraceBlock(content, bracePos);
    if (!block) continue;

    const body = block.content.trim();
    if (!body) continue;

    let wrapper = null;
    let skip = null;

    if (body.includes("@Previewable")) {
      // `@Previewable @State` declares preview-local state. The macro can't be
      // lifted into AnyView() in another file, but we can hoist the declarations
      // into a generated wrapper View whose real @State backs the $bindings.
      const parsed = parsePreviewableState(body);
      if (parsed) {
        wrapper = parsed;
      } else {
        skip = "interactive preview (@Previewable state)";
      }
    } else {
      skip = classifyPreviewSkip(body, content, match.index, privateTypes);
    }

    // A private/fileprivate type is inaccessible from the gallery file whether or
    // not we wrap the preview — so re-check and override the wrapper.
    if (wrapper && referencesPrivateType(body, privateTypes)) {
      wrapper = null;
      skip = "references a private type";
    }

    results.push({ previewName, body, wrapper, skip });
  }

  return results;
}

/**
 * Decide whether a (non-@Previewable) #Preview body can be relocated into
 * FractionatorGallery.swift and captured. Returns null when it can, or a short
 * reason when it can't — the reason is surfaced in the report so a missing
 * preview is explained rather than silently absent.
 */
function classifyPreviewSkip(body, content, matchIndex, privateTypes) {
  // Bare `return` means a multi-statement body that can't be wrapped in AnyView().
  if (/^\s*return\s/m.test(body)) {
    return "multi-statement preview (uses return)";
  }

  // `$` bindings (likely from @Previewable @State) — but ignore string
  // interpolation. Confirm by looking for nearby @State / @Previewable.
  if (/\$\w+/.test(body) && !body.includes("\\(")) {
    const nearbyContent = content.slice(Math.max(0, matchIndex - 200), matchIndex);
    if (/@Previewable|@State/.test(nearbyContent)) {
      return "interactive preview (state binding)";
    }
  }

  // private/fileprivate types are inaccessible from the generated gallery file.
  if (referencesPrivateType(body, privateTypes)) {
    return "references a private type";
  }

  return null;
}

/** True when a preview body uses any of the file's private/fileprivate types. */
function referencesPrivateType(body, privateTypes) {
  return privateTypes.some((name) => new RegExp(`\\b${name}\\b`).test(body));
}

/**
 * Parse a `@Previewable @State` preview body into the pieces needed to build a
 * wrapper View: the hoisted property declarations and the remaining view body.
 *
 * Returns `{ stateDecls: string[], viewBody: string }`, or null when the body
 * can't be transformed safely — in which case the caller skips it as before. The
 * checks are deliberately conservative: a malformed wrapper would fail to compile
 * and take the whole gallery build (and every screenshot) down with it, so
 * anything unfamiliar bails rather than guesses.
 */
function parsePreviewableState(body) {
  const lines = body.split("\n");
  const stateDecls = [];
  const bodyLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("@Previewable")) {
      bodyLines.push(line);
      continue;
    }
    // Strip the @Previewable attribute; what's left is an ordinary stored
    // property the wrapper View can declare.
    const decl = trimmed.replace(/^@Previewable\s+/, "");
    // Only accept known property wrappers on a single, balanced line. A
    // multi-line initializer would split across our line filter and break.
    if (
      !/^@(State|StateObject|Bindable|Environment|AppStorage|SceneStorage|FocusState)\b/.test(
        decl,
      ) ||
      !isBalancedLine(decl)
    ) {
      return null;
    }
    stateDecls.push(decl);
  }

  if (stateDecls.length === 0) return null;
  const viewBody = bodyLines.join("\n").trim();
  if (!viewBody) return null;

  return { stateDecls, viewBody };
}

/**
 * Conservative balance check: parens/brackets/braces matched and quotes paired,
 * ignoring delimiters inside string literals. Used to reject multi-line
 * declarations we shouldn't try to hoist onto a single line.
 */
function isBalancedLine(line) {
  let paren = 0,
    bracket = 0,
    brace = 0,
    quotes = 0;
  for (const ch of line) {
    if (ch === '"') {
      quotes++;
    } else if (quotes % 2 === 0) {
      if (ch === "(") paren++;
      else if (ch === ")") paren--;
      else if (ch === "[") bracket++;
      else if (ch === "]") bracket--;
      else if (ch === "{") brace++;
      else if (ch === "}") brace--;
    }
  }
  return paren === 0 && bracket === 0 && brace === 0 && quotes % 2 === 0;
}

/**
 * Static analysis of every component's previews — which exist and, for those we
 * can't capture, why. Needs no simulator, so the report can explain missing
 * previews even when screenshot capture is skipped or fails.
 *
 * @returns {Map<string, {previewName: string, skip: string|null}[]>}
 *   componentName → one entry per #Preview found in its source file.
 */
function analyzePreviews(components, projectPath) {
  const map = new Map();
  for (const comp of components) {
    let content;
    try {
      content = fs.readFileSync(comp.filePath, "utf-8");
    } catch {
      continue;
    }
    const records = extractPreviewRecords(content);
    map.set(
      comp.name,
      records.map((r) => ({ previewName: r.previewName, skip: r.skip })),
    );
  }
  return map;
}

/**
 * Collect names of private/fileprivate types in a Swift file.
 * Returns an array of type names.
 */
function collectPrivateTypes(content) {
  const names = [];
  const pattern = /(?:private|fileprivate)\s+(?:struct|class|enum|actor)\s+(\w+)/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    names.push(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Gallery generation
// ---------------------------------------------------------------------------

/**
 * Generate FractionatorGallery.swift — a single file containing all preview
 * bodies as cases in a switch, selectable via launch argument.
 *
 * The selected preview is both displayed (so the full-screen capture fallback
 * still works) and rendered to a component-sized PNG via `ImageRenderer`, which
 * sizes to the view's intrinsic content — no device chrome, no whitespace. The
 * render honours the live colour scheme and Dynamic Type size so mode variations
 * (dark, type) are reproduced; `ImageRenderer` otherwise renders in a detached,
 * default environment. The PNG is written to the app's Documents directory under
 * the preview id, where the capture loop collects it.
 *
 * `@Previewable @State` previews can't be inlined into AnyView() — the macro is
 * preview-only. Those carry a `wrapper` (see parsePreviewableState): we emit a
 * dedicated View struct that declares real @State for the hoisted bindings, and
 * the switch case instantiates it instead of inlining the body.
 */
function generateGallerySource(previews) {
  const wrappers = [];

  const cases = previews
    .map((p) => {
      if (p.wrapper) {
        const structName = `FractionatorPreview_${sanitize(p.id)}`;
        wrappers.push(generateWrapperStruct(structName, p.wrapper));
        return `        case "${p.id}":
            AnyView(${structName}())`;
      }
      return `        case "${p.id}":
            AnyView(
                ${indentBody(p.body, 16)}
            )`;
    })
    .join("\n");

  const wrapperSource = wrappers.length ? `\n${wrappers.join("\n\n")}\n` : "";

  return `${SENTINEL}
import SwiftUI
import UIKit
${wrapperSource}
struct FractionatorGallery: View {
    let previewId: String
    @Environment(\\.displayScale) private var displayScale
    @Environment(\\.colorScheme) private var colorScheme
    @Environment(\\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        previewContent(previewId)
            .task {
                // Let the view settle (async loads, layout) before rendering.
                try? await Task.sleep(nanoseconds: 400_000_000)
                renderToFile(previewId)
                // Always signal completion — present whether or not a PNG was
                // produced — so the capture loop can fall back immediately
                // instead of waiting out a timeout.
                writeMarker(previewId)
            }
    }

    @ViewBuilder
    private func previewContent(_ id: String) -> some View {
        switch id {
${cases}
        default:
            AnyView(Text("Unknown preview: \\(id)"))
        }
    }

    @MainActor
    private func renderToFile(_ id: String) {
        guard #available(iOS 16.0, *) else { return }
        let content = previewContent(id)
            .environment(\\.colorScheme, colorScheme)
            .environment(\\.dynamicTypeSize, dynamicTypeSize)
        let renderer = ImageRenderer(content: content)
        renderer.scale = displayScale

        // First pass: let the view size to its own ideal dimensions, so
        // tightly-sized components stay tightly cropped.
        var image = renderer.uiImage
        // Retry, only on failure: propose a phone-width so width-greedy views
        // (.frame(maxWidth: .infinity)) can resolve. Additive — this never runs
        // for a preview the ideal-size pass already rendered. A blank image
        // counts as a failure here too: some containers (notably ScrollView)
        // render a correctly-sized but empty canvas, which we'd rather retry —
        // and ultimately reject — than mistake for a real crop.
        if image == nil || isBlank(image!) {
            renderer.proposedSize = ProposedViewSize(width: 390, height: nil)
            image = renderer.uiImage
        }

        // Skip writing a blank render: ImageRenderer can't rasterize some views
        // (e.g. ScrollView content) and returns a non-nil but empty image. By
        // not writing the PNG we let the capture loop fall back to a full-screen
        // screenshot, which shows the live-rendered preview instead of a white box.
        guard let image, !isBlank(image),
              let data = image.pngData(),
              let docs = FileManager.default.urls(
                  for: .documentDirectory, in: .userDomainMask).first
        else { return }
        try? data.write(to: docs.appendingPathComponent(id + ".png"))
    }

    /// True when the rendered image carries essentially no visible content —
    /// every pixel the same colour (a white or fully-transparent canvas). The
    /// image is downscaled into a small bitmap and checked for any colour
    /// variance, so real content (glyphs, buttons, text) stays well clear of the
    /// threshold while a uniform canvas is reliably caught.
    private func isBlank(_ image: UIImage) -> Bool {
        guard let cg = image.cgImage, cg.width > 0, cg.height > 0 else { return true }
        let w = min(cg.width, 32)
        let h = min(cg.height, 32)
        var pixels = [UInt8](repeating: 0, count: w * h * 4)
        let space = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(
            data: &pixels, width: w, height: h, bitsPerComponent: 8,
            bytesPerRow: w * 4, space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return false }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))

        // Compare every sampled pixel against the first; any meaningful colour
        // or alpha difference means there's something to show.
        let r0 = pixels[0], g0 = pixels[1], b0 = pixels[2], a0 = pixels[3]
        var i = 0
        while i < pixels.count {
            if abs(Int(pixels[i]) - Int(r0)) > 8 ||
               abs(Int(pixels[i + 1]) - Int(g0)) > 8 ||
               abs(Int(pixels[i + 2]) - Int(b0)) > 8 ||
               abs(Int(pixels[i + 3]) - Int(a0)) > 8 {
                return false
            }
            i += 4
        }
        return true
    }

    private func writeMarker(_ id: String) {
        guard let docs = FileManager.default.urls(
            for: .documentDirectory, in: .userDomainMask).first
        else { return }
        try? Data().write(to: docs.appendingPathComponent(id + ".rendered"))
    }
}
`;
}

/**
 * Generate a wrapper View struct for a `@Previewable @State` preview: the hoisted
 * declarations become real stored properties, and the remaining preview content
 * becomes the @ViewBuilder body so its $bindings resolve against that state.
 */
function generateWrapperStruct(structName, wrapper) {
  const decls = wrapper.stateDecls.map((d) => `    ${d}`).join("\n");
  return `struct ${structName}: View {
${decls}

    @ViewBuilder
    var body: some View {
        ${indentBody(wrapper.viewBody, 8)}
    }
}`;
}

/**
 * Indent a multi-line string to the given column, preserving relative indentation.
 */
function indentBody(body, spaces) {
  const lines = body.split("\n");
  if (lines.length <= 1) return body;

  // Find minimum indentation of non-empty lines (after the first)
  let minIndent = Infinity;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].replace(/^\s+/, "");
    if (trimmed.length === 0) continue;
    const indent = lines[i].length - trimmed.length;
    if (indent < minIndent) minIndent = indent;
  }
  if (minIndent === Infinity) minIndent = 0;

  const pad = " ".repeat(spaces);
  return lines
    .map((line, i) => {
      if (i === 0) return line;
      if (line.trim().length === 0) return "";
      return pad + line.slice(minIndent);
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// App entry point injection
// ---------------------------------------------------------------------------

/**
 * Inject a launch-arg handler into the app's @main entry point.
 * When `-fractionatorPreview <id>` is passed, the app shows the gallery
 * instead of normal content.
 *
 * Injects inside the WindowGroup's @ViewBuilder closure (not at the
 * Scene level), because SceneBuilder doesn't support if/else control flow.
 */
function injectAppEntryHandler(originalContent) {
  // If already injected, don't double-inject
  if (originalContent.includes(SENTINEL)) return originalContent;

  // Find `WindowGroup {` inside the body — we inject into the ViewBuilder
  // closure, which supports if/else, rather than the SceneBuilder body.
  const wgMatch = originalContent.match(/\bWindowGroup\s*\{/);
  if (!wgMatch) {
    throw new Error(
      "Could not find `WindowGroup {` in app entry point. " +
        "Ensure the prototype uses a WindowGroup scene.",
    );
  }

  const wgBracePos = wgMatch.index + wgMatch[0].length - 1;
  const block = extractBraceBlock(originalContent, wgBracePos);
  if (!block) {
    throw new Error("Could not parse WindowGroup content block");
  }

  const wgContent = block.content;
  const insertPos = wgBracePos + 1; // right after the opening {
  const endPos = block.end - 1; // right before the closing }

  // Wrap the original WindowGroup content in an if/else
  const injection = `
            ${SENTINEL}
            if ProcessInfo.processInfo.arguments.contains("-fractionatorPreview") {
                FractionatorGallery(previewId: _FractionatorHelper.previewId)
            } else {
            ${wgContent}
            } ${SENTINEL}`;

  const before = originalContent.slice(0, insertPos);
  const after = originalContent.slice(endPos);

  // Append a private helper enum at the end of the file to extract the
  // preview ID from launch arguments.
  const helper = `

${SENTINEL}
private enum _FractionatorHelper {
    static var previewId: String {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: "-fractionatorPreview"),
              idx + 1 < args.count else { return "" }
        return args[idx + 1]
    }
}
`;

  return `${before}${injection}
    ${after}${helper}`;
}

/**
 * Find the App entry point file (@main struct ... : App).
 */
function findAppEntryPoint(projectPath) {
  const swiftFiles = globSync("**/*.swift", {
    cwd: projectPath,
    absolute: true,
    ignore: [
      "**/DerivedData/**",
      "**/.build/**",
      "**/build/**",
      "**/Pods/**",
      "**/*Tests/**",
      "**/*UITests/**",
    ],
  });

  for (const filePath of swiftFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    if (/@main\b/.test(content) && /:\s*App\b/.test(content)) {
      return filePath;
    }
  }

  throw new Error(
    `Could not find @main App entry point in ${projectPath}. ` +
      "Ensure the prototype uses the SwiftUI App lifecycle.",
  );
}

/**
 * Find the main source directory to place our generated gallery file.
 * Returns the directory containing the app entry point.
 */
function findSourceDir(projectPath) {
  const appEntry = findAppEntryPoint(projectPath);
  return path.dirname(appEntry);
}

// ---------------------------------------------------------------------------
// Xcode / Simulator helpers (adapted from Quiver)
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll for a file to exist, up to a timeout. Returns true once it appears.
 * Used for the gallery's completion marker, which is written only after the
 * component PNG, so its presence means any PNG is fully written.
 */
async function waitForFile(filePath, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true;
    await sleep(intervalMs);
  }
  return fs.existsSync(filePath);
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 200);
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf-8", timeout: 60_000 });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function findDeveloperDir() {
  const xcodePath = "/Applications/Xcode.app/Contents/Developer";
  if (fs.existsSync(xcodePath)) return xcodePath;
  try {
    const sel = execSync("xcode-select -p", { encoding: "utf-8" }).trim();
    if (sel && fs.existsSync(sel)) return sel;
  } catch {}
  throw new Error("Xcode not found. Install Xcode from the Mac App Store.");
}

function findXcodeProject(prototypePath) {
  const workspaces = globSync("*.xcworkspace", {
    cwd: prototypePath,
    absolute: true,
  }).filter((w) => !w.includes(".xcodeproj/"));
  if (workspaces.length > 0) return workspaces[0];

  const projects = globSync("*.xcodeproj", {
    cwd: prototypePath,
    absolute: true,
  });
  if (projects.length > 0) return projects[0];

  throw new Error(`No Xcode project found in ${prototypePath}`);
}

function getScheme(xcodeProject, projectFlag) {
  const developerDir = findDeveloperDir();
  let out;
  try {
    out = execSync(
      `xcodebuild -list ${projectFlag} "${xcodeProject}" 2>&1`,
      {
        env: { ...process.env, DEVELOPER_DIR: developerDir },
        encoding: "utf-8",
        timeout: 30_000,
      },
    );
  } catch (err) {
    throw new Error(`xcodebuild -list failed: ${err.message}`);
  }
  const match = out.match(/Schemes:\n([\s\S]*?)(\n\s*\n|$)/);
  const schemes = match
    ? match[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  if (schemes.length === 0)
    throw new Error("No schemes found in Xcode project");
  const nonTest =
    schemes.find((s) => !s.toLowerCase().includes("uitest")) || schemes[0];
  return nonTest;
}

function findOrBootSimulator() {
  const developerDir = findDeveloperDir();
  let devicesJson;
  try {
    devicesJson = execSync(
      "xcrun simctl list devices available --json 2>/dev/null",
      {
        env: { ...process.env, DEVELOPER_DIR: developerDir },
        encoding: "utf-8",
        timeout: 15_000,
      },
    );
  } catch {
    throw new Error(
      "xcrun simctl failed. Ensure Xcode and iOS Simulator are installed.",
    );
  }

  const { devices } = JSON.parse(devicesJson);
  const iosRuntimes = Object.entries(devices)
    .filter(([k]) => k.toLowerCase().includes("ios"))
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }));

  // Prefer already-booted iPhone
  for (const [, list] of iosRuntimes) {
    const booted = list.find(
      (d) => d.state === "Booted" && d.name.includes("iPhone") && d.isAvailable,
    );
    if (booted) return booted;
  }

  // Boot the newest available iPhone
  for (const [, list] of iosRuntimes) {
    const available = list.find(
      (d) => d.name.includes("iPhone") && d.isAvailable,
    );
    if (available) {
      console.log(`   Booting simulator ${available.name}...`);
      spawnSync("xcrun", ["simctl", "boot", available.udid], {
        encoding: "utf-8",
        timeout: 60_000,
      });
      spawnSync(
        "xcrun",
        ["simctl", "bootstatus", available.udid, "-b"],
        { encoding: "utf-8", timeout: 120_000 },
      );
      return { ...available, state: "Booted" };
    }
  }

  throw new Error(
    "No available iPhone simulator found. Open Xcode → Platforms and install an iOS Simulator.",
  );
}

function findBuiltApp(derivedDataPath) {
  const apps = globSync("Build/Products/Debug-iphonesimulator/*.app", {
    cwd: derivedDataPath,
    absolute: true,
  }).filter((p) => {
    const name = path.basename(p);
    return (
      !name.endsWith(".appex") &&
      !name.includes("UITests") &&
      !name.includes("Tests-Runner")
    );
  });

  if (apps.length > 0) return apps[0];
  throw new Error(
    `No built .app found in ${derivedDataPath}/Build/Products/Debug-iphonesimulator/`,
  );
}

function extractBundleId(appPath) {
  try {
    return execSync(
      `plutil -extract CFBundleIdentifier raw "${appPath}/Info.plist"`,
      { encoding: "utf-8" },
    ).trim();
  } catch (err) {
    throw new Error(
      `Could not extract bundle ID from ${appPath}: ${err.message}`,
    );
  }
}

module.exports = {
  captureComponentScreenshots,
  analyzePreviews,
  // Exported for unit tests.
  detectRenderedComponents,
};
