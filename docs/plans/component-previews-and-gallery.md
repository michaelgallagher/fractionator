# Plan: Component-only previews & a denser gallery

Make the report easier to scan by (1) capturing previews as **just the
component** at its intrinsic size instead of a full device screenshot, and
(2) presenting components as a **dense gallery** rather than one long column of
full-width cards.

## Why — the two complaints share one root cause

Every preview is currently a **full device-screen capture**:

- iOS: `xcrun simctl io screenshot` (`src/swift-screenshot-capture.js:255`) → 1206×2622 px
- Android: `adb exec-out screencap -p` (`src/kotlin-screenshot-capture.js:199`) → full screen

The injected gallery (`generateGallerySource`) drops each preview into the app's
`WindowGroup` and photographs the whole screen. So a tiny `ChevronIcon` becomes a
~1.8 MB image of a mostly-empty iPhone — status bar, home indicator, and a sea of
whitespace around a 40 px glyph. Verified: existing screenshots in
`catalogue-output/screenshots` are all full device resolution, the largest 1.8 MB.

That single fact drives **both** problems:

- previews *are* whole screens (not the component); and
- the whole-screens are what make the page feel spread out — each card is
  dominated by a 320 px-tall image of mostly nothing.

The two fixes compound: a dense gallery is only worth building once thumbnails are
component-sized, so the capture change comes first.

## Part 1 — Render the component, not the screen

Render each preview to an image **at its intrinsic content size** instead of
screenshotting the device.

### iOS (do this first — the more mature capture path)

Replace the "display in WindowGroup → screen-grab" flow with an
`ImageRenderer`-based render (iOS 16+):

- In the injected gallery, for the selected preview id, build the view and run it
  through `ImageRenderer(content:)`. Leave the proposed size unspecified so it
  sizes to content; set `scale` to the display scale for retina output.
- Write the resulting PNG to the app's `Documents/` directory under the preview
  id (instead of rendering to the visible `WindowGroup`).
- After launch+settle, pull the file with
  `xcrun simctl get_app_container <udid> <bundleId> data` and copy
  `Documents/<id>.png` into the output `screenshots/` dir (replacing the
  `simctl io screenshot` call in `captureOneIosPreview`).

Result: a tightly-cropped, chrome-free, retina component image — typically ~50×
smaller than today's full-screen PNG.

**Fallback:** some previews legitimately want a full screen (a sheet, a
`NavigationStack`, anything `ImageRenderer` can't render off-screen — async
images, `UIViewRepresentable`, etc.). When the render fails or produces a
zero-size image, fall back to the current full-screen capture so we never lose a
preview we capture today.

### Android (parity, after iOS proves out)

The Compose analog: render the preview into a `ComposeView`, draw it to a bitmap
(`GraphicsLayer.toImageBitmap()` on recent Compose, or measure/layout +
`drawToBitmap`), write a PNG to `filesDir`, and pull it with `adb` (`run-as` /
`adb pull`) in place of `screencap`. Same fallback to full-screen capture.

### Interim option (cheap, no Swift/Kotlin changes)

Auto-trim uniform margins from the existing full-screen PNGs as a post-process
step. Needs an image dependency (`sharp`) and only works when the component sits
on a uniform background, so treat it as a stopgap, not the destination.

## Part 2 — A gallery view

Today the report is a single 960 px column of full-width cards
(`src/build-report.js:567,596`) — 110 components is a very long scroll. With
component-sized thumbnails available, add:

1. **Gallery view** — a responsive grid
   (`grid-template-columns: repeat(auto-fill, minmax(…))`) of compact cards:
   thumbnail + name + usage badge. The whole catalogue visible as a contact
   sheet.
2. **Gallery / List toggle** — gallery for scanning; today's detailed card
   (signature, usages, variants) for drilling in, shown on click via inline
   expand or a modal.
3. **Wider container** in gallery mode; **default-collapsed** detail sections in
   list mode.
4. **Group by platform** (section headers or a platform filter) so iOS/Android
   don't interleave.

All of this lives in `renderHtml` / `renderComponentCard` plus the embedded CSS
and JS; no new runtime dependencies for the layout itself. The existing search
(`#search`) and sort (`#sort`) controls carry over; pin them (sticky) while
we're in there.

## Other improvements found while reading the code

- **Token deep-linking** — tokens carry `locations` but the UI only surfaces them
  as hover tooltips (`renderColorTokens`). Make them clickable; ideally cross-link
  tokens ↔ the components that use them.
- **Spacing outlier highlighting** — the spacing tab shows the scale but treats a
  one-off `spacing: 17` like the 4/8/16 rhythm. Flagging off-scale values turns
  the tab from descriptive into diagnostic (drift detection).
- **Thumbnail generation regardless** — even if a preview keeps a full-screen
  capture, emit a downscaled thumbnail rather than piping multi-MB PNGs straight
  into `<img>`.
- **Sticky controls** — search/sort currently scroll away.

## Recommended sequence

1. **iOS `ImageRenderer` capture** → component-only images. Foundation; unlocks
   everything else. Prototype against `nhsapp-ios-demo-v2` and compare a real
   before/after thumbnail before committing to the gallery rework.
2. **Gallery grid + List/Gallery toggle** → the density win.
3. **Android component-only capture** → parity.
4. **Token deep-linking + spacing outliers** → polish.

## Risks / edge cases

- `ImageRenderer` won't render every view (async image loads, representables,
  views depending on a live environment). The full-screen fallback keeps coverage
  no worse than today.
- Pulling files from the app container adds a per-preview `simctl get_app_container`
  call; cost is negligible next to the existing launch+settle per preview.
- Intrinsic-size rendering can produce very wide or very tall images (a full list
  preview). The gallery should cap thumbnail dimensions and letterbox rather than
  distort.
- The interim auto-trim path over-crops when a component's own background matches
  the page background — which is exactly why it's interim, not the target.
