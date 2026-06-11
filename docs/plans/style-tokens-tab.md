# Plan: Style Tokens tab

> **Status: implemented.** All six phases shipped. New modules
> `src/token-scanner.js`, `src/color-resolver.js`, `src/token-catalogue.js`
> (each with a `*.test.js`), wired through `src/index.js` and rendered by
> `src/build-report.js` (HTML tab + Markdown tables + JSON). One refinement
> against the original plan: colors merge by the **light+dark** hex pair (not
> light alone) so adaptive colors stay distinct from their non-adapting "Only"
> twins, while true synonyms (e.g. `textLink` → `nhsBlue`) still merge.

Capture, catalogue, and display the design tokens used across the scanned
prototypes — **colors**, **type sizes**, and **spacing units** — as a new tab in
the HTML output (and as data in the JSON / Markdown outputs).

## Why this is worth doing

Fractionator already answers "what components exist and how are they used." The
natural next question for a design system is "what *primitives* do those
components draw on, and how consistent are they." A token tab surfaces:

- the **palette actually in use** (not the palette someone documented), with real
  color swatches and usage counts;
- the **type scale** — which sizes/styles appear and how often;
- the **spacing scale** — the set of distinct spacing values, which immediately
  exposes outliers (e.g. a stray `spacing: 17` among a clean 4/8/12/16/24 system).

## Feasibility — verified against the real prototypes

I sampled the two prototypes currently in `catalogue.json`
(`nhsapp-ios-demo-v2`, `DemoNHSApp2`). Tokens are abundant and, importantly,
**resolvable to real values**:

**iOS (`Color.nhsGreen`, `Color("NHSWhite")`, `.system(size: 40)`, `spacing: 16`)**
- Named asset colors resolve to hex via the asset catalog:
  `Assets.xcassets/**/<Name>.colorset/Contents.json` carries sRGB components for
  **both light and dark** appearances. We can render true swatches.
- Semantic `Color.nhsGreen` are code extensions
  (`extension Color { static let nhsGreen = Color("NHSGreen") }`) — parse those to
  chain `nhsGreen → "NHSGreen" → hex`.
- Type: semantic styles (`.body`, `.title3`, `.subheadline`) **and** explicit
  `.system(size: N, weight: W)`.
- Spacing: `spacing: N`, `.padding(N)`, `.padding(.vertical, N)`.

**Android (`Color(0xFFED8B00)`, `16.dp`, `16.sp`, `MaterialTheme.colorScheme.*`)**
- Literal `Color(0xAARRGGBB)` is already a hex value.
- Named defs (`val blue = Color(0xFF005EB8)`) resolve names → hex.
- `MaterialTheme.colorScheme.*` / `MaterialTheme.typography.*` are semantic refs we
  list by name (unresolved, tagged "theme").
- Type: `N.sp`. Spacing: `N.dp` (the dominant signal — e.g. `16.dp` ×494).

Conclusion: regex-level extraction over the **already-collected** file lists
(`allSwiftFiles`, `allKotlinFiles`) is sufficient. No build step, no Xcode/SDK,
runs in the fast static path.

## Architecture

Mirror the existing scanner split. New modules:

| File | Responsibility |
|---|---|
| `src/token-scanner.js` | Core: given a file list + a **platform token-spec** (regex set), emit raw token occurrences `{ category, raw, value, line, relativePath }`. Reuses the comment-stripping helpers already exported by the component scanners. |
| `src/color-resolver.js` | Build a `name → { light, dark }` hex map. iOS: walk `*.colorset/Contents.json` + parse `extension Color` aliases. Android: parse `val X = Color(0x…)` defs (and `res/values/colors.xml` if present). |
| `src/token-catalogue.js` | Aggregate occurrences → unique tokens with `count` and `locations[]`, attach resolved values, sort by frequency, split into `{ colors, typography, spacing }`. |

`src/index.js` wires it in per platform (alongside the existing
`scanUsages` / `groupVariants` calls) and writes `catalogue.tokens[platform]`.

`src/build-report.js` gains a **Style tokens** tab + a `renderTokens()` section,
plus token output in `renderMarkdown()` and (free) in the JSON dump.

### Data shape (added to the catalogue object)

```jsonc
"tokens": {
  "ios": {
    "colors": [
      { "key": "NHSGreen", "display": "Color.nhsGreen",
        "value": { "light": "#ED008B", "dark": "#FFA140" },
        "kind": "asset",            // asset | literal | semantic
        "count": 8,
        "locations": [ { "relativePath": "...", "lineNumber": 42 } ] }
    ],
    "typography": [
      { "key": "title3", "display": ".title3", "kind": "semantic", "count": 13, "locations": [...] },
      { "key": "system-40-bold", "display": ".system(size: 40, weight: .bold)",
        "kind": "explicit", "size": 40, "weight": "bold", "count": 2, "locations": [...] }
    ],
    "spacing": [
      { "value": 16, "unit": "pt", "count": 35, "contexts": ["spacing","padding"], "locations": [...] }
    ]
  },
  "android": { ... }   // unit "dp"/"sp", hex from literals/named defs
}
```

