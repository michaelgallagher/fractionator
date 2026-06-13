# Architecture

Fractionator is a Node CLI. A run is a pipeline: **scan → analyse usages → group
variants → capture previews → assemble catalogue → render output.**

```
bin/cli.js                        CLI entry point + project auto-detection
src/
  index.js                        Pipeline orchestrator + per-platform assembly

  swift-component-scanner.js      SwiftUI struct detection + signature extraction
  swift-screenshot-capture.js     #Preview capture (ImageRenderer gallery, simctl)
  kotlin-component-scanner.js     Compose @Composable detection + signatures
  kotlin-screenshot-capture.js    @Preview capture (GraphicsLayer gallery, adb)

  usage-scanner.js                Call-site detection across files (multi-language)
  variant-grouper.js              Group usages by parameter combinations
  variation-modes.js              Display-trait modes (dark / type / contrast)

  cross-platform-matcher.js       Match components across platforms
  mapping-loader.js               Load + validate component-mapping.yaml
  mapping-generator.js            Generate a starter mapping (--init-mapping)

  token-scanner.js                Find colour/type/spacing tokens in source
  color-resolver.js               Resolve named colours → light/dark hex
  type-resolver.js                Resolve Android text-style roles → sizes
  token-catalogue.js              Build the token catalogue from occurrences

  build-report.js                 HTML / JSON / Markdown output
docs/                             Documentation (this folder)
```

Tests are colocated as `*.test.js` and run with `npm test` (`node --test`).

## How attribution works

Capture is **preview-centric**: each `#Preview` / `@Preview` is rendered once and
keyed by a preview id. Its `renders` set — the known components its body
constructs — decides where the image lands: a single component, several (a
[showcase](screenshot-capture.md#multi-component-previews--showcases)), or a
name/file fallback. `src/index.js` turns the captured previews into per-component
`screenshots` + `appearsIn` links and a platform `showcases` list; `build-report.js`
renders them.

## Pipeline notes

- **Static-first.** Detection, usages, variants, and tokens need no build, so
  `--no-screenshots` is a fast path that still produces a full catalogue.
- **Capture is isolated.** The injected gallery files and manifest/entry-point
  patches are always cleaned up in a `finally`; the simulator/emulator's display
  traits are snapshotted and restored.
- **Adding a platform** means a scanner + a capture module following the SwiftUI /
  Compose pair, then wiring assembly in `index.js`.
