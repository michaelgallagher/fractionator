# Usage

Full CLI reference, examples, display-trait variations, and output formats.

## Running

After `npm link`, run from inside a prototype directory to auto-detect the
project type (`.xcodeproj` → iOS, `build.gradle` → Android, `.njk` → web):

```bash
fractionator
```

Or point at a prototype from anywhere:

```bash
# iOS prototype — full analysis with screenshots
fractionator --ios ~/Repos/my-ios-prototype

# Quick static analysis (no Xcode/Gradle build, much faster)
fractionator --no-screenshots

# Custom output location and formats
fractionator --output ./my-catalogue --format html,json,md

# Include components defined but never used
fractionator --include-unused

# Override the component directory pattern
fractionator --components-dir "**/DesignSystem/**/*.swift"
```

If no `--ios`/`--android`/`--web` flag is given, the project type is detected
from the current directory. To scan multiple prototypes at once, pass each flag.

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--ios <path>` | Path to an iOS/SwiftUI prototype | auto-detect from cwd |
| `--android <path>` | Path to an Android/Compose prototype | auto-detect from cwd |
| `--web <path>` | Path to a web/Nunjucks prototype | auto-detect from cwd |
| `--output <dir>` | Output directory | `catalogue-output/` |
| `--format <formats>` | Comma-separated: `html`, `json`, `md` | `html,json` |
| `--mapping <path>` | A `component-mapping.yaml` for cross-platform alignment | — |
| `--init-mapping` | Generate a starter mapping file and exit | — |
| `--components-dir <glob>` | Override the component directory pattern | per-platform heuristic |
| `--include-unused` | Include components defined but never used | `false` |
| `--variations <list>` | Also capture under display traits: `dark`, `type`, `contrast` (or `all`) | baseline only |
| `--no-screenshots` | Skip screenshot capture (static analysis only) | `false` |
| `--no-open` | Don't open the HTML report when finished | opens by default |

When the run finishes, the generated `index.html` opens in your default browser
(`open` on macOS, `xdg-open` on Linux, `start` on Windows). `--no-open`
suppresses this — useful in CI. The report only opens when the `html` format is
produced.

## Display-trait variations

By default each preview is captured once, in a baseline appearance. `--variations`
also captures every preview under one or more accessibility/appearance traits:

```bash
# baseline + dark mode + large Dynamic Type + high contrast
fractionator --variations dark,type,contrast

# shorthand for all three
fractionator --variations all
```

| Mode | What it sets | iOS | Android |
|------|--------------|-----|---------|
| `dark` | Dark appearance | `simctl ui appearance dark` | `cmd uimode night yes` |
| `type` | Largest Dynamic Type / font scale | `content_size accessibility-extra-extra-extra-large` | `font_scale 2.0` |
| `contrast` | Increased contrast | `increase_contrast enabled` | `high_text_contrast_enabled 1` |

Each mode pins **all** of these axes to fixed values, so a variation isolates a
single axis against a known baseline regardless of the device's prior state. The
traits are applied as global OS overrides — the app is built **once** and each
mode is an outer loop over the same previews, so no rebuild happens between modes.

The baseline shot keeps its original filename (`<id>.png`); other modes add a
suffix (`<id>__dark.png`). In the HTML report, previews with variations are
grouped by preview name with one image per mode.

Two things to keep in mind:

- **Cost is multiplicative** — `previews × modes` captures. With ~60 previews,
  `--variations all` is ~240 screenshots. It's opt-in for that reason.
- **Device state is captured and restored.** Fractionator snapshots the
  simulator/emulator's current appearance, type-size, and contrast settings before
  capture and restores them afterwards — it does not assume defaults. (Variations
  apply to iOS and Android only.)

## Output formats

### HTML report (`index.html`)

A single self-contained page (no server needed). See
[output.md](output.md) for the full anatomy — component cards, the **Showcases**
tab, preview-status badges, the **Style tokens** tab, and the cross-platform
alignment table.

### JSON (`catalogue.json`)

The full catalogue as structured data — per-platform components (with usages,
variants, screenshots, `appearsIn`), `showcases`, and `tokens`. Useful for CI
checks, dashboards, or feeding other tools.

### Markdown (`catalogue.md`)

A summary table for pasting into documentation or design decision records.