Each token carries `locations` so the UI can deep-link the same way component
cards already do.

### Extraction rules (per category)

**Colors**
- iOS: `Color\.([a-zA-Z][\w]*)`, `Color\("([^"]+)"\)`, `Color\(red:…green:…blue:…\)`.
  Resolve via color-resolver; `kind` = asset/literal; `Color.primary` etc. that
  don't resolve → `semantic`.
- Android: `Color\(0x([0-9A-Fa-f]{6,8})\)` (literal), bare `Color\.(White|Black|…)`,
  `MaterialTheme\.colorScheme\.(\w+)` (semantic), and named `val … = Color(0x…)`.

**Typography (type sizes)**
- iOS: `\.system\(size:\s*(\d+)(?:,\s*weight:\s*\.(\w+))?\)` and the semantic set
  `\.(largeTitle|title3?|title2|headline|subheadline|body|callout|footnote|caption2?)`.
- Android: `(\d+)\.sp`, `fontSize\s*=\s*(\d+)\.sp`, `MaterialTheme\.typography\.(\w+)`.

**Spacing**
- iOS: `spacing:\s*(\d+)`, `\.padding\((\d+)\)`, `\.padding\(\.\w+,\s*(\d+)\)`.
- Android: `(\d+)\.dp`.

Comment-stripping is applied first (helpers already exist) so commented-out code
doesn't pollute counts. String-literal contents are ignored for spacing/type.

## UI — the Style tokens tab

Add a third tab button (the tab bar currently appears only when alignment
exists; switch it to "show whenever there's more than one panel"). Panel layout,
one block per platform, each with three sub-sections:

- **Colors** — a swatch grid. Each chip: the rendered color (split light/dark
  diagonally when both exist), the token name, hex, and usage count. Sort by
  count desc; click → expandable location list.
- **Type scale** — rows sorted by resolved point size where known (explicit sizes
  first, then semantic styles grouped separately), showing the label, a live
  preview rendered at that size, and count.
- **Spacing scale** — a horizontal ruler / bar list of the distinct values in
  ascending order, bar length ∝ value, count as the label. Visually exposes the
  rhythm and any off-scale outliers.

Reuse the existing CSS variables, card/section classes, and the tab JS (it
already toggles `.tab-panel.hidden`). No new dependencies.

## Build phases

1. **Scanner core + specs** — `token-scanner.js` with iOS & Android specs; unit
   tests in `token-scanner.test.js` (follow the existing `*.test.js` pattern) over
   fixture snippets. *No UI yet.*
2. **Color resolver** — asset-catalog + named-def resolution, with a graceful
   fallback (unresolved → shown by name, no swatch). Tests for both platforms.
3. **Aggregation + catalogue wiring** — `token-catalogue.js`, hook into
   `index.js`, emit `catalogue.tokens`. Verify via JSON output + a console summary
   line (`"   N colors, M type sizes, K spacing units"`).
4. **HTML tab** — `renderTokens()` + CSS + tab-bar generalization.
5. **Markdown** — token tables in `renderMarkdown()`.
6. **Docs** — README feature bullet; mention it's part of the static (no-build) path.

## Decisions / defaults (open to override)

- **Always on**, like usage scanning — it's fast and static. Add `--no-tokens`
  only if noise becomes an issue; not in the MVP.
- **Per-platform, not merged.** Tokens stay grouped by platform rather than
  unified into one cross-platform scale. A future enhancement could align them
  (e.g. "iOS 16pt ≈ Android 16dp"), but that's out of scope here and parallels the
  existing cross-platform alignment tab.
- **Resolved values are best-effort.** Anything we can't resolve is still listed
  by name/usage so the catalogue stays complete.

## Risks / edge cases

- Asset catalogs sometimes store colors as hex strings or `display-p3` rather than
  `srgb` float components — the resolver handles both component-float and
  `8-bit`/hex forms, and skips gracefully on anything unexpected.
- `Color.primary` / `.secondary` are SwiftUI system semantics, not custom tokens —
  flag as `semantic` so they don't masquerade as brand colors.
- Spacing numbers are noisy by nature (a literal `0` is common). We keep the full
  distribution but the UI emphasizes the recurring scale; a `count >= 2` filter on
  the spacing view is a cheap way to hide one-offs if desired.
- Android dark/light colors live in M3 theme builders, not asset catalogs — MVP
  resolves literals + named defs and tags `colorScheme.*` as theme refs without a
  swatch; full theme resolution is a follow-up.
