# Fractionator

A CLI tool that scans SwiftUI, Jetpack Compose, and Nunjucks prototype codebases and produces a component catalogue — showing what exists, where it's used, how it's parameterised, and what it looks like.

## What it does

Point fractionator at one or more prototype projects and it will:

- **Detect components** — structs conforming to `View` (SwiftUI), `@Composable` functions (Compose), or `{% macro %}` definitions (Nunjucks)
- **Count and locate usages** — every call site across the codebase, with file, line number, and enclosing view/screen
- **Group parameter variants** — cluster call sites by the arguments passed, so you can see how many distinct styles of each component exist (e.g. NHSSection with 11 different border/background colour combinations)
- **Capture screenshots** — render SwiftUI `#Preview` blocks in the iOS Simulator and photograph each one
- **Output a report** — a self-contained HTML page with filterable/sortable component cards, screenshot strips, signature details, and variant breakdowns. Also available as JSON or Markdown.

## Requirements

- **Node.js** 18+
- **Xcode** and an iOS Simulator runtime (for iOS screenshot capture)
- **Android SDK** and a running Android emulator (for Android screenshot capture)
- macOS (iOS screenshot capture uses `xcrun simctl`)

Screenshots are optional — pass `--no-screenshots` to skip the build/capture step entirely. Static analysis (component detection, usage scanning, variant grouping) works without Xcode or Android SDK.

## Install

```bash
# From the repo
npm install
npm link

# Or run directly
node bin/cli.js --ios /path/to/ios-prototype
```

## Usage

Once you've run `link`, if you're already inside a prototype directory, you can just run:

```bash
fractionator
```

It auto-detects the project type (`.xcodeproj` → iOS, `build.gradle` → Android, `.njk` files → web) and runs from there.

You can also point at a prototype from anywhere:

```bash
# Scan an iOS prototype — full analysis with screenshots
fractionator --ios ~/Repos/my-ios-prototype

# Quick analysis without screenshots (no Xcode build, much faster)
fractionator --no-screenshots

# Custom output location and formats
fractionator --output ./my-catalogue --format html,json,md

# Include components that are defined but never used
fractionator --include-unused

# Override the component directory pattern
fractionator --components-dir "**/DesignSystem/**/*.swift"
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--ios <path>` | Path to an iOS/SwiftUI prototype | auto-detect from cwd |
| `--android <path>` | Path to an Android/Compose prototype | auto-detect from cwd |
| `--web <path>` | Path to a web/Nunjucks prototype | auto-detect from cwd |
| `--output <dir>` | Output directory | `catalogue-output/` |
| `--format <formats>` | Comma-separated output formats: `html`, `json`, `md` | `html,json` |
| `--mapping <path>` | Path to a `component-mapping.yaml` for cross-platform alignment | — |
| `--init-mapping` | Generate a starter mapping file from detected components and exit | — |
| `--components-dir <glob>` | Override the component directory pattern | per-platform heuristic |
| `--include-unused` | Include components that are defined but never used | `false` |
| `--no-screenshots` | Skip screenshot capture (static analysis only) | `false` |
| `--no-open` | Don't open the HTML report in a browser when finished | opens by default |

If no `--ios`, `--android`, or `--web` flag is given, fractionator detects the project type from the current directory. When pointing at multiple prototypes explicitly, pass each flag.

When the run finishes, fractionator opens the generated `index.html` in your default browser (using `open` on macOS, `xdg-open` on Linux, `start` on Windows). Pass `--no-open` to suppress this — useful in CI or scripted runs. The report is only opened when the `html` format is produced.

## Output

### HTML report (`index.html`)

A single self-contained page (no server needed) with:

- **Summary stats** — component count, total usages, unused count, single-use count
- **Cross-platform alignment table** — shown when two or more platforms are scanned: which concepts are shared, which names drift between platforms, and which are platform-only (see below)
- **Component cards** — one per component, each showing:
  - Screenshots of rendered previews in a horizontal scrollable strip (click to expand)
  - Platform badge, usage count, variant count
  - Source file path
  - Component signature with parameter names, types, annotations, and defaults
  - "Used in" tags showing which screens reference the component
  - Variant breakdown table (style, count, screens)
- **Filter and sort** — search by name, sort by usage count / name / variant count

### JSON (`catalogue.json`)

The full catalogue as structured data. Useful for feeding into other tools, CI checks, or dashboards.

### Markdown (`catalogue.md`)

A summary table for pasting into documentation or design decision records.

## Cross-platform alignment

When you scan two or more platforms, fractionator matches components across them so you can see what's shared, what's named differently, and what's missing on a platform. Matching runs in three passes:

1. **Manual mapping** from a `component-mapping.yaml` (highest priority)
2. **Exact name match** across platforms
3. **Normalized match** — strips a configurable prefix (default `NHS`) and common suffixes (`UI`, `View`, `Component`), then compares case-insensitively, so `NHSCard` ↔ `NHSCardUI` line up

Anything left over is reported as *platform-only*. Matched concepts whose names differ across platforms are flagged as *name drift*.

Automated matching is deliberately conservative — semantically equivalent components with unrelated names (e.g. iOS `RowLink` ↔ Android `NHSRowItem`) won't match automatically. Capture those in a mapping file:

```bash
# Generate a starter mapping from detected components, then curate it
fractionator --ios ~/ios-proto --android ~/android-proto --init-mapping
# edit catalogue-output/component-mapping.yaml — link concepts, fill in nulls

# Re-run with the curated mapping
fractionator --ios ~/ios-proto --android ~/android-proto \
  --mapping catalogue-output/component-mapping.yaml
```

