# Plan — Component catalogue tool

> A CLI tool that scans native (SwiftUI / Jetpack Compose) and web (Nunjucks) prototype codebases, detects component definitions and usage, and outputs a cross-platform catalogue showing what exists, where it's used, how it's parameterised, and where naming drifts between platforms.

## Problem

When multiple prototypes implement the same product (e.g. an iOS prototype, an Android prototype, and a web prototype), the component libraries evolve independently. Components get named differently, parameterised differently, or exist on one platform but not another. There's no easy way to see:

- What components exist across all prototypes
- Which are shared concepts with different names (iOS `RowLink` ↔ Android `NHSRowItem`)
- Which exist on one platform but are missing from another
- How many times each component is used and where
- What parameter variants are in play (e.g. `NHSSection` called with 5 different border colour configurations)

This information currently lives in designers' heads. A catalogue makes it visible and reviewable.

## Goal

```bash
npx component-catalogue \
  --ios ~/Repos/nhsapp-ios-demo-v2 \
  --android ~/Repos/native-nhsapp-android-prototype/NHSAppNativeProto \
  --web ~/Repos/nhsapp-prototype \
  --output catalogue-output/
```

Outputs a self-contained HTML report showing every component across all provided prototypes, with usage counts, call-site locations, parameter variants, and a cross-platform alignment summary.

## What counts as a "component"

### SwiftUI (iOS)

A `struct` conforming to `View` that lives in a designated components directory or module. In the iOS prototype this is `Components/` — containing ~65 components like `RowLink`, `NHSSection`, `ProfileCard`, `CampaignCard`, `HubHeader`, form elements (`Radios`, `Toggle`, `TextArea`), and layout helpers (`PageHeading`, `SectionHeader`).

**Detection:** find `struct FooBar: View` (or `: some View`) declarations. Filter to files in component-like paths (configurable, default: `**/Components/**/*.swift`).

**Signature extraction:** read the struct's stored properties (`let`, `var`, `@Binding`, `@State`) and `init` parameters. These define the component's public API.

**Usage detection:** find `FooBar(` and `FooBar {` call sites in `.swift` files outside the component's own file. Extract the arguments passed at each call site.

### Jetpack Compose (Android)

A `@Composable` function that lives in a design system module or components package. In the Android prototype this is `nhsappdesignsystem/` — currently containing `NHSCard`, `NHSRowItem`, and `BadgeIcon`.

**Detection:** find `@Composable fun FooBar(...)` declarations. Filter to files in component-like paths (configurable, default: `**/components/**/*.kt` or a named module).

**Signature extraction:** read the function's parameter list directly from the declaration.

**Usage detection:** find `FooBar(` call sites in `.kt` files outside the component's own file. Extract arguments.

### Nunjucks (Web)

A `{% macro fooBar(params) %}` definition, either in the prototype's own `components/` directory or imported from `nhsuk-frontend`. In the web prototype, custom macros include `interruptionCard`, `relatedContentCard`, and `dynamicPageTitle`, plus the full `nhsuk-frontend` library (`button`, `card`, `radios`, `input`, `backLink`, etc.).

**Detection:** find `{% macro fooBar(params) %}` in `.njk` files, and `{{ fooBar({...}) }}` call patterns in `.html`/`.njk` templates.

**Signature extraction:** Nunjucks macros typically take a single `params` object. The "signature" is the set of param keys observed across all call sites (e.g. `button` is called with `text`, `classes`, `href`).

**Usage detection:** find `{{ fooBar(` and `{% call fooBar(` patterns in template files.

## Output

### HTML report

A single `index.html` (self-contained, no server needed) with:

**1. Component table (per platform)**

| Component | Platform | Module/Path | Usages | Screens | Signature |
|-----------|----------|-------------|--------|---------|-----------|
| NHSSection | iOS | Components/Section.swift | 14 | HomeView, ProfileView, HealthConditionsView, ... | `borderColor: Color`, `borderWidth: CGFloat`, `backgroundColor: Color`, ... |
| RowLink | iOS | Components/RowLink.swift | 12 | HealthConditionsView, VaccinationsView, ... | `title: String`, `horizontalPadding: CGFloat`, `destination: View` |
| NHSCard | Android | nhsappdesignsystem/.../NHSCard.kt | 1 | HomeScreen | `nhsCard: NHSCardUI` |
| button | Web | nhsuk-frontend | 8 | messages-linked-profiles, logged-out, ... | `text`, `classes`, `href` |

Sortable by name, usage count, or platform. Filterable.

**2. Parameter variant breakdown**

For each component, show the distinct parameter combinations observed across call sites:

