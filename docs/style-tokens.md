# Style tokens

Alongside components, Fractionator scans every source file for the design tokens
actually in use — **colours**, **type sizes**, and **spacing units** — and
presents them as a palette, type scale, and spacing scale in a **Style tokens**
tab (and as data in the JSON / Markdown outputs).

## What's captured

- **Colours** — named colours are resolved to real hex values for **both** light
  and dark appearances, from asset catalogs (iOS) and theme definitions (Android).
  Colours merge by their light+dark hex *pair*, so an adaptive colour stays
  distinct from a non-adapting "Only" twin, while true synonyms (e.g.
  `textLink` → `nhsBlue`) still merge. Each entry shows its swatch (a split
  light/dark chip for adaptive colours), name and aliases, hex, and usage count.

- **Type sizes** — the font sizes in use, with weight and kind, rendered at their
  actual size as a type scale.

- **Spacing** — the spacing/padding values in use, shown as a scale with a bar per
  value and a usage count.

Each token records the source locations where it appears, so the catalogue
reflects real usage rather than the full design-system definition.

## Implementation

Token capture lives in `src/token-scanner.js`, `src/color-resolver.js`,
`src/type-resolver.js`, and `src/token-catalogue.js` (each with tests), wired
through `src/index.js` and rendered by `src/build-report.js`. The original design
and the six shipped phases are in
[plans/archive/style-tokens-tab.md](plans/archive/style-tokens-tab.md).
