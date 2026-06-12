# Writing previews that capture well

Fractionator creates images of your components from their `#Preview` blocks. How you
write those previews decides whether you get a clean, **component-only** image or
a full **device-screen** screenshot — and, in some cases, whether the preview is
captured at all. This guide explains what the tool does and how to author
previews that capture well.

> Scope: this is about **iOS / SwiftUI** previews, where component-only capture is
> implemented. Compose guidance is at the end and is forward-looking.

## How capture works (the 30-second version)

For each `#Preview`, the tool:

1. extracts the preview body and hosts it in a generated gallery inside your app;
2. renders it with SwiftUI's `ImageRenderer`, which sizes the image to the view's
   **intrinsic content** — no status bar, no home indicator, no whitespace;
3. if that render can't produce an image, falls back to a **full-screen
   screenshot** of the running app.

So the goal when authoring a preview is simple: **return a view that knows its own
size.** A button, a card, a row, an icon — these size to their content and render
as tight, chrome-free images. A whole screen does not.

## Do this — previews that crop cleanly

**Return the component directly**, optionally with a little padding:

```swift
#Preview("Default") {
    HelpSectionView()
}

#Preview("Custom URL") {
    HelpSectionView(url: URL(string: "https://www.nhs.uk/")!)
}
```

**Show several variants stacked** — a `VStack` is self-sizing, so this still
crops to just the stack:

```swift
#Preview("Sizes") {
    VStack(alignment: .leading, spacing: 20) {
        PageHeading(title: "H1 Page title", level: .h1)
        PageHeading(title: "H2 Page title (default)")
        PageHeading(title: "H3 Section heading", level: .h3)
    }
    .padding()
}
```

**Give greedy components a width if they need one.** A component that uses
`.frame(maxWidth: .infinity)` will size to its content's natural width; if you
want it rendered at a specific width, wrap it in a fixed frame rather than a
scrolling container:

```swift
#Preview {
    NHSButton("Continue") {}
        .frame(width: 360)
        .padding()
}
```

## Avoid this — previews that fall back to a full screen

The tool **cannot** size these, so they're captured as full-screen screenshots.
The component is still in the catalogue; the image is just the whole device.

| Wrapper | Why it can't be cropped |
|---|---|
| `List { … }` / `Form { … }` | Scrollable containers with **no intrinsic height** — they fill their scroll area, so there's no finite size to render. |
| `NavigationStack { … }` / `NavigationView` | Screen-filling containers that own a navigation bar. |
| `TabView { … }` | Full-screen by definition. |
| `.toolbar { … }` | The component only exists in the nav-bar chrome, not in the content. |

```swift
// ❌ Falls back to full screen — the List can't be sized
#Preview("Default") {
    List {
        NHSSection {
            Text("Item 1")
            Text("Item 2")
        }
    }
}

// ✅ Crops to just the component
#Preview("Default") {
    NHSSection {
        Text("Item 1")
        Text("Item 2")
    }
    .padding()
}
```

If a component is **genuinely** a list row or a navigation-bar button, a
full-screen capture is the honest representation and the fallback is fine — but if
you want the component itself, add a **second, unwrapped preview** alongside the
in-context one. Both are captured.

## Make sure the preview is captured at all

A few preview styles are **skipped entirely** (no image, cropped or otherwise),
because the tool lifts the body out into a separate generated file:

- **`@Previewable @State`** — preview-local state can't be lifted out. Move the
  state into a small wrapper `View` and preview that instead.
- **Bare `return` / multi-statement bodies** — keep the body a single returned
  expression (use a wrapper view if you need setup).
- **`private` / `fileprivate` types referenced in the body** — these are
  invisible to the generated gallery. Give the preview access to non-private
  types, or make a small internal preview helper.

## Small things that improve the output

- **Name your previews** — `#Preview("Empty state")` gives readable captions and
  filenames; unnamed previews become `Default`, `Default_2`, …
- **Light & dark are automatic** — the tool reproduces the active colour scheme
  and Dynamic Type size, so you don't need separate light/dark previews just for
  capture (though they're fine if you want both as distinct entries).
- **Keep previews self-contained** — avoid network images or async loads in the
  previewed view; `ImageRenderer` renders a single synchronous frame, so
  not-yet-loaded content renders empty.

## Project requirements

Component-only capture needs:

- the **SwiftUI App lifecycle** — a `@main … : App` with a `WindowGroup` scene
  (the tool injects its gallery there);
- an **iOS 16+ deployment target** (for `ImageRenderer`). On earlier targets every
  preview is captured as a full-screen screenshot instead.

## Quick checklist

- [ ] Preview returns the component (or a `VStack` of variants), not a screen.
- [ ] No `List` / `Form` / `NavigationStack` / `TabView` / `.toolbar` wrapper
      (unless you also add an unwrapped preview).
- [ ] No `@Previewable @State`, bare `return`, or `private` types in the body.
- [ ] Preview is named.
- [ ] Greedy components given a `.frame(width:)` if you want a specific size.

## Compose (forthcoming)

Component-only capture for Jetpack Compose is planned. The same principle will
apply: preview the composable on its own (`MyComponent()` with a little
`Modifier.padding()`), and avoid hosting it inside `Scaffold`, `LazyColumn`, or a
full-screen layout if you want a cropped image.