```
NHSSection — 14 usages, 4 parameter variants:
  ├─ default (borderColor: .nhsWhite, backgroundColor: .nhsWhite) — 8 usages
  ├─ info callout (borderColor: .nhsAppPaleBlue, backgroundColor: .nhsAppPaleBlue) — 3 usages
  ├─ warning (borderColor: .nhsYellow, backgroundColor: .nhsAppPaleYellow) — 2 usages
  └─ critical (borderColor: .nhsRed, backgroundColor: .nhsAppPaleRed) — 1 usage
```

Variants are grouped by the parameter values that differ from defaults. Parameters that are always the same across call sites are collapsed.

**3. Cross-platform alignment table**

| Concept | iOS | Android | Web | Status |
|---------|-----|---------|-----|--------|
| Row/list item link | `RowLink` | `NHSRowItem` | — | Name drift |
| Section container | `NHSSection` | — | — | iOS only |
| Profile card | `ProfileCard` | `NHSCard` | — | Name drift |
| Campaign card | `CampaignCard` | — | — | iOS only |
| Badge icon | — | `BadgeIcon` | — | Android only |
| Button | — | — | `button` | Web only |

This table requires a mapping file (see below) because automated name matching can only go so far.

**4. Coverage summary**

Per-platform statistics:
- Total components defined / total used at least once
- Components defined but never used (dead code)
- Most-used components (top 10)
- Components used on only one screen (candidates for inlining)

### JSON output

The full catalogue as `catalogue.json` for programmatic consumption — feeding into other tools, CI checks, or dashboards.

### Markdown output (optional)

A `catalogue.md` for pasting into documentation or design decision records.

## Cross-platform mapping

Automated matching can catch:
- Exact name matches (`BadgeIcon` ↔ `BadgeIcon`)
- Prefix-stripped matches (`NHSCard` ↔ `NHSCardUI` → both map to "Card")

But semantic equivalences (`RowLink` ↔ `NHSRowItem`) need a manual mapping file:

```yaml
# component-mapping.yaml
mappings:
  - concept: "Row link"
    ios: RowLink
    android: NHSRowItem

  - concept: "Profile / NHS card"
    ios: ProfileCard
    android: NHSCard

  - concept: "Section container"
    ios: NHSSection
    android: null        # not yet implemented
    web: null

  - concept: "Campaign card"
    ios: CampaignCard
    android: null
```

The tool:
1. Runs automated matching first (exact + prefix stripping).
2. Applies the manual mapping file on top.
3. Reports unmatched components as "platform-only" for review.
4. On first run against a new set of prototypes, can generate a starter mapping file with its best guesses, which the team then curates.

## Component detection: depth and limitations

### What works well with regex-based parsing

- **Finding definitions** — `struct Foo: View`, `@Composable fun Foo(`, `{% macro foo(` are unambiguous patterns. Very high accuracy.
- **Finding call sites** — `FooBar(` in source files outside the definition. High accuracy for counting usages and identifying which screens use a component.
- **Extracting simple parameters** — `RowLink(title: "Allergies and adverse reactions")` parses cleanly. Single-line call sites with named parameters work well.

### What's harder

- **Multi-line trailing closures** — `NHSSection { ... } header: { ... }` spans many lines. Counting usages is fine (match the opening `NHSSection(`), but extracting the full argument list requires brace-depth tracking. Quiver's parsers already do this (`extractClosureAt`), so the technique is proven but non-trivial.
- **Computed/variable arguments** — `NHSCard(viewModel.cardData)` tells you the component is used but not what the concrete values are. The tool can report "dynamic argument" without trying to resolve it.
- **Conditional usage** — `if showCard { NHSCard(...) }` is still a usage, but the tool can't know whether it's always rendered. Count it as a usage with a note.
- **Re-exports and type aliases** — if a component is wrapped or aliased, the tool won't automatically connect the wrapper to the underlying component.

### What doesn't work (and shouldn't be attempted)

- **Runtime type resolution** — determining which concrete `View` a generic parameter resolves to at runtime. Not feasible with static analysis.
- **Compose `@Preview` parameter extraction** — previews often construct components with sample data via helper functions. Extracting the "real" parameter variants from preview code would be misleading.

## CLI interface

```
npx component-catalogue [options]

Sources (at least one required):
  --ios <path>             Path to iOS/SwiftUI prototype
  --android <path>         Path to Android/Compose prototype
  --web <path>             Path to web/Nunjucks prototype

Options:
  --output <dir>           Output directory (default: catalogue-output/)
  --format html,json,md    Output formats, comma-separated (default: html,json)
  --mapping <path>         Path to component-mapping.yaml (default: <output>/component-mapping.yaml)
  --init-mapping           Generate a starter mapping file from auto-detected components and exit
  --components-dir <glob>  Override component directory pattern (default: per-platform heuristic)
  --include-unused         Include components defined but never used (default: false)
```

### Typical workflows

