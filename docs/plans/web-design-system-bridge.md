# Web design system bridge

Make a shared **concept** the join key across web / iOS / android, and diff native
tokens against the web design system's source of truth — so the three systems read
as one design system documented three ways, with their drift made visible.

## Problem

Fractionator aligns iOS↔Android today (`src/cross-platform-matcher.js`,
`component-mapping.yaml`) but the **web** design system — the canonical relative —
is outside the model entirely. Two gaps follow:

1. **No shared identity with web.** A component documented on the service manual
   has a web identity (`card`, `care-card`, `button`); the native catalogue has no
   link to it, so the website can't render "Card" as one page with Web / iOS /
   Android views.
2. **No fidelity check against web tokens.** The native colour sets are exported
   in isolation. Whether `nhsBlue` still matches the web `#005eb8`, or has drifted,
   is invisible — yet "relationship to the web system" is the whole point.

## Approach

Two tracks, both reusing existing alignment machinery.

### Track A — concept join key across all three platforms

Extend the mapping from a 2-platform to an n-platform concept:

```yaml
# component-mapping.yaml
mappings:
  - concept: card            # canonical id, matches the web component
    web: card
    ios: NHSCard
    android: NHSCardUI
```

- Add `web:` (and a stable `concept` id) to the mapping schema in
  `src/mapping-loader.js`; surface unmatched web ids the same way unmatched
  native names are surfaced today.
- Have `--init-mapping` (`src/mapping-generator.js`) seed `concept`/`web` slots
  from the detected components so curation starts from a draft.
- Carry the concept id through assembly (`src/index.js`) so it flows into the
  component data export ([component-data-export.md](component-data-export.md)) as
  the page key.
- The website then groups by `concept` and renders per-platform tabs.

The canonical web ids can be supplied by hand initially; the
**Nunjucks/web scanner** already noted as pending in
[component-catalogue.md](component-catalogue.md) is the eventual automatic source —
once it lands, web becomes a scanned platform and the same matcher populates `web:`.

### Track B — native↔web token drift

The same shape as cross-platform alignment, pointed at the web token source:

- Ingest the web design system's token values (its published colour/type/spacing
  source) into a comparable set.
- Diff against the resolved native sets (`src/color-resolver.js` and, post
  [semantic-token-definitions.md](semantic-token-definitions.md), the type/spacing
  definitions): **matches** (native hex == web hex), **drift** (mapped concept,
  different value — deliberate platform divergence or an accident to fix), and
  **platform-only** (native token with no web counterpart).
- Report it as a "fidelity" view in the catalogue and as data the website can
  publish, so intentional divergence is documented and accidental drift is caught.

## Trade-offs

- **The web token source format is unknown to the tool.** Treat ingestion behind a
  small adapter so the comparison logic doesn't care whether the source is SCSS, a
  tokens file, or DTCG JSON. If the systems move to DTCG (roadmap), this adapter is
  where it plugs in.
- **Drift is expected, not always wrong.** The native systems *intend* to differ.
  The view must distinguish "deliberate divergence" (record it) from "accidental
  drift" (flag it) — so a per-concept `divergence: intentional` note in the
  mapping is worth supporting, rather than treating every mismatch as an error.
- **Schema change to a curated file.** Adding `web:`/`concept` touches
  hand-maintained `component-mapping.yaml` files. Keep `ios:`/`android:`-only
  entries valid (concept optional, defaults to the normalised name) so existing
  mappings don't break.

## Sequence

1. Track A: extend `mapping-loader.js` schema (`concept`, `web`) + `--init-mapping`
   seeding; tests. Carry `concept` through `index.js`.
2. Wire `concept` into the component data export as the page key.
3. Track B: web-token ingestion adapter + the native↔web diff; tests.
4. Add the fidelity view to the report and the exported data.
5. (Later) the Nunjucks/web scanner makes `web:` auto-populated rather than
   hand-supplied — folds into [component-catalogue.md](component-catalogue.md).
