# Plan — Component catalogue tool

> A CLI tool that scans native (SwiftUI / Jetpack Compose) and web (Nunjucks) prototype codebases, detects component definitions and usage, and outputs a cross-platform catalogue showing what exists, where it's used, how it's parameterised, and where naming drifts between platforms.

## Problem

When multiple prototypes implement the same product (e.g. an iOS prototype, an Android prototype, and a web prototype), the component libraries evolve independently. Components get named differently, parameterised differently, or exist on one platform but not another. There's no easy way to see:

- What components exist across all prototypes
- Which are shared concepts with different names (iOS `RowLink` ↔ Android `NHSRowItem`)
- Which exist on one platform but are missing from another
- How many times each component is used and where
- What parameter variants are in play (e.g. `NHSSection` called with 11 different style configurations)
- What components actually look like — their rendered appearance in different configurations

This information currently lives in designers' heads. A catalogue makes it visible and reviewable.

## Goal

```bash
fractionator \
  --ios ~/Repos/nhsapp-ios-demo-v2 \
  --android ~/Repos/native-nhsapp-android-prototype/NHSAppNativeProto \
  --web ~/Repos/nhsapp-prototype \
  --output catalogue-output/
```

Outputs a self-contained HTML report showing every component across all provided prototypes, with screenshots, usage counts, call-site locations, parameter variants, and a cross-platform alignment summary.

## Status

### Phase 1 — iOS catalogue: ✅ complete

Working end-to-end. Running against the NHS App iOS prototype (`nhsapp-ios-demo-v2`) produces:

- **37 components** detected in `Components/` directory
- **278 total usages** across 135 Swift files
- **25 preview screenshots** captured from 14 components (see limitations below)
- **Variant grouping** — e.g. NHSSection shows 11 distinct parameter combinations
- **HTML report** — filterable/sortable component cards with screenshot strips, signatures, usage locations, variant breakdown tables. Click-to-expand lightbox for screenshots. Dark mode support.
- **JSON output** — full structured data for programmatic consumption

### Phase 2 — Android catalogue: ✅ complete

Static analysis working end-to-end. Running against the NHS App Android prototype (`NHSAppNativeProto`) produces:

- **3 components** detected in `nhsappdesignsystem/.../components/`
- **3 total usages** across 21 Kotlin files
- **Function overload handling** — `BadgeIcon` has 2 overloads (ImageVector and Painter variants), merged into one catalogue entry
- **Variant grouping** — correctly parses both Kotlin `name = value` and Swift `name: value` named-argument syntax
- **Combined report** — iOS and Android components appear together in the same HTML/JSON output, distinguished by platform badges

Screenshot capture is now implemented for Android — generates a gallery activity, builds via Gradle, and captures via `adb screencap`.

### What we learned building Phase 1 and 2

**Component detection works well.** The regex-based `struct Foo: View` scanner with brace-depth tracking is reliable. Comment stripping (including nested `/* */` blocks) prevents false matches. Filtering to `**/Components/**/*.swift` (or a configurable glob) gives the right set.

**Signature extraction has good coverage.** Stored properties (`let`, `var`, `@Binding`, `@ObservedObject`) are extracted with types and default values. Filtering out internal state (`@State`, `@Environment`, `@StateObject`, `private`) correctly narrows to the "public API." Generic type parameters (e.g. `Content: View`) are captured.

**Usage scanning is accurate.** Building a single regex from all component names and scanning all Swift files catches call sites reliably. Skipping the component's own file and `#Preview` blocks avoids self-references inflating counts. Enclosing-view detection (finding the nearest `struct Foo: View` around a call site) identifies which screens use each component.

**Variant grouping produces meaningful labels.** Parsing named arguments from call sites (`borderColor: .nhsAppPaleBlue, borderWidth: 0`) and clustering by parameter combinations works well. The labelling heuristic (strip enum dots, shorten `Color.` prefix, show first 2-3 params) produces readable variant names like `"borderColor: nhsAppPaleBlue, borderWidth: 0, backgroundColor: nhsAppPaleBlue"`.

**Screenshot capture required significant iteration.** The approach — extract `#Preview` bodies into a generated gallery file, inject a launch-arg handler into the app entry point, build, and capture via simctl — works but encountered three categories of build failure:

