# Authoring prototypes so Fractionator can preview them

Fractionator builds component previews by capturing **previews that already exist
in your prototype** — `#Preview` blocks on iOS, `@Preview @Composable` functions
on Android. It injects a tiny gallery, renders each preview off-screen to a
component-sized image (falling back to a full-screen screenshot when it can't),
and puts the result in the report.

So the quality of the catalogue depends on how previews are written. This guide
lists what makes a component capture cleanly, what makes it fall back to a
full-screen shot, and what makes it not appear at all. The report flags each gap
— a component shows **"no preview"**, **"preview skipped"** (with the reason), or
**"full-screen"** — so you can see exactly which of the cases below applies.

---

## iOS (SwiftUI)

### Do
- **Give every reusable component a `#Preview`.** No `#Preview` → no image. This
  is the single most common gap.
- **Preview the component in isolation**, at its natural size:
  ```swift
  #Preview { MyButton(title: "Continue") {} }
  ```
  Fractionator renders to the view's intrinsic size, so an isolated component
  crops tightly. A preview of a whole screen captures a whole screen.
- **Name multi-case previews:** `#Preview("Loading") { … }` — the name becomes the
  caption in the report.
- **Simple `@Previewable @State` is supported.** A preview that drives a binding
  with single-line state works — Fractionator hoists the state into a wrapper
  view:
  ```swift
  #Preview {
      @Previewable @State var on = true
      MyToggleRow(isOn: $on)
  }
  ```

### Avoid (these still capture, but fall back to a full-screen shot)
- **Wrapping the component in a `ScrollView`.** `ImageRenderer` can't rasterize
  scroll-view content — it produces a blank canvas, so Fractionator discards it
  and falls back to a full-screen capture. Use a plain `VStack` (add a fixed
  `.frame` height only if you genuinely need scrolling):
  ```swift
  // ⚠️ blank component render → full-screen fallback
  #Preview { ScrollView { VStack { /* buttons */ } } }
  // ✅ tight component crop
  #Preview { VStack { /* buttons */ } }
  ```
- **`UIViewRepresentable`, `AsyncImage`, and other content that needs a live
  environment.** `ImageRenderer` can't draw these off-screen; they fall back to
  full-screen.

### Avoid (these are skipped — no image at all)
- **Multi-statement preview bodies with a bare `return`** (e.g. setting a
  `UserDefault` then `return SomeView()`). Keep the body a single view expression.
- **Referencing `private` / `fileprivate` types in the preview.** The injected
  gallery is a separate file and can't see them. Make the type non-private, or
  preview with a public type.
- **Previewing the whole app** (`HomeView()` etc.) instead of the component —
  it'll either be skipped or show the whole screen, not the component.

---

## Android (Compose)

### Do
- **Give every component a `@Preview @Composable` function.** No `@Preview` → no
  image.
- **Make preview functions `public` or `internal` — not `private`.** The gallery
  is a separate file in the *same module*: it can call `public` and `internal`
  functions, but a top-level `private fun` is file-scoped and invisible to it.
  ```kotlin
  // ⚠️ skipped — file-private, gallery can't call it
  @Preview @Composable private fun MyCardPreview() { MyCard(...) }
  // ✅ capturable
  @Preview @Composable fun MyCardPreview() { MyCard(...) }
  ```
- **Keep previews parameterless, or give every parameter a default.** The gallery
  calls each preview as `fn()`. A parameter without a default — including
  `@PreviewParameter` providers — makes that call fail, so the preview is skipped:
  ```kotlin
  // ⚠️ skipped — gallery can't supply the argument
  @Preview @Composable fun RowPreview(@PreviewParameter(P::class) s: State) { … }
  // ✅ default makes fn() valid
  @Preview @Composable fun RowPreview(current: Boolean = true) { … }
  ```
- **Name previews** with `@Preview(name = "Loading")` for a clear report caption.

### Avoid (these still capture, but fall back to a full-screen shot)
- **`AndroidView`, `WebView`, maps, async images.** A `GraphicsLayer` can't record
  this content, so the component render comes back blank and Fractionator falls
  back to a full-screen capture. (`InAppBrowser`-style components are the usual
  example.)

### Notes
- Multiple components in one file are fine; Fractionator matches each preview to
  the closest component by name. Naming a preview `<ComponentName>Preview` makes
  that match reliable.

---

## How the report tells you what happened

After a run, each component card shows one of:

| Badge / note | Meaning | Fix |
|---|---|---|
| *(screenshot shown)* | Captured as an isolated component | — |
| **full-screen** | Captured, but only as a full-screen shot | Remove the scroll/representable wrapper (see above) |
| **preview skipped** + reason | A preview exists but couldn't be captured | Address the stated reason (interactive/multi-statement/private/parameterized) |
| **no preview** | No `#Preview` / `@Preview` in the source | Add one |

Treat the badges as a punch-list: a catalogue with zero "no preview" / "skipped"
badges is one where every component renders as intended.
