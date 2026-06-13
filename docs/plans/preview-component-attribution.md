# Plan: Body-driven preview↔component attribution + multi-component showcases

## The problem

Fractionator forces every `@Preview` onto **one** component via a name-similarity
heuristic (`matchPreviewToComponent`). That breaks for files that define several
components and for **showcase previews** that render many components at once.

Concrete case (`Button.kt`): the preview `NHSButtonsPreview()` renders five
components —

```kotlin
@Preview @Composable fun NHSButtonsPreview() {
    Column {
        NHSFilledButton("Filled Button", onClick = {})
        NHSFilledTonalButton("Filled Tonal", onClick = {})
        NHSOutlinedButton("Outlined Button", onClick = {})
        NHSElevatedButton("Elevated Button", onClick = {})
        NHSTextButton("Text Button", onClick = {})
    }
}
```

— but is attributed to a single component (`NHSExtendedFloatingActionButton`, which
happens to be **unused** and so filtered out of the report). Result: the image is
captured but hidden, and the used siblings (`NHSFilledButton`, …) are flagged
"#Preview exists but couldn't be captured." Capture is fine — **attribution** is
wrong.

## The key insight

A preview's true component set is **discoverable from its body**: the components
it renders are the known component names it *calls*. `NHSButtonsPreview`'s body
calls `NHSFilledButton`, `NHSFilledTonalButton`, `NHSOutlinedButton`,
`NHSElevatedButton`, `NHSTextButton` — so those are the components it shows. This
is concrete evidence, not a name guess.

This replaces the 1:1 heuristic with an evidence-based **many-to-many** mapping,
and gives a clean definition of a "showcase": a preview that renders ≥2 components.

## Part 1 — Detect which components a preview renders (static, no emulator)

1. Extract each preview function's **body** (balanced-brace block after the
   parameter list). Add a Kotlin brace-block extractor (analogous to the Swift
   `extractBraceBlock`), reusing the existing `extractBalancedParens`.
2. Strip comments/strings from the body (`stripKotlinComments` already exists) to
   avoid false matches.
3. Against the **known component names** (from the scanner), find invocations
   `\bName\s*\(` in the body. The resulting set is `preview.renders`.
   - Theme wrappers (`DemoNHSAppTheme`), layout (`Column`/`Row`), etc. are not in
     the known-component set, so they're naturally excluded.

Classification:
- `renders.length === 1` → **single-component** preview → attribute to that
  component (a cleaner, evidence-based version of today's 1:1).
- `renders.length >= 2` → **showcase** → a first-class entity (Part 2).
- `renders.length === 0` → **screen/unknown** → fall back to today's name/file
  heuristic, and mark it so the report can label it (e.g. a whole-screen preview).

Limitation: only **direct** calls in the body are seen. A preview that renders
components through a local sample wrapper won't be decomposed; it lands in the
zero-match fallback. Acceptable, and explicit.

## Part 2 — Previews/showcases as first-class entities

Today the catalogue is component-centric (`component.screenshots[]`). A showcase
belongs to no single component, so it needs its own home.

Data model (per platform in `catalogue.json`):
- New `showcases: [{ id, name, sourceFile, renders: [componentName],
  screenshots: [...] }]`.
- Each component gains `appearsIn: [showcaseId]` backlinks (in addition to its own
  single-component `screenshots`).
- **Capture ids become preview-centric** (`id = sanitize(functionName)`, namespaced
  by file if needed) instead of `componentName_previewName`. This decouples a
  preview's identity from one component. (Changes screenshot filenames — note a
  one-time cleanup of the old `screenshots/` dir.)

Crucially, **the on-device capture path is unchanged** — still one render per
preview function. Only *association and surfacing* of the resulting image changes.
That keeps this low-risk on the side that's been fragile (the gallery/emulator).

## Part 3 — Visualise multi-component previews (the report)

- A **Showcases** section/group: each showcase card shows the captured image plus a
  **chip per rendered component**, each linking to that component's card. The image
  is shown **once**, not duplicated across every component.
- **Component cards**: a component with no solo preview but that appears in
  showcases shows "Shown in: [showcase chips]" (with thumbnails) instead of
  "couldn't be captured." A component with both shows its solo preview and the
  backlinks.
- Update `previewStatus`: a component is only "couldn't be captured" when it has a
  solo preview that failed **and** appears in no showcase. The misleading note goes
  away for the button/list/header cases.
- This dovetails with the existing `component-previews-and-gallery.md` gallery work
  — showcases are a natural group in that grid.

## Part 4 — Unused-filter interaction (fixes the hidden images)

A showcase is shown when **any** component it renders is used, regardless of which
single component it once mapped to. So the button/list/header showcases reappear
even though their old single owners are unused. This directly recovers the ~50
captured-but-hidden images without `--include-unused`.

## Part 5 — iOS parity (follow-up)

The same body-scan applies to SwiftUI `#Preview` bodies (scan for known component
initializers). iOS attributes by file today, which is mostly 1:1 but has the same
showcase cases (`PageHeading` H1–H4, `NHSSection` RowLinks). Apply the model to iOS
once Android proves out — mirroring how the capture work was sequenced.

## Recommended sequence

1. **Body extraction + `renders` detection** (Kotlin) — pure static analysis,
   unit-testable without an emulator. Validate against `Button.kt` / `List.kt` /
   `NHSPageHeader.kt`.
2. **Data model**: showcases + component `appearsIn` backlinks; preview-centric
   ids; `previewStatus` update.
3. **Report UI**: showcase section + component backlinks; fold into the gallery.
4. **iOS parity.**

## Risks / edge cases

- **False matches** in bodies (a component name in a string/comment) — mitigated by
  stripping comments/strings and matching `\bName\s*\(`.
- **Indirect rendering** via wrappers — undetected; handled by the zero-match
  fallback rather than a wrong guess.
- **Image duplication** — avoided by showing the showcase image once with chips,
  not copying it onto every component card.
- **Filename churn** — preview-centric ids rename screenshot files; clear the old
  `screenshots/` dir once on upgrade.
- **Capture unchanged** — Parts 1–4 touch only scanning/assembly/report, not the
  injected gallery or the emulator path, so they can't reintroduce the crash/slow
  class of regression.
