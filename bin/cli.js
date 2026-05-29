#!/usr/bin/env node

const { Command } = require("commander");
const path = require("path");
const fs = require("fs");
const { globSync } = require("glob");
const { generate } = require("../src/index");

const program = new Command();

program
  .name("fractionator")
  .description(
    "Component catalogue tool for SwiftUI, Jetpack Compose, and Nunjucks prototypes",
  )
  .version("0.1.0");

program
  .option("--ios <path>", "Path to iOS/SwiftUI prototype")
  .option("--android <path>", "Path to Android/Compose prototype")
  .option("--web <path>", "Path to web/Nunjucks prototype")
  .option("--output <dir>", "Output directory", "catalogue-output")
  .option(
    "--format <formats>",
    "Output formats, comma-separated (html,json,md)",
    "html,json",
  )
  .option("--mapping <path>", "Path to component-mapping.yaml")
  .option(
    "--components-dir <glob>",
    "Override component directory pattern (glob)",
  )
  .option("--include-unused", "Include components defined but never used")
  .option("--no-screenshots", "Skip screenshot capture (static analysis only)")
  .option("--no-open", "Don't open the HTML report in a browser when finished")
  .option(
    "--init-mapping",
    "Generate a starter mapping file from auto-detected components and exit",
  )
  .action(async (opts) => {
    const sources = {};
    if (opts.ios) sources.ios = path.resolve(opts.ios);
    if (opts.android) sources.android = path.resolve(opts.android);
    if (opts.web) sources.web = path.resolve(opts.web);

    // If no source flags were given, try to detect the project type
    // from the current directory.
    if (Object.keys(sources).length === 0) {
      const detected = detectProjectType(process.cwd());
      if (detected) {
        sources[detected.platform] = detected.dir;
        console.log(
          `Detected ${detected.platform} project in ${detected.dir === process.cwd() ? "current directory" : path.relative(process.cwd(), detected.dir) + "/"}\n`,
        );
      } else {
        console.error(
          "Error: could not detect project type in the current directory.\n" +
            "Either run from inside a prototype, or specify a source explicitly:\n" +
            "  fractionator --ios <path>\n" +
            "  fractionator --android <path>\n" +
            "  fractionator --web <path>",
        );
        process.exit(1);
      }
    }

    const outputDir = path.resolve(opts.output);
    const formats = opts.format.split(",").map((f) => f.trim());

    await generate({
      sources,
      outputDir,
      formats,
      mappingPath: opts.mapping ? path.resolve(opts.mapping) : null,
      componentsDirOverride: opts.componentsDir || null,
      includeUnused: opts.includeUnused || false,
      initMapping: opts.initMapping || false,
      noScreenshots: opts.screenshots === false,
      open: opts.open !== false,
    });
  });

/**
 * Detect the prototype platform and project root from files in the given
 * directory. Returns { platform, dir } or null.
 *
 * Checks the directory itself first, then immediate subdirectories — repos
 * often have the actual project nested one level down (e.g. a repo root
 * containing `NHSAppNativeProto/build.gradle.kts`).
 */
function detectProjectType(dir) {
  const result = detectInDir(dir);
  if (result) return result;

  // Check immediate subdirectories
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const subdir = path.join(dir, entry.name);
    const sub = detectInDir(subdir);
    if (sub) return sub;
  }

  return null;
}

/**
 * Check a single directory for project-type markers.
 * Returns { platform, dir } or null.
 */
function detectInDir(dir) {
  // iOS — .xcodeproj, .xcworkspace, or Package.swift
  const hasXcodeProj =
    globSync("*.xcodeproj", { cwd: dir }).length > 0 ||
    globSync("*.xcworkspace", { cwd: dir }).filter(
      (w) => !w.includes(".xcodeproj/"),
    ).length > 0;
  if (hasXcodeProj || fs.existsSync(path.join(dir, "Package.swift"))) {
    return { platform: "ios", dir };
  }

  // Android — build.gradle / build.gradle.kts / settings.gradle
  const gradleFiles = [
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
  ];
  if (gradleFiles.some((f) => fs.existsSync(path.join(dir, f)))) {
    return { platform: "android", dir };
  }

  // Web / Nunjucks — .njk files or nunjucks in package.json dependencies
  if (globSync("**/*.njk", { cwd: dir, maxDepth: 3 }).length > 0) {
    return { platform: "web", dir };
  }
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf-8"),
    );
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    if (allDeps["nunjucks"] || allDeps["govuk-frontend"] || allDeps["nhsuk-frontend"]) {
      return { platform: "web", dir };
    }
  } catch {
    // no package.json or invalid — not a web project
  }

  return null;
}

program.parse();
