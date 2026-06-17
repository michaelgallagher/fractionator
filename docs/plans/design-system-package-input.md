# Design-system Swift Package as a first-class input

Make an importable design-system **library** (Swift Package) a supported input
shape, not just an app-style **prototype**. Today Fractionator's iOS path assumes
a prototype app — a `Components/` directory, components referenced from screens,
and an `@main` App to screenshot. A packaged design system has none of these, so
a real run produces **nothing**.

## Problem

Pointed at the actual NHS iOS design-system package
(`~/Repos/nhsapp-design-system-ios`, an SPM library), `fractionator --ios <pkg>`
reports `Found 0 components`, `0 colors, 0 type sizes, 0 spacing units`, and no
screenshots. Yet the package is dense with documentable design-system material.
Every assumption that fails is an app-prototype assumption:

1. **Component discovery is `Components/`-only.** `scanSwiftComponents`
   (`src/swift-component-scanner.js:37`) treats only `**/Components/**/*.swift` as
   component files. The package organises by role — `Shape/`, `Extension/`,
   `Enums/` — so zero files qualify. The two real `View` structs (`NHSDivider`,
   plus a `#if DEBUG`-only private `ColourRow`) are never seen.

2. **Components are filtered out as "unused."** Even with the glob widened, a
   library has no screens that *consume* its components, so `scanUsages` finds 0
   usages and everything is excluded unless `--include-unused`. For a design
   system the components **are** the product — "unused" is the wrong default.

3. **Colour occurrences aren't matched (extra call args).** The package aliases
   assets as `Color("blue", bundle: .module)`. Both the token-scanner colour
   matcher (`src/token-scanner.js`, `\bColor\(\s*"([^"]+)"\s*\)`) and the
   resolver's alias regex (`src/color-resolver.js`, `assetAlias`) require the
   closing paren immediately after the string, so the `, bundle: .module` form
   matches neither. The `.xcassets` colorsets resolve fine in isolation — but
   nothing references them, so **0 colours** surface.

4. **Typography is invisible.** Type is defined as
   `Font.custom("FrutigerLTPro-Roman", size: 34, relativeTo: .largeTitle)` aliases
   (`Font+Extension.swift`). The iOS typography matchers only know `.system(size:)`
   and `.font(.body)`; there is **no iOS type resolver** at all (only
   `buildAndroidTypeResolver` exists). So the full Frutiger ramp is dropped.

5. **Spacing / stroke / corner-radius are invisible.** These are enum tokens —
   `enum SpacingToken { case spacing05; var style: CGFloat { switch … return 16 } }`
   (`Enums/SpacingAndCornerRadius.swift`). The spacing matchers only catch literal
   `spacing:` / `.padding(...)` call-sites, so the canonical scale is dropped.

6. **Screenshots assume an `@main` App.** `swift-screenshot-capture` fails with
   "Could not find @main App entry point"; a library has no app to launch. It
   degrades gracefully (the run continues) but produces no images.

Framed against [native-design-systems.md](native-design-systems.md): this package
is precisely the "ship the design system as an importable library so the public
API surface == the documented surface" state that roadmap calls for. The tool
just can't read that shape yet.

## Approach

Detect the package shape and adjust discovery, defaults, and the token resolvers
to read **definitions** rather than **usage**. Five tool-side pieces; each lands
independently and degrades to today's behaviour when the markers are absent.

### 1. Package detection + a "library mode"

When the iOS source root (or a parent) contains `Package.swift`, treat it as a
design-system library. Library mode changes three defaults:

- **Component glob** falls back to scanning `Sources/**/*.swift` (still excluding
  `.build/`, tests) instead of requiring `Components/`. Keep `--components-dir`
  as the explicit override. More generally: if the default `Components/` glob
  matches nothing, fall back to all non-test Swift rather than silently finding
  zero.
- **`--include-unused` defaults on.** In a library the components are roots;
  "used but only in `#Preview`" and "never referenced" are normal, not grounds for
  exclusion. (Keep usage data — it's still an adoption signal — just don't filter
  on it.)
- Surface the mode in the run log (`Scanning iOS design-system package: …`) so a
  zero result is legible rather than mysterious.

### 2. Don't drop public components; do drop debug-only noise

Public `struct X: View` is documented surface. But filter `#if DEBUG` /
preview-only helpers like the private `ColourRow` — they're preview scaffolding,
not API. Heuristic: skip `private`/`fileprivate` structs and structs declared
inside a `#if DEBUG` block; prefer `public` in library mode.

### 3. Colour: tolerate trailing call arguments

