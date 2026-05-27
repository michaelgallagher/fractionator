const { execSync, spawnSync } = require("child_process");
const { globSync } = require("glob");
const path = require("path");
const fs = require("fs");
const { extractBraceBlock } = require("./swift-component-scanner");

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
 * @returns {Map<string, string[]>} componentName → [screenshot relative paths]
 */
async function captureComponentScreenshots(
  components,
  projectPath,
  outputDir,
  options = {},
) {
  const { settleMs = 1500 } = options;
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

    // 6. Screenshot loop
    console.log(
      `   Capturing ${previews.length} previews (${settleMs}ms settle)...`,
    );

    for (const preview of previews) {
      // Terminate any running instance
      spawnSync("xcrun", ["simctl", "terminate", simulator.udid, bundleId], {
        encoding: "utf-8",
      });

      // Launch with gallery arg
      const launchResult = spawnSync(
        "xcrun",
        [
          "simctl",
          "launch",
          simulator.udid,
          bundleId,
          "-fractionatorPreview",
          preview.id,
        ],
        { encoding: "utf-8", timeout: 15_000 },
      );

      if (launchResult.status !== 0) {
        console.warn(
          `   ⚠️  Launch failed for ${preview.id}: ${launchResult.stderr}`,
        );
        continue;
      }

      // Settle
      await sleep(settleMs);

      // Capture
      const filename = `${sanitize(preview.id)}.png`;
      const destFile = path.join(screenshotsDir, filename);
      const shotResult = spawnSync(
        "xcrun",
        ["simctl", "io", simulator.udid, "screenshot", destFile],
        { encoding: "utf-8", timeout: 10_000 },
      );

      if (
        shotResult.status === 0 &&
        fs.existsSync(destFile) &&
        fs.statSync(destFile).size > 0
      ) {
        const relPath = `screenshots/${filename}`;
        const existing = screenshotMap.get(preview.componentName) || [];
        existing.push({
          path: relPath,
          previewName: preview.previewName,
          id: preview.id,
        });
        screenshotMap.set(preview.componentName, existing);
        captured++;
      } else {
        console.warn(`   ⚠️  Screenshot failed for ${preview.id}`);
      }
    }

    console.log(`   Captured ${captured} of ${previews.length} previews`);

    // 7. Uninstall
    try {
      run("xcrun", ["simctl", "terminate", simulator.udid, bundleId]);
      run("xcrun", ["simctl", "uninstall", simulator.udid, bundleId]);
    } catch {
      // non-fatal
    }
  } finally {
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
// Preview extraction
// ---------------------------------------------------------------------------

/**
 * Extract #Preview block bodies from all component source files.
 * Returns [{ id, componentName, previewName, body }]
 */
function extractAllPreviews(components, projectPath) {
  const previews = [];

  for (const comp of components) {
    const content = fs.readFileSync(comp.filePath, "utf-8");
    const compPreviews = extractPreviewBlocks(content, comp.name);
    previews.push(...compPreviews);
  }

  return previews;
}

/**
 * Extract all #Preview { ... } blocks from a file.
 * Returns [{ id, componentName, previewName, body }]
 *
 * Skips previews that:
 * - Use @Previewable (state macro that can't be extracted)
 * - Have bare return statements
 * - Reference private/fileprivate types from the same file
 */
function extractPreviewBlocks(content, componentName) {
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

    // Skip previews that use @Previewable — these declare @State inside
    // the preview block, which is a Swift macro that doesn't work when
    // the body is wrapped in AnyView() or extracted into a different context.
    if (body.includes("@Previewable")) continue;

    // Skip previews with bare `return` statements — these are multi-statement
    // preview bodies that can't be wrapped in AnyView().
    if (/^\s*return\s/m.test(body)) continue;

    // Skip previews that reference `$` bindings (likely from @Previewable @State)
    // but check it's not just a string interpolation
    if (/\$\w+/.test(body) && !body.includes("\\(")) {
      // Might have binding references — check if there's a @State elsewhere
      // in the file near this preview
      const nearbyContent = content.slice(
        Math.max(0, match.index - 200),
        match.index,
      );
      if (/@Previewable|@State/.test(nearbyContent)) continue;
    }

    // Skip previews that reference private/fileprivate types — these are
    // inaccessible from FractionatorGallery.swift (a different file).
    if (privateTypes.length > 0) {
      const usesPrivateType = privateTypes.some((name) => {
        // Look for the type name used as a constructor call or type reference
        const re = new RegExp(`\\b${name}\\b`);
        return re.test(body);
      });
      if (usesPrivateType) continue;
    }

    // Create a unique ID
    const id = `${componentName}_${sanitize(previewName)}`;

    results.push({
      id,
      componentName,
      previewName,
      body,
    });
  }

  return results;
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
 */
function generateGallerySource(previews) {
  const cases = previews
    .map(
      (p) => `        case "${p.id}":
            AnyView(
                ${indentBody(p.body, 16)}
            )`,
    )
    .join("\n");

  return `${SENTINEL}
import SwiftUI

struct FractionatorGallery: View {
    let previewId: String

    var body: some View {
        switch previewId {
${cases}
        default:
            AnyView(Text("Unknown preview: \\(previewId)"))
        }
    }
}
`;
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

module.exports = { captureComponentScreenshots };