1. **`@Previewable @State` declarations** — Swift's `@Previewable` macro expands to property declarations that aren't valid inside `AnyView()` expression context. **Fix:** filter out previews containing `@Previewable`.
2. **Private/fileprivate types** — preview bodies that reference `private struct SampleContentView` (helpers declared in the same file) fail when extracted into the gallery file because the types are inaccessible. **Fix:** collect `private`/`fileprivate` type names from each file and skip previews that reference them.
3. **SceneBuilder limitations** — `@SceneBuilder` (used in `var body: some Scene`) doesn't support `if/else` control flow. The injection had to be moved inside the `WindowGroup` closure, which uses `@ViewBuilder` and does support conditionals. A private helper enum extracts the preview ID from launch arguments.

**Preview coverage is partial but useful.** Of 37 components, 14 have compatible previews (25 screenshots total). The rest either lack `#Preview` blocks or use `@Previewable @State` bindings. This is an inherent limitation: `@Previewable` previews are designed for Xcode's live preview system and use compiler magic that can't be replicated by extracting the body into a separate file. Still, 50%+ coverage with zero manual work is valuable.

**Kotlin component scanning translated cleanly from the Swift approach.** `@Composable fun Foo(...)` is as unambiguous as `struct Foo: View`. The main differences are parameter extraction (function params vs. stored properties) and comment stripping (Kotlin doesn't have nested block comments). The same usage scanner works for both languages with a pluggable language config (comment stripper, enclosing-view detector, preview-block detector).

**Function overloads need merging.** Compose allows multiple `@Composable fun BadgeIcon(...)` declarations with different parameter types (e.g. `ImageVector` vs `Painter`). The scanner detects all overloads and merges them into a single catalogue entry, keeping the first overload's signature as primary and recording the overload count.

**Variant grouper needed dual syntax support.** Swift uses `name: value` for named arguments; Kotlin uses `name = value`. The variant grouper now tries both patterns when parsing call-site arguments, which means it works correctly for both platforms without a language flag.

**The usage scanner generalises well.** By parameterising the four language-specific functions (comment stripping, enclosing-view detection, preview detection, file extension), the same scanner handles both Swift and Kotlin. The core logic (build a regex from component names, scan files, extract arguments) is language-agnostic.

**Auto-detection from the current directory works.** The CLI now detects the project type from root-level markers (`.xcodeproj` → iOS, `build.gradle` → Android, `.njk` files → web), so users can run `fractionator` with no flags from inside a prototype.

**Android screenshot capture is simpler than iOS.** Compose `@Preview` functions are zero-argument standalone composables, so we can call them by name from a generated gallery activity — no need to extract and re-wrap preview bodies like iOS. The gallery imports each public preview function and uses a `when` expression to select the right one based on an intent extra. This avoids the iOS issues with `@Previewable`, `AnyView()` wrapping, and `SceneBuilder` limitations.

**Private preview functions are the main skip category on Android.** Of 82 preview annotations in DemoNHSApp2's component files, 8 are private (inaccessible from the gallery activity). Unlike iOS where ~50% of previews are skipped due to `@Previewable`, Android preview coverage is ~90%+.

**applicationId can differ from the Kotlin package.** The `applicationId` in `build.gradle.kts` (`com.prototype.nhsappnotabs`) is used by adb for app launching and force-stop, while the Kotlin package (`com.prototype.nhsappnotab`) is used for class resolution. The gallery activity needs both: the applicationId for adb commands and the full class name (`package.ActivityName`) for intent component resolution.

## What counts as a "component"

### SwiftUI (iOS)

A `struct` conforming to `View` that lives in a designated components directory or module. In the iOS prototype this is `Components/` — containing ~37 components like `RowLink`, `NHSSection`, `CampaignCard`, `HubPageIconView`, form elements (`NHSTextEditor`, `SelectionCircle`, `RadioButtonRow`), and layout helpers (`PageHeading`, `FlowPage`).

**Detection:** find `struct FooBar: View` (or `: some View`) declarations. Filter to files in component-like paths (configurable, default: `**/Components/**/*.swift`). Strip comments (including nested block comments) before scanning.

**Signature extraction:** read the struct's stored properties (`let`, `var`, `@Binding`, `@ObservedObject`) excluding internal state (`@State`, `@Environment`, `@StateObject`, `private`, `static`). These define the component's public API.

**Usage detection:** find `FooBar(` and `FooBar {` call sites in `.swift` files outside the component's own file and outside `#Preview` blocks. Extract the arguments passed at each call site and the enclosing view name.

**Screenshot capture:** extract `#Preview` block bodies, generate a gallery file with all previews as `AnyView()`-wrapped switch cases, inject a launch-arg handler into the app's `WindowGroup`, build via xcodebuild, and capture each preview via `simctl io screenshot`. Previews using `@Previewable`, bare `return` statements, `$binding` references, or private types are automatically excluded.

### Jetpack Compose (Android)

A `@Composable` function that lives in a design system module or components package. In the Android prototype this is `nhsappdesignsystem/` — currently containing `NHSCard`, `NHSRowItem`, and `BadgeIcon`.

**Detection:** find `@Composable fun FooBar(...)` declarations. Filter to files in component-like paths (configurable, default: `**/components/**/*.kt` or a named module).

**Signature extraction:** read the function's parameter list directly from the declaration.

**Usage detection:** find `FooBar(` call sites in `.kt` files outside the component's own file. Extract arguments.

**Screenshot capture:** Compose `@Preview` functions are standalone zero-argument `@Composable` functions — simpler than SwiftUI's `#Preview` blocks. The tool generates a `FractionatorGalleryActivity` that imports all public preview functions and switches on a preview ID passed via intent extra. It registers the activity in `AndroidManifest.xml`, builds via `./gradlew assembleDebug`, installs on the emulator via `adb`, and captures each preview via `adb exec-out screencap -p`. Private preview functions are skipped (inaccessible from the generated activity). The `@Previewable` issue doesn't exist in Compose — all non-private preview functions are capturable.

### Nunjucks (Web)

A `{% macro fooBar(params) %}` definition, either in the prototype's own `components/` directory or imported from `nhsuk-frontend`. In the web prototype, custom macros include `interruptionCard`, `relatedContentCard`, and `dynamicPageTitle`, plus the full `nhsuk-frontend` library (`button`, `card`, `radios`, `input`, `backLink`, etc.).

**Detection:** find `{% macro fooBar(params) %}` in `.njk` files, and `{{ fooBar({...}) }}` call patterns in `.html`/`.njk` templates.

**Signature extraction:** Nunjucks macros typically take a single `params` object. The "signature" is the set of param keys observed across all call sites (e.g. `button` is called with `text`, `classes`, `href`).

**Usage detection:** find `{{ fooBar(` and `{% call fooBar(` patterns in template files.

**Screenshot capture (planned):** render each macro with its observed parameter combinations in an isolated HTML page, capture via Playwright/headless Chrome. This is simpler than the native approaches — no build step, no simulator.

## Output

### HTML report

A single `index.html` (self-contained, no server needed) with:

**1. Summary statistics** — component count, total usages, unused count, single-use count.

**2. Component cards** — one per component, containing:
- Screenshot strip (horizontal scrolling, click-to-expand lightbox) showing rendered preview variants
- Platform badge, usage count, variant count
- File path
- Signature with parameter names, types, annotations (`@Binding`, `@ObservedObject`), and default values
- "Used in" screen tags (extracted from enclosing view names)
- Variant breakdown table (style label, count, screens)

Cards are filterable (text search on name/platform) and sortable (most used, least used, name, most variants).

**3. Cross-platform alignment table** (Phase 3) — matched pairs, platform-only, name drift.

**4. Coverage summary** — unused components, most-used, single-screen components.

### JSON output

The full catalogue as `catalogue.json` for programmatic consumption — feeding into other tools, CI checks, or dashboards.

### Markdown output (optional)

A `catalogue.md` table for pasting into documentation or design decision records.

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
- **Multi-line argument extraction** — brace-depth tracking (splitting on top-level commas, respecting nested parens/braces/strings) works for the majority of call sites. Proven in Phase 1.

### What's harder

- **Computed/variable arguments** — `NHSCard(viewModel.cardData)` tells you the component is used but not what the concrete values are. The tool reports "dynamic argument" without trying to resolve it.
- **Conditional usage** — `if showCard { NHSCard(...) }` is still a usage, but the tool can't know whether it's always rendered. Counted as a usage.
- **Re-exports and type aliases** — if a component is wrapped or aliased, the tool won't automatically connect the wrapper to the underlying component.
- **`@Previewable @State` previews** — these use a Swift macro that expands to property declarations, which can't be extracted into a separate file context. These previews are skipped for screenshot capture (~50% of previews in the iOS prototype use this pattern).
- **Private helper types in previews** — preview bodies that reference `private struct`/`fileprivate class` types from the same file can't be extracted into the gallery file. These are detected and skipped.

### What doesn't work (and shouldn't be attempted)

- **Runtime type resolution** — determining which concrete `View` a generic parameter resolves to at runtime. Not feasible with static analysis.
- **Extracting parameter variants from previews** — previews often construct components with sample data via helper functions. The real parameter variants come from actual call sites, not preview code.

## CLI interface

```
fractionator [options]

Sources (at least one required):
  --ios <path>             Path to iOS/SwiftUI prototype
  --android <path>         Path to Android/Compose prototype
  --web <path>             Path to web/Nunjucks prototype

Options:
  --output <dir>           Output directory (default: catalogue-output/)
  --format html,json,md    Output formats, comma-separated (default: html,json)
  --mapping <path>         Path to component-mapping.yaml
  --init-mapping           Generate a starter mapping file from auto-detected components and exit
  --components-dir <glob>  Override component directory pattern (default: per-platform heuristic)
  --include-unused         Include components defined but never used (default: false)
  --no-screenshots         Skip screenshot capture (static analysis only)
```

### Typical workflows

```bash
# Single-platform audit with screenshots
fractionator --ios ~/ios-proto

# Quick analysis without screenshots (faster, no build step)
fractionator --ios ~/ios-proto --no-screenshots

# First run — generate starter mapping, then curate it
fractionator --ios ~/ios-proto --android ~/android-proto --init-mapping
# Edit catalogue-output/component-mapping.yaml to fix matches
# Then run for real
fractionator --ios ~/ios-proto --android ~/android-proto

# All three platforms
fractionator \
  --ios ~/ios-proto \
  --android ~/android-proto \
  --web ~/web-proto \
  --mapping ./component-mapping.yaml
```

## Architecture

```
bin/cli.js                        CLI entry point (Commander) + project auto-detection
src/
  index.js                        Pipeline orchestrator (iOS + Android)
  swift-component-scanner.js      Find View structs + extract signatures
  swift-screenshot-capture.js     Capture #Preview screenshots via simctl
  kotlin-component-scanner.js     Find @Composable funs + extract signatures + merge overloads
  kotlin-screenshot-capture.js    Capture @Preview screenshots via adb + gallery activity
  usage-scanner.js                Find call sites across source files (language-agnostic with config)
  variant-grouper.js              Group call-site arguments into distinct variants (Swift + Kotlin syntax)
  build-report.js                 Generate HTML/JSON/MD output
  nunjucks-component-scanner.js   [Phase 4] Find macro definitions + param keys
  cross-platform-matcher.js       [Phase 3] Auto-match + apply mapping file
  mapping-generator.js            [Phase 3] Generate starter component-mapping.yaml
```

No shared code with Quiver. The scanners are simpler than Quiver's parsers (no navigation graph construction, no route resolution, no seed-data tracking) but different in shape (component-centric rather than screen-centric). The screenshot pipeline shares the same simctl-based approach but targets individual component previews rather than navigation routes.

## Implementation phases

### Phase 1 — Single-platform iOS catalogue ✅

1. ~~**Swift component scanner** — find `struct Foo: View` in component directories, extract stored properties as signature.~~
2. ~~**Usage scanner** — find call sites across all `.swift` files, extract file + line + raw argument text.~~
3. ~~**Variant grouper** — cluster call sites by the parameter values that differ from defaults.~~
4. ~~**Screenshot capture** — extract `#Preview` bodies, build gallery, capture via simctl.~~
5. ~~**HTML report** — component cards with screenshots, signatures, usage locations, variant breakdown.~~
6. ~~**JSON output** — full catalogue data.~~

### Phase 2 — Android support ✅

7. ~~**Kotlin component scanner** — find `@Composable fun Foo(` in design system modules, extract parameter list. Handle function overloads by merging into single entries.~~
8. ~~**Usage scanner for Kotlin** — generalised the existing scanner with a pluggable language config (comment stripping, enclosing-view detection, preview detection).~~
9. ~~**Variant grouper dual syntax** — parse both `name: value` (Swift) and `name = value` (Kotlin) named-argument syntax.~~
10. ~~**Compose screenshot capture** — generate a gallery activity importing all public @Preview functions, register in AndroidManifest.xml, build via Gradle, capture via `adb exec-out screencap -p`. Private preview functions are automatically skipped.~~

### Phase 3 — Cross-platform alignment

10. **Auto-matcher** — exact name + prefix stripping.
11. **Mapping file** — `component-mapping.yaml` format, `--init-mapping` generator.
12. **Alignment table in report** — matched pairs, platform-only, name drift.

### Phase 4 — Web support

13. **Nunjucks component scanner** — find `{% macro %}` definitions, including from `nhsuk-frontend`.
14. **Usage scanner for Nunjucks** — find `{{ macro({...}) }}` patterns in templates.
15. **Param-key extraction** — since Nunjucks macros take a params object, extract keys from call-site object literals.
16. **Web screenshot capture** — render macros in isolated HTML pages, capture via Playwright/headless Chrome.

### Phase 5 — Polish

17. **Coverage summary** — unused components, most-used, single-screen components.
18. **Markdown output** — for design documentation.
19. **Diff mode** — run against two points in time (branches/commits) and highlight what changed in the catalogue. New components, removed components, usage count changes.
20. **CI integration** — exit code for "component exists on iOS but not Android" checks, configurable via the mapping file.

### Future / maybe

- **`@Previewable` support** — if Swift evolves to make `@Previewable` extractable, or if a different approach (e.g. driving Xcode Previews directly via xcrun) becomes viable, coverage could increase from ~50% to ~90%.
- **Live preview server** — serve the HTML report with watch mode, auto-refreshing as prototype code changes.
- **Figma integration** — pull component names/tokens from a Figma file and add a "design" column to the alignment table.

## Design decisions

**Why not inside Quiver?** Quiver's parsers extract navigation structure (routes, navigate() calls, NavHost registrations). A component catalogue extracts component definitions and call-site usage. The parse targets don't overlap, the data model is different (flat table vs. directed graph), and the output is different (report vs. interactive map). The only shared element is "reads Swift/Kotlin files," which isn't enough to justify coupling them.

**Why regex-based parsing rather than a proper AST?** Swift and Kotlin AST parsers exist (swift-syntax, KSP/KAPT) but they're heavyweight, language-specific, and require compilation infrastructure. Regex parsing with brace-depth tracking (the same approach Quiver uses successfully) handles the detection and signature extraction cases well enough. Phase 1 confirmed this: 37 components detected with no false positives, 278 usages found accurately, variant grouping produces useful labels.

**Why a manual mapping file for cross-platform alignment?** Automated semantic matching (e.g. "RowLink and NHSRowItem serve the same purpose") would require understanding what components do, not just what they're called. A curated mapping file is honest about this limitation and gives the team a reviewable, version-controlled artifact that captures their design intent. The `--init-mapping` generator reduces the initial effort by pre-populating obvious matches.

**Why start with iOS?** It has the most components (~37 vs. Android's 3 vs. web's ~3 custom + nhsuk-frontend library). Building the scanner against a rich component library surfaces edge cases early and produces the most immediately useful output.

**Why inject into WindowGroup rather than Scene body?** SwiftUI's `@SceneBuilder` result builder doesn't support `if/else` control flow — only `@ViewBuilder` does. The screenshot pipeline injects its conditional display logic inside the `WindowGroup { ... }` closure (ViewBuilder context), not at the `var body: some Scene` level (SceneBuilder context). A private helper enum extracts the preview ID from launch arguments since complex `if let` bindings aren't needed.

**Why filter out `@Previewable` previews?** `@Previewable @State` is a Swift macro that expands to property wrapper declarations. These declarations aren't valid inside `AnyView()` or when extracted into a separate file. Rather than attempting complex source transformations to make them work, we skip them. The call-site variant data (which comes from the usage scanner, not from previews) is unaffected — screenshots are supplementary visual context, not the primary data source.

**Why include web/Nunjucks support?** Although the component model is different (macros vs. structs/functions), the catalogue question is the same: what exists, where is it used, how is it parameterised. Including web makes the cross-platform alignment table complete. The Nunjucks scanner is simpler than the native scanners because macros have a uniform `(params)` signature.