Loosen both regexes so `Color("blue", bundle: .module)` matches — accept an
optional `, …` before the close paren in the token-scanner colour matcher and the
resolver's `assetAlias`. Additionally, in library mode, **ingest the asset
catalogue directly**: every `*.colorset` becomes a colour token even if no code
references it (the catalogue is the definition source, mirroring how colours are
already meant to export as the *full set* per
[semantic-token-definitions.md](semantic-token-definitions.md)). `readColorSets`
already parses them; wire its output in as tokens, not just as a resolution map.

### 4. iOS type-definition resolver

Add `buildIosTypeResolver` parallel to the Android one. Read two definition
shapes from `extension Font`:

- `static let nhsTitle = Font.custom(<family>, size: 28, relativeTo: .title)` →
  `{ token: "nhsTitle", family, size: 28, relativeTo: "title" }`.
- (Future-proof) `static let … = Font.system(size:weight:)` for system-font ramps.

Emit the full named ramp as type tokens. This is the iOS half of
`semantic-token-definitions.md` step 3 — note the *actual* shape is
`Font.custom(relativeTo:)`, not the system-font roles that plan sketched; build
the resolver against this fixture.

### 5. Enum-token resolver for spacing / stroke / corner-radius

Add a small Swift enum-token reader: for an `enum FooToken` with a
`var style: <CGFloat|…> { switch self { case .x: return N … } }`, emit
`{ token: caseName, value: N }`. Drives `SpacingToken` (the 2→128 scale),
`StrokeStyle`, and `CornerRadiusToken` (whose value is wrapped in
`CornerRadiusStyle(value:)`). Conservative: only match the clearly-shaped
`case → return literal` switch and skip anything else, per the parser-fuzziness
trade-off already noted in `semantic-token-definitions.md`. This generalises that
plan's "spacing-definition resolver" to the enum idiom this package actually uses.

### 6. Screenshots for a package (separate, optional, sequenced last)

A library can't be launched. Two options, in order of effort:

- **Now:** keep the graceful skip, but make it a first-class "library — no host
  app, previews not rendered" note in the report rather than a scary capture
  error.
- **Later:** generate an ephemeral host: a tiny throwaway SwiftUI app target that
  depends on the package and renders each `#Preview` body, then run the existing
  simulator capture against it. This is the bulk of the effort and is gated behind
  the rest; treat as a follow-up, not a blocker. (Cross-reference
  `component-previews-and-gallery.md` for the existing capture pipeline.)

## Trade-offs

- **Two input shapes to support.** Prototype-app vs. library mode both stay alive,
  selected by `Package.swift` detection with explicit-flag override. Accept it —
  the umbrella roadmap wants the library to become the canonical source, so this
  is the strategic shape, not a fork.
- **Definition resolvers are parser-ish.** Reading enums/extensions is fuzzier
  than reading `.colorset` JSON. Keep every resolver conservative and falling
  back, exactly as colours degrade today; never guess a token.
- **Overlap with `semantic-token-definitions.md`.** That plan owns the
  *full-set / definition-over-usage* token philosophy; this plan supplies the
  concrete iOS resolvers (Font.custom ramp, enum scales) and the package-input
  plumbing that make it real for this specific library. Land the resolver work
  once and reference it from both; this plan should not restate the YAML-export
  shaping that plan owns.
- **Could be obviated by DTCG.** If the system later adopts DTCG + Style
  Dictionary (per the roadmap), these Swift-reading resolvers get replaced by
  reading token JSON. Build them behind the existing resolver/emitter seam so the
  source can be swapped without touching downstream shapes.
- **Screenshots are the expensive, riskiest part.** Quarantining it last keeps the
  high-value, low-risk wins (components + the full token set) shippable on their
  own.

## Sequence

1. **Package detection + library-mode defaults** (component-glob fallback,
   `--include-unused` on, run-log line). Unblocks everything; immediately turns
   "0 components" into the real list.
2. **Public-component discovery + debug-helper filtering.** Tests on the package
   fixture (expect `NHSDivider`, not `ColourRow`).
3. **Colour fixes** — tolerate trailing args in both regexes; ingest `.colorset`
   as tokens in library mode. Expect the full NHS palette with light/dark hex.
4. **iOS type-definition resolver** (`Font.custom` ramp).
5. **Enum-token resolver** (spacing / stroke / corner-radius).
6. **Screenshots** — first the clean "library, no host app" report note; the
   ephemeral-host renderer as a later follow-up.

Add a small checked-in fixture (a trimmed copy of the package layout: one `View`,
one colorset, the `Font`/enum token files) so the scanners and resolvers have
something to test against without depending on the external repo, per
[android-prototype-is-demonhsapp2] precedent of pinning the real target.

Validate end-to-end against `~/Repos/nhsapp-design-system-ios`: a no-flag
`fractionator --ios <pkg>` should yield the component(s), the full colour palette,
the Frutiger type ramp, and the spacing/stroke/corner-radius scales.
