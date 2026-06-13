# How screenshot capture works

Fractionator renders the `#Preview` / `@Preview` blocks that already exist in a
prototype and photographs each one. Capture is optional — `--no-screenshots`
skips the whole build/render step and everything else still works.

For guidance on writing previews that capture cleanly, see
[writing-capturable-previews.md](writing-capturable-previews.md).

## Component-only rendering

Previews are rendered to an image **at the component's intrinsic size**, not as a
full device screenshot — so a small `ChevronIcon` is a tight ~40 px glyph, not a
mostly-empty phone screen. Each platform has a native off-screen renderer, with a
full-screen screenshot as the fallback when it can't render a given preview.

| | iOS | Android |
|---|-----|---------|
| Off-screen renderer | `ImageRenderer` (iOS 16+) | `GraphicsLayer.toImageBitmap()` |
| Fallback | `simctl io screenshot` (full screen) | `adb exec-out screencap` (full screen) |

The injected gallery renders the selected preview, writes the PNG to the app's
documents/files directory, and signals completion; Fractionator pulls the PNG. If
no component image appears, it falls back to a full-screen capture of the same
preview, so coverage is never worse than a plain screenshot.

**Blank-render guard.** Some content can't be rasterised off-screen — a SwiftUI
`ScrollView`, a Compose `AndroidView`/`WebView`, async images. These can produce a
correctly-sized but **blank** image. The gallery samples the render; if it's
uniform/blank it writes no PNG, so capture falls back to a full-screen shot of the
live preview rather than saving a white box. (On Android the bitmap is drawn into
a software `ARGB_8888` sample first — `toImageBitmap()` returns a `HARDWARE`
bitmap, and reading its pixels directly would crash.)

## iOS (SwiftUI)

Scanning an iOS prototype (without `--no-screenshots`):

1. Extract `#Preview { … }` bodies from component files.
2. Generate a temporary `FractionatorGallery.swift` with every capturable preview
   as a switchable case.
3. Inject a launch-argument handler into the app's `WindowGroup`.
4. Build via `xcodebuild` and install on the iOS Simulator.
5. For each preview: launch with its id, render via `ImageRenderer` to the app's
   `Documents/`, pull the PNG (or fall back to a full-screen screenshot).
6. Clean up — remove the generated file and restore the app entry point.

**`@Previewable @State` is supported.** A preview that drives a binding with
single-line preview-local state is captured by hoisting the declarations into a
generated wrapper `View` with real `@State`, so the `$bindings` resolve.

Previews that are **skipped** (and surfaced as such in the report):

- **Multi-statement bodies** using a bare `return` — can't be wrapped in the
  gallery's `AnyView()`.
- **Private/fileprivate types** referenced in the body — inaccessible from the
  generated gallery file.
- **`@Previewable` previews too complex to hoist** (multi-line/unfamiliar state
  declarations) — skipped conservatively rather than risk breaking the build.

## Android (Jetpack Compose)

Scanning an Android prototype (without `--no-screenshots`):

1. Scan component files for `@Preview @Composable` functions.
2. Generate a temporary `FractionatorGalleryActivity.kt` that imports and calls
   each one.
3. Register the activity in `AndroidManifest.xml`.
4. Build via `./gradlew assembleDebug` and install on the emulator via `adb`.
5. For each preview: launch the activity with an intent extra, render via a
   `GraphicsLayer` to the app's `filesDir`, pull the PNG (or fall back to
   `screencap`).
6. Clean up — remove the generated activity and restore the manifest.

**`internal` previews are captured.** The gallery lives in the same module, so it
can call `internal` (and `public`) preview functions. Only file-`private`
functions are skipped.

Previews that are **skipped** (surfaced in the report):

- **Private functions** — invisible to the gallery (a different file).
- **Parameterised previews without defaults** (including `@PreviewParameter`) —
  the gallery calls each preview as `fn()`, so a required argument would fail to
  compile and take the whole build down. Skipped rather than risk that.

**Avoiding the splash screen.** Apps show a splash on every cold start, so
capturing each preview from a freshly launched process would photograph the
splash. The gallery activity is `singleTop` and updates on `onNewIntent`, so the
process starts **once** (a throwaway warm-up launch absorbs the cold start on a
trivial frame) and every real preview is a fast warm recomposition. If a preview
kills the process mid-run, the next capture re-warms first.

**Live/async content.** Components that load remote content or run long animations
may capture before content loads, showing a blank/partial frame (the blank guard
catches fully-uniform results; partial frames can slip through). The warm settle
time is tunable in `captureAndroidScreenshots` (`settleMs`).

## Multi-component previews → showcases

A preview often renders **several** components (e.g. an `NHS Buttons` preview that
lays out filled/outlined/text buttons together). Fractionator reads the preview
**body** to find which known components it constructs (`renders`), and attributes
accordingly:

- renders **1** component → that component's own preview;
- renders **≥2** → a **showcase**: shown once in the Showcases tab with a chip per
  component, and linked from each component it contains;
- renders **0** known components (e.g. a whole-screen preview) → the name/file
  fallback.

This is why a component with no solo preview can still show an image — it appears
in a showcase — rather than being reported as uncaptured. See
[output.md](output.md) for how this surfaces in the report.

## Preview status in the report

Every component card shows one of: a captured image; **full-screen** (captured,
but only as a full-screen fallback); **in showcase** (its image lives in a
showcase); **preview skipped** with the reason; or **no preview**. The tool also
logs how many previews it found versus captured.
