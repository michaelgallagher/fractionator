# Native design systems — analysis & roadmap

How Fractionator supports building the NHS **iOS and Android design systems** and
publishing their documentation to the web design system
([service-manual.nhs.uk](https://service-manual.nhs.uk/design-system)).

This is the umbrella analysis. It frames the strategy and sequences the concrete
plans it spawns:

- [semantic-token-definitions.md](semantic-token-definitions.md) — give type and
  spacing a canonical definition source so they export as full sets.
- [web-design-system-bridge.md](web-design-system-bridge.md) — make a shared
  *concept* the join key across web/iOS/android, and diff native tokens against
  the web source of truth.
- [component-data-export.md](component-data-export.md) — emit website-ready
  per-component data and images for the Eleventy site to render.

## Context

The native systems have a *relationship* to the web design system but lean on
platform conventions — they look different from web, and the goal is to eventually
document all three on the same Eleventy + Nunjucks website. Fractionator is the
start of that pipeline: it reverse-extracts a component + token catalogue from
prototype source and already emits website-ready token YAML (`src/token-emitter.js`).

## The governing principle

**The quality of generated documentation is bounded by how legible the native
code is.** Fractionator is a mirror — it can only document what the source makes
discoverable — and it already *rewards* legible structure and *punishes* its
absence:

- Colours export as the **full design-system set** because a definition source
  exists (`.colorset` + `extension Color`, `colors.xml` + palette objects). Type
  and spacing only export **captured-from-usage** — lossy, incomplete — because
  there's no canonical definition source.
- Tokens with a semantic alias get a real name (`nhsBlue`); those without fall
  back to synthesised junk (`size-16`, `spacing-16`). A synthesised name is a
  smell: the native layer lacks semantics there.
- Cross-platform matching is *free* when names are consistent (`NHSCard` ↔
  `NHSCardUI`) and needs hand-curated mappings when they aren't.

So the biggest wins are upstream, in how the native systems are written, not in
tool features. Two design rules follow:

1. **Make the native code self-describing.** Semantic token definitions for every
   token type; the design system shipped as an importable Swift Package / Android
   library (not buried in app screens) so Fractionator scans the *library* and the
   public API surface == the documented surface; a `NHS<Concept>` naming
   convention so alignment is automatic.
2. **Keep the data ⇄ presentation contract.** Fractionator emits pure *data*; the
   website owns *rendering*. The token YAML (one file per type, per platform,
   `do not edit` banner) is the model — extend that contract to components, never
   ship layout from the tool.

## The bridge to the web design system

The single architectural move that turns three parallel catalogues into *one
design system documented three ways* is a **shared concept id**. The cross-platform
matcher (`src/cross-platform-matcher.js`) already has a `concept` notion for
iOS↔Android via `component-mapping.yaml`. Extend it to carry `web:` alongside
`ios:`/`android:`, keyed to the web component's canonical id (`card`, `button`,
`care-card`…). Then a single service-manual page for "Card" renders Web / iOS /
Android from one shared key. Detailed in
[web-design-system-bridge.md](web-design-system-bridge.md).

## Forward-generate vs. reverse-extract

Keep Fractionator in its lane: it is a **reverse-extract + verify** tool. The
emerging interchange standard for tokens is W3C **Design Tokens (DTCG) JSON**, and
the mature transformer is **Style Dictionary**. The robust long-term split:

- **Forward-generate the primitives.** Define tokens once (ideally DTCG) and let
  Style Dictionary emit the Swift/Kotlin code *and* feed the web. One source of
  truth for colour/type/spacing values.
- **Reverse-extract the rest.** Fractionator catalogues components, captures
  previews, measures adoption/usage, and verifies that prototype code actually
  *uses* the defined tokens.

If the native systems adopt a canonical token definition (see
[semantic-token-definitions.md](semantic-token-definitions.md)), Fractionator's
token role shifts from "infer the palette from code" to "confirm the code uses the
tokens" — strictly better, and it dissolves the captured-from-usage limitation.
**Do not** grow Fractionator into a token transformer; that duplicates Style
Dictionary.

## Considered / later

Captured here so the thinking isn't lost; not yet planned in detail.

- **Accessibility extraction.** Surface per-component a11y facts from source —
  `.accessibilityLabel` / `contentDescription` / `semantics`, Dynamic Type
  support, min tap target. High-value documentation that reinforces the project's
  own a11y standard (`docs/a11y/`).
- **CI governance.** Run Fractionator on the prototype repos and warn/fail on
  regressions: a component lost its preview, a raw hex appeared that isn't a
  token, a native colour drifted from web. Turns the catalogue from a report into
  a guardrail.
- **Versioned snapshots → changelog.** Diff catalogue runs over time
  (added/removed components, new variants, token changes) to auto-draft
  design-system release notes.
- **Web/Nunjucks scanner.** Already noted as pending in
  [component-catalogue.md](component-catalogue.md); it's the natural source of the
  canonical web concept (see the bridge plan).

## Recommended sequence

1. **[semantic-token-definitions.md](semantic-token-definitions.md)** — foundational;
   unlocks full-set type/spacing exports and better names everywhere downstream.
2. **[component-data-export.md](component-data-export.md)** — the publishing path;
   gets native component docs onto the website.
3. **[web-design-system-bridge.md](web-design-system-bridge.md)** — the
   relationship to web: concept join key + native↔web token drift.

Token-definition work (1) is partly prototype-owner responsibility (define the
tokens) and partly tool work (read them as the full set); the two halves can land
independently.
