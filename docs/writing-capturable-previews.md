# Writing previews that capture well

Fractionator builds component images from the previews that already exist in your
prototype — `#Preview` blocks on iOS, `@Preview @Composable` functions on Android.
It injects a tiny gallery, renders each preview off-screen at the component's
intrinsic size (falling back to a full-screen screenshot when it can't), and puts
the result in the report.

How you write a preview decides whether you get a clean component-only image, a
full-screen fallback, or no image at all. The report flags each gap — a component
shows **no preview**, **preview skipped** (with the reason), **full-screen**, or
**in showcase** — so it doubles as a punch-list. (For the mechanics, see
[screenshot-capture.md](screenshot-capture.md).)

---

## iOS (SwiftUI)

### Do
- **Give every reusable component a `#Preview`.** No `#Preview` → no image.
- **Preview the component in isolation**, at its natural size:
  ```swift
  #Preview { MyButton(title: "Continue") {} }
  ```
- **Name multi-case previews:** `#Preview("Loading") { … }` — the name becomes the
  caption.
- **Simple `@Previewable @State` works** — Fractionator hoists single-line state
  into a wrapper view:
  ```swift
  #Preview {
      @Previewable @State var on = true
      MyToggleRow(isOn: $on)
  }
  ```

### Falls back to a full-screen shot
- **Wrapping in a `ScrollView`** — `ImageRenderer` can't rasterise scroll-view
  content (it renders blank), so Fractionator discards it and falls back. Use a
  plain `VStack` (add a fixed `.frame` height only if you truly need scrolling).
- **`UIViewRepresentable`, `AsyncImage`, other content needing a live environment.**

### Skipped — no image
- **Multi-statement bodies with a bare `return`** — keep the body a single view
  expression.
- **`private` / `fileprivate` types referenced in the preview** — the gallery is a
  separate file. Make the type non-private.
- **Previewing a whole screen** instead of the component.

---

## Android (Jetpack Compose)

### Do
- **Give every component a `@Preview @Composable` function.**
- **Make preview functions `public` or `internal` — not `private`.** The gallery
  is a separate file in the *same module*: it can call `public`/`internal`, but a
  top-level `private fun` is file-scoped and invisible.
  ```kotlin
  // ⚠️ skipped — file-private
  @Preview @Composable private fun MyCardPreview() { MyCard(...) }
  // ✅ capturable
  @Preview @Composable fun MyCardPreview() { MyCard(...) }
  ```
- **Keep previews parameterless, or give every parameter a default.** The gallery
  calls each preview as `fn()`, so a parameter with no default — including a
  `@PreviewParameter` provider — makes it uncapturable:
  ```kotlin
  // ⚠️ skipped — gallery can't supply the argument
  @Preview @Composable fun RowPreview(@PreviewParameter(P::class) s: State) { … }
  // ✅ default makes fn() valid
  @Preview @Composable fun RowPreview(current: Boolean = true) { … }
  ```
- **Name previews** with `@Preview(name = "Loading")` for a clear caption.

### Falls back to a full-screen shot
- **`AndroidView`, `WebView`, maps, async images** — a `GraphicsLayer` can't record
  this content, so the component render comes back blank and Fractionator falls
  back to full-screen.

---

## Showcase previews (rendering several components)

A preview that renders **two or more** components (e.g. a buttons gallery laying
out filled/outlined/text buttons together) is treated as a **showcase**: it gets
its own card in the Showcases tab with a chip per component, and each component it
contains links to it. Fractionator detects this from the preview body, so you
don't need to do anything special — a single "all buttons" preview sensibly covers
every button component at once.

---

## The report is your punch-list

| Badge / note | Meaning | Fix |
|---|---|---|
| *(image shown)* | Captured as an isolated component | — |
| **full-screen** | Captured, but only as a full-screen shot | Remove the scroll/representable wrapper |
| **in showcase** | Captured as part of a multi-component showcase | — |
| **preview skipped** + reason | A preview exists but couldn't be captured | Address the reason (interactive / multi-statement / private / parameterised) |
| **no preview** | No `#Preview` / `@Preview` in the source | Add one |

A catalogue with zero "no preview" / "skipped" badges is one where every component
renders as intended.
