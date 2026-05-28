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
- macOS (screenshot capture uses `xcrun simctl`)

Screenshots are optional — pass `--no-screenshots` to skip the build/capture step entirely. Static analysis (component detection, usage scanning, variant grouping) works without Xcode.

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

If no `--ios`, `--android`, or `--web` flag is given, fractionator detects the project type from the current directory. When pointing at multiple prototypes explicitly, pass each flag.

## Output

### HTML report (`index.html`)

A single self-contained page (no server needed) with:

- **Summary stats** — component count, total usages, unused count, single-use count
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

## How screenshot capture works

When scanning an iOS prototype (without `--no-screenshots`), fractionator:

1. Extracts `#Preview { ... }` block bodies from component source files
2. Generates a temporary `FractionatorGallery.swift` containing all previews as switchable cases
3. Injects a launch-argument handler into the app's `WindowGroup` so it can display any preview on demand
4. Builds the app via `xcodebuild` and installs it on the iOS Simulator
5. For each preview: launches the app with a specific argument, waits for it to settle, and captures a screenshot via `simctl io screenshot`
6. Cleans up — removes the generated gallery file and restores the original app entry point

Some previews are automatically skipped:

- **`@Previewable @State`** — this Swift macro expands to property declarations that can't be extracted into a separate file
- **Private types** — previews referencing `private` or `fileprivate` types from the same file (inaccessible from the gallery)
- **Bare `return` statements** — multi-statement preview bodies that can't be wrapped in the gallery's `AnyView()`

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

### Jetpack Compose (planned)

`@Composable fun` declarations in component packages, with parameter lists extracted directly from function signatures.

### Nunjucks (planned)

`{% macro %}` definitions in `.njk` files, with parameter keys inferred from call-site object literals.

## Project structure

```
bin/cli.js                        CLI entry point
src/
  index.js                        Pipeline orchestrator
  swift-component-scanner.js      SwiftUI struct detection + signature extraction
  swift-screenshot-capture.js     #Preview screenshot capture via simctl
  usage-scanner.js                Call-site detection across source files
  variant-grouper.js              Group usages by parameter combinations
  build-report.js                 HTML / JSON / Markdown output
docs/
  plans/component-catalogue.md    Full plan with status and design decisions
```
