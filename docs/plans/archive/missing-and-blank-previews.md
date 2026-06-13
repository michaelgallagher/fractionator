# Plan: Why components render no image (or a blank one), and how to fix it

Some components in the catalogue produce **no preview image** (e.g. `RowLink`,
`ButtonLink`, `NHSNavigationButton`) and a few produce a **blank white
rectangle** (e.g. `NHSButton`). This documents the root causes — there are three
distinct ones — and the fix options, split by whether the fix lives in
Fractionator or in the prototype.

## How capture works (the relevant mechanism)

Fractionator only ever photographs **`#Preview` blocks**. For each one
(`src/swift-screenshot-capture.js`):

1. It extracts the `#Preview { … }` body, **filtering out** ones it can't safely
   relocate into the generated `FractionatorGallery.swift`
   (`extractPreviewBlocks`).
2. It drops the surviving bodies into a gallery and renders each off-screen via
   SwiftUI's `ImageRenderer` — intrinsic-size, chrome-free — then pulls the PNG.
3. It falls back to a full-screen `simctl io screenshot` when `ImageRenderer`
   returns `nil`.

Each failure mode breaks a different link in that chain.

## The three failure modes (audited against `nhsapp-ios-demo-v2`, 34 components)

### Category A — No `#Preview` exists in the source (8 components)

`RowLink`, `ButtonLink`, `NHSNavigationButton`, `DetailView`, `BulletItem`,
`BannerCard`, `Avatar`, `MedicineSelectionCard`, `FlowPage`.

These files contain **zero `#Preview` blocks**. Fractionator has nothing to
capture. This is not a Fractionator bug — there is genuinely no preview.

### Category B — A `#Preview` exists, but the extractor deliberately skips it (6)

The scanner counts these (so they appear in the catalogue), but the capture-side
extractor rejects them by design. Two sub-causes:

- **B1 — `@Previewable @State` interactive bindings**: `ProveWhoYouAreView`,
  `AlertDismissButton`, `NHSTextEditor`, `RadioButtonRow`. Their previews declare
  local state (`@Previewable @State var text = ""`) and pass `$bindings`. The
  extractor skips anything with `@Previewable`/`$binding` because that macro can't
  be lifted into `AnyView(...)` in a different file.
- **B2 — bare `return` / multi-statement bodies**: `HubRowLink`,
  `NavigationGrid`. Skipped by the `/^\s*return\s/` filter. These also preview the
  whole `HomeView()`, not the component in isolation.

### Category C — Captured, but renders blank (the white rectangle)

`NHSButton`. Its image is correctly sized (708×2863) but **completely white**.
Cause: the `#Preview` wraps everything in a **`ScrollView`**. `ImageRenderer`
lays the scroll view out to full content height but **does not rasterize
scroll-view content** — a known `ImageRenderer` limitation — so the canvas is the
right size but empty. Because the render "succeeded" (non-nil image), the
full-screen fallback never kicks in. Sibling previews that wrap in
`List`/`NavigationStack` (e.g. `PageHeading`) render fine, so this is specific to
`ScrollView` (and likely other scroll/lazy containers).

## Fix options

### Fractionator

| # | Change | Addresses | Effort |
|---|--------|-----------|--------|
| **F1** | **Detect blank renders.** After `ImageRenderer` produces an image, check it isn't ~uniform (all-white / fully transparent). If blank, treat as `nil` → fall back to full-screen capture. | C (NHSButton) — guarantees something visible instead of a white box. | Low |
| **F2** | **Unwrap scroll containers** before rendering, so a `ScrollView { … }` preview renders its content. | C, with a tight crop preserved. | Medium |
| **F3** | **Support `@Previewable @State`** by hoisting the declarations into a small generated wrapper view with real `@State`, so `$bindings` resolve. | B1 (4 components) — biggest coverage win. | Medium–High |
| **F4** | **Handle multi-statement / `return` bodies** by emitting each preview as its own `@ViewBuilder` function instead of inlining into `AnyView(...)`. | B2 | Medium |
| **F5** | **Surface the gaps in the report.** Distinguish *no `#Preview`* vs *skipped: interactive preview* vs *full-screen fallback*, so silent gaps become actionable. | All — diagnostic. | Low |

### Prototype (`nhsapp-ios-demo-v2`)

| # | Change | Addresses |
|---|--------|-----------|
| **P1** | Add `#Preview` blocks to the 8 Category-A components. | A — the only possible fix; Fractionator can't invent previews. |
| **P2** | Drop the `ScrollView` wrapper in `NHSButton`'s preview (plain `VStack`, or a fixed-height frame). | C — cleanest fix, improves the Xcode preview too. |
| **P3** | Make `HubRowLink`/`NavigationGrid` previews component-scoped rather than previewing the whole `HomeView()`. | B2 quality. |
| **P4** | (Optional) Replace `@Previewable @State` with a small stateful preview-wrapper view, if not building F3. | B1 without Fractionator changes. |

## Recommended sequence

1. **F1 + F5 now** — cheapest, removes the white-box artifact and turns silent
   gaps into labelled ones. (This commit.)
2. **F3 next** — highest-value Fractionator investment; unlocks 4 components and a
   recurring SwiftUI idiom. (Separate commit.)
3. **Prototype fixes (P1–P3)** — owner of `nhsapp-ios-demo-v2` to address;
   Category A is unavoidably a prototype fix.

## Notes / risks

- **F1 false positives**: a legitimately near-uniform component (a solid colour
  swatch, or tiny content on a large canvas) could be flagged blank and fall back
  to full-screen. That's a crop→full-screen degradation, not data loss —
  acceptable and rare. The blank check downsamples to a small bitmap and looks for
  any colour variance, which keeps glyphs/buttons safely above the threshold.
- **F5 reason fidelity**: the "no `#Preview`" status is always knowable from the
  scanner (`previews.length === 0`). The precise skip reason (interactive /
  multi-statement / private type) comes from the extractor's static analysis,
  surfaced per component.