```yaml
# component-mapping.yaml
mappings:
  - concept: "Row link"
    ios: RowLink
    android: NHSRowItem
  - concept: "Profile / NHS card"
    ios: ProfileCard
    android: NHSCard
```

Mapping entries override automated matches. Names referenced in the mapping but not found in the scan are surfaced in the output so curation mistakes are visible.

## How screenshot capture works

### iOS (SwiftUI)

When scanning an iOS prototype (without `--no-screenshots`), fractionator:

1. Extracts `#Preview { ... }` block bodies from component source files
2. Generates a temporary `FractionatorGallery.swift` containing all previews as switchable cases
3. Injects a launch-argument handler into the app's `WindowGroup` so it can display any preview on demand
4. Builds the app via `xcodebuild` and installs it on the iOS Simulator
5. For each preview: launches the app with a specific argument, waits for it to settle, and captures a screenshot via `simctl io screenshot`
6. Cleans up — removes the generated gallery file and restores the original app entry point

Some iOS previews are automatically skipped:

- **`@Previewable @State`** — this Swift macro expands to property declarations that can't be extracted into a separate file
- **Private types** — previews referencing `private` or `fileprivate` types from the same file (inaccessible from the gallery)
- **Bare `return` statements** — multi-statement preview bodies that can't be wrapped in the gallery's `AnyView()`

### Android (Jetpack Compose)

When scanning an Android prototype (without `--no-screenshots`), fractionator:

1. Scans component files for public `@Preview @Composable` functions
2. Generates a temporary `FractionatorGalleryActivity.kt` that imports and calls each preview function
3. Registers the gallery activity in `AndroidManifest.xml`
4. Builds the app via `./gradlew assembleDebug`
5. Installs the APK on the running Android emulator via `adb`
6. For each preview: launches the gallery activity with an intent extra identifying the preview, waits for it to render, and captures a screenshot via `adb exec-out screencap`
7. Cleans up — removes the generated activity file and restores the original manifest

**Avoiding the splash screen.** Apps typically show a splash screen on every cold start, so capturing each preview from a freshly launched process would photograph the splash instead of the component. To avoid this, the gallery activity is declared `singleTop` and updates on `onNewIntent`, so the process is started **once** (a throwaway warm-up launch absorbs the cold start and its splash on a trivial frame) and every real preview is then a fast warm recomposition. If a preview causes the process to die mid-run, the next capture re-warms first rather than photographing the cold-start splash.

**Known limitation — live/async content.** Components that load remote content (e.g. a `WebView` pointing at a live URL) or run long animations may capture before their content has loaded, showing a blank or partial frame. This depends on network/timing and isn't always reproducible. The warm settle time is tunable in `captureAndroidScreenshots` (`settleMs`) if a particular prototype needs longer.

Android screenshots skip `private` and `internal` preview functions (inaccessible from the gallery activity). Unlike iOS, there are no `@Previewable` limitations — Compose preview functions are standalone, so coverage is typically 90%+.

The tool logs how many previews it found versus how many it captured. Use `--no-screenshots` to skip the entire process if you only need static analysis.

## How component detection works

### SwiftUI

Components are `struct` types conforming to `View` in files matching the component directory glob (default: `**/Components/**/*.swift`). The scanner:

- Strips comments (including nested block comments)
- Finds `struct FooBar: View` declarations
- Extracts stored properties as the component signature, filtering out internal state (`@State`, `@Environment`, `@StateObject`, `private`)
- Scans all `.swift` files for `FooBar(` and `FooBar {` call sites
- Skips self-references (the component's own file) and `#Preview` blocks
- Identifies the enclosing view at each call site

### Jetpack Compose

Components are `@Composable fun` declarations in files matching the component directory glob (default: `**/components/**/*.kt`). The scanner:

- Strips comments (line and block)
- Finds `@Composable fun FooBar(...)` declarations, skipping `@Preview` and `private` functions
- Extracts function parameters as the component signature, with types and default values
- Merges function overloads (e.g. `BadgeIcon` with `ImageVector` and `Painter` variants) into a single entry
- Scans all `.kt` files for `FooBar(` call sites
- Skips self-references and `@Preview` function bodies
- Identifies the enclosing composable at each call site

Screenshot capture requires a running Android emulator — start one from Android Studio or via `emulator -avd <name>` before running fractionator.

### Nunjucks (planned)

`{% macro %}` definitions in `.njk` files, with parameter keys inferred from call-site object literals.

## Project structure

```
bin/cli.js                        CLI entry point + project auto-detection
src/
  index.js                        Pipeline orchestrator
  swift-component-scanner.js      SwiftUI struct detection + signature extraction
  swift-screenshot-capture.js     #Preview screenshot capture via simctl
  kotlin-component-scanner.js     Compose @Composable detection + signature extraction
  kotlin-screenshot-capture.js    @Preview screenshot capture via adb + gallery activity
  usage-scanner.js                Call-site detection across source files (multi-language)
  variant-grouper.js              Group usages by parameter combinations
  cross-platform-matcher.js       Match components across platforms (exact + normalized + mapping)
  mapping-loader.js               Load + validate component-mapping.yaml
  mapping-generator.js            Generate a starter component-mapping.yaml (--init-mapping)
  build-report.js                 HTML / JSON / Markdown output
docs/
  plans/component-catalogue.md    Full plan with status and design decisions
```