```bash
# First run — generate starter mapping, then curate it
npx component-catalogue --ios ~/ios-proto --android ~/android-proto --init-mapping
# Edit catalogue-output/component-mapping.yaml to fix matches
# Then run for real
npx component-catalogue --ios ~/ios-proto --android ~/android-proto

# Single-platform audit
npx component-catalogue --ios ~/ios-proto

# All three platforms
npx component-catalogue \
  --ios ~/ios-proto \
  --android ~/android-proto \
  --web ~/web-proto \
  --mapping ./component-mapping.yaml
```

## Architecture

```
bin/cli.js                      CLI entry point (Commander)
src/
  swift-component-scanner.js    Find View structs + extract signatures
  kotlin-component-scanner.js   Find @Composable funs + extract signatures
  nunjucks-component-scanner.js Find macro definitions + extract param keys
  usage-scanner.js              Find call sites across all source files
  variant-grouper.js            Group call-site arguments into distinct variants
  cross-platform-matcher.js     Auto-match + apply mapping file
  build-report.js               Generate HTML/JSON/MD output
  mapping-generator.js          Generate starter component-mapping.yaml
```

No shared code with Quiver. The scanners are simpler than Quiver's parsers (no navigation graph construction, no route resolution, no seed-data tracking) but different in shape (component-centric rather than screen-centric).

## Implementation phases

### Phase 1 — Single-platform iOS catalogue

Start with iOS because it has the richest component library (~65 components) and the most usage data:

1. **Swift component scanner** — find `struct Foo: View` in component directories, extract stored properties as signature.
2. **Usage scanner** — find call sites across all `.swift` files, extract file + line + raw argument text.
3. **Variant grouper** — cluster call sites by the parameter values that differ from defaults.
4. **HTML report** — component table + variant breakdown + usage locations.
5. **JSON output** — full catalogue data.

### Phase 2 — Android support

6. **Kotlin component scanner** — find `@Composable fun Foo(` in design system modules, extract parameter list.
7. **Usage scanner for Kotlin** — same pattern as iOS but for `.kt` files.

### Phase 3 — Cross-platform alignment

8. **Auto-matcher** — exact name + prefix stripping.
9. **Mapping file** — `component-mapping.yaml` format, `--init-mapping` generator.
10. **Alignment table in report** — matched pairs, platform-only, name drift.

### Phase 4 — Web support

11. **Nunjucks component scanner** — find `{% macro %}` definitions, including from `nhsuk-frontend`.
12. **Usage scanner for Nunjucks** — find `{{ macro({...}) }}` patterns in templates.
13. **Param-key extraction** — since Nunjucks macros take a params object, extract keys from call-site object literals.

### Phase 5 — Polish

14. **Coverage summary** — unused components, most-used, single-screen components.
15. **Markdown output** — for design documentation.
16. **Diff mode** — run against two points in time (branches/commits) and highlight what changed in the catalogue. New components, removed components, usage count changes.
17. **CI integration** — exit code for "component exists on iOS but not Android" checks, configurable via the mapping file.

## Design decisions

**Why not inside Quiver?** Quiver's parsers extract navigation structure (routes, navigate() calls, NavHost registrations). A component catalogue extracts component definitions and call-site usage. The parse targets don't overlap, the data model is different (flat table vs. directed graph), and the output is different (report vs. interactive map). The only shared element is "reads Swift/Kotlin files," which isn't enough to justify coupling them.

**Why regex-based parsing rather than a proper AST?** Swift and Kotlin AST parsers exist (swift-syntax, KSP/KAPT) but they're heavyweight, language-specific, and require compilation infrastructure. Regex parsing with brace-depth tracking (the same approach Quiver uses successfully) handles the detection and signature extraction cases well enough. The main sacrifice is that multi-line argument extraction is approximate — acceptable for a catalogue tool where 80-90% accuracy on parameter variants is useful, and the remaining cases can be flagged as "complex/dynamic."

**Why a manual mapping file for cross-platform alignment?** Automated semantic matching (e.g. "RowLink and NHSRowItem serve the same purpose") would require understanding what components do, not just what they're called. A curated mapping file is honest about this limitation and gives the team a reviewable, version-controlled artifact that captures their design intent. The `--init-mapping` generator reduces the initial effort by pre-populating obvious matches.

**Why start with iOS?** It has the most components (~65 vs. Android's 3 vs. web's ~3 custom + nhsuk-frontend library). Building the scanner against a rich component library surfaces edge cases early and produces the most immediately useful output.

**Why include web/Nunjucks support?** Although the component model is different (macros vs. structs/functions), the catalogue question is the same: what exists, where is it used, how is it parameterised. Including web makes the cross-platform alignment table complete. The Nunjucks scanner is simpler than the native scanners because macros have a uniform `(params)` signature.
