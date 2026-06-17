# Output

Fractionator writes to `catalogue-output/` (override with `--output`). Formats are
chosen with `--format` (default `html,json,yaml`).

## HTML report (`index.html`)

A single self-contained page — no server needed.

### Tabs

- **Components** — every component, as a **Gallery** contact sheet or a **List**
  of detailed cards (below).
- **Showcases** — one card per multi-component preview, each with its image and a
  chip for every component it renders. See
  [screenshot-capture.md](screenshot-capture.md#multi-component-previews--showcases).
- **Style tokens** — the palette, type scale, and spacing scale. See
  [style-tokens.md](style-tokens.md).
- **Cross-platform alignment** — shown when ≥2 platforms are scanned: shared
  concepts, name drift, and platform-only components. See
  [cross-platform-alignment.md](cross-platform-alignment.md).

Above the cards are **summary stats** (component count, total usages, unused,
single-use) and a **sticky control bar**: search by name, sort (usage count /
name / variant count), and a **Gallery / List** toggle. The view choice is
remembered (localStorage), and both views share the same page width so toggling
never shifts the layout. When **≥2 platforms** are scanned, components are grouped
under platform headings (iOS, Android) instead of interleaving; search and sort
operate within each group.

### Gallery vs. List

- **Gallery** (default) — a responsive grid of compact tiles: one representative
  thumbnail, name, platform, and usage count. The whole catalogue as a contact
  sheet. **Click a tile** to open its full detail in a modal (Esc / backdrop /
  × to close).
- **List** — the full detailed cards in a single column. The preview stays
  visible; the rest (file, signature, usages, variants) is tucked behind a
  collapsed **Details** expander so the list stays scannable.

### Component cards

Each card shows:

- **Preview** — the rendered image(s) in a scrollable strip (with `--variations`,
  grouped by preview with one image per display mode). When a component has no solo
  preview but appears in showcases, the showcase image is shown inline instead.
- **Preview-status badge** — one of:
  - *(image shown)* — captured as an isolated component;
  - **full-screen** — captured, but only as a full-screen fallback;
  - **in showcase** — its image lives in a showcase;
  - **preview skipped** — a preview exists but couldn't be captured, with the
    reason;
  - **no preview** — no `#Preview` / `@Preview` in the source.
- Platform badge, usage count, variant count.
- Source file path.
- **Signature** — parameter names, types, annotations, and defaults.
- **Used in** — the screens that reference the component.
- **Variant breakdown** — style, count, and screens per argument cluster.

Treat the badges as a punch-list: a catalogue with no "no preview" / "skipped"
badges is one where every component renders as intended. To improve coverage, see
[writing-capturable-previews.md](writing-capturable-previews.md).

## JSON (`catalogue.json`)

The full catalogue as structured data: per-platform `components` (each with
`usages`, `variants`, `screenshots`, `appearsIn`, `previewDiagnostics`),
`showcases`, and `tokens`, plus cross-platform `alignment` when applicable. Useful
for CI checks, dashboards, or feeding other tools.

## Markdown (`catalogue.md`)

A summary table for pasting into documentation or design decision records.

## Token YAML (`tokens/`)

Clean, machine-consumable YAML for the design-system website — one file per token
type, segmented by platform:

```
tokens/
  ios/      colours.yaml  type-sizes.yaml  spacing.yaml
  android/  colours.yaml  type-sizes.yaml  spacing.yaml
```

See [tokens-yaml.md](tokens-yaml.md) for the file shapes, the colour-grouping
config (`--token-groups`), and how the scope differs by token type.
