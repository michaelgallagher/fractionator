# Output

Fractionator writes to `catalogue-output/` (override with `--output`). Formats are
chosen with `--format` (default `html,json`).

## HTML report (`index.html`)

A single self-contained page — no server needed.

### Tabs

- **Components** — one card per component (below).
- **Showcases** — one card per multi-component preview, each with its image and a
  chip for every component it renders. See
  [screenshot-capture.md](screenshot-capture.md#multi-component-previews--showcases).
- **Style tokens** — the palette, type scale, and spacing scale. See
  [style-tokens.md](style-tokens.md).
- **Cross-platform alignment** — shown when ≥2 platforms are scanned: shared
  concepts, name drift, and platform-only components. See
  [cross-platform-alignment.md](cross-platform-alignment.md).

Above the cards are **summary stats** (component count, total usages, unused,
single-use) and **filter/sort** controls (search by name; sort by usage count /
name / variant count).

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
