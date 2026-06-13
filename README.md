# Fractionator

A CLI that scans SwiftUI and Jetpack Compose prototype codebases and produces a
**component catalogue** — what exists, where it's used, how it's parameterised,
and what it looks like.

## What it does

Point Fractionator at one or more prototypes and it will:

- **Detect components** — `View` structs (SwiftUI) and `@Composable` functions
  (Compose).
- **Count and locate usages** — every call site, with file, line, and enclosing
  screen.
- **Group parameter variants** — cluster call sites by arguments to see how many
  distinct styles of each component exist.
- **Capture previews** — render each `#Preview` / `@Preview` off-screen at the
  component's intrinsic size and photograph it. Multi-component previews become
  **showcases**.
- **Catalogue style tokens** — the colours (light *and* dark hex), type sizes, and
  spacing units actually in use.
- **Output a report** — a self-contained HTML page: a filterable component gallery
  (with a Gallery/List toggle and click-to-drill-in detail), a Showcases tab, and a
  Style tokens tab. Also JSON and Markdown.

## Requirements

- **Node.js** 18+
- **Xcode** + an iOS Simulator runtime — for iOS preview capture (macOS only)
- **Android SDK** + a running emulator — for Android preview capture

Capture is optional: `--no-screenshots` skips the build/render step, and all
static analysis (detection, usages, variants, tokens) works without Xcode or the
Android SDK.

## Install

```bash
npm install
npm link
```

## Quick start

```bash
# Inside a prototype directory — auto-detects iOS / Android
fractionator

# Or point at one explicitly
fractionator --ios ~/Repos/my-ios-prototype

# Fast static-only run (no build)
fractionator --no-screenshots

# Scan two platforms and align them
fractionator --ios ~/ios-proto --android ~/android-proto
```

The report opens in your browser when the run finishes (`--no-open` to suppress).
See **[docs/usage.md](docs/usage.md)** for every flag.

## Documentation

Full docs are in **[docs/](docs/README.md)**:

- [Usage](docs/usage.md) — CLI reference, examples, display-trait variations
- [Output](docs/output.md) — the HTML report, JSON, and Markdown
- [Writing capturable previews](docs/writing-capturable-previews.md) — author
  previews that render cleanly
- [Component detection](docs/component-detection.md) — how components/usages/variants
  are found
- [Screenshot capture](docs/screenshot-capture.md) — the preview-rendering pipelines
- [Style tokens](docs/style-tokens.md) — colours, type, spacing
- [Cross-platform alignment](docs/cross-platform-alignment.md) — matching across
  platforms
- [Architecture](docs/architecture.md) — pipeline and module map
- [Plans](docs/plans/README.md) — what's planned and what's shipped

## Development

```bash
npm test   # node --test over src/**/*.test.js
```

## License

MIT — see [LICENSE](LICENSE).
