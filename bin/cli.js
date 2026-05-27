#!/usr/bin/env node

const { Command } = require("commander");
const path = require("path");
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
  .option(
    "--init-mapping",
    "Generate a starter mapping file from auto-detected components and exit",
  )
  .action(async (opts) => {
    if (!opts.ios && !opts.android && !opts.web) {
      console.error(
        "Error: at least one source is required (--ios, --android, or --web)",
      );
      process.exit(1);
    }

    const sources = {};
    if (opts.ios) sources.ios = path.resolve(opts.ios);
    if (opts.android) sources.android = path.resolve(opts.android);
    if (opts.web) sources.web = path.resolve(opts.web);

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
      noScreenshots: opts.noScreenshots || false,
    });
  });

program.parse();
