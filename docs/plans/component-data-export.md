# Component data export for the website

Emit website-ready, per-component **data** and **images** — parallel to the token
YAML export — so the Eleventy + Nunjucks design-system site can render native
component pages without parsing Fractionator's capture-oriented `catalogue.json`.

## Problem

The token export got the contract right: pure data, one file per type per
platform, `do not edit` banner, website owns presentation (`src/token-emitter.js`,
`docs/tokens-yaml.md`). Components have no equivalent. The only structured
component output is `catalogue.json` — the full catalogue, but it's monolithic and
**capture-oriented**: it carries `previewDiagnostics`, internal screenshot keys,
and platform-only structure that's noise to a documentation site. There's also no
stable per-component identity to key a website page off, and the captured images
are debug artifacts, not publishable assets.

## Approach

Two outputs, both consumed by the website as Eleventy data.

### Component data (`components/<platform>/*.yaml` or a single data file)

Per component, the fields a doc page actually needs:

- **`id`** — stable, kebab-cased concept id (the join key from
  [web-design-system-bridge.md](web-design-system-bridge.md)); falls back to the
  normalised component name until a mapping assigns one.
- **`name`**, **`platform`**.
- **`parameters`** — name, type, default, annotation → renders as a props table.
  (From the scanner signatures already captured.)
- **`variants`** — the argument clusters from `src/variant-grouper.js`, as the
  documented variant list.
- **`images`** — references into the image export below (light/dark, per variant).
- **`status`** — derived from the existing preview badges (image / showcase /
  no-preview), so the site can flag undocumented components.

Pure data, `do not edit` banner, written only for scanned platforms — same rules
as tokens. Lives alongside the token emitter (a `component-emitter.js`), fed by the
per-platform assembly already built in `src/index.js`.

### Publishable images (`images/` + a manifest)

Distinct from the in-report capture: deterministic, themed (light + dark, default
Dynamic Type), transparent background, retina, named/keyed by component id and
variant, content-hashed so commits to the site repo are clean diffs. A manifest
maps `id` → image paths; the component data references it. Reuse the existing
capture pipelines (`swift-screenshot-capture.js`, `kotlin-screenshot-capture.js`);
add an export-shaped writer rather than a new renderer.

## Trade-offs

- **Don't duplicate `catalogue.json`.** This export is a curated *subset* shaped
  for publishing, not a second full dump. `catalogue.json` stays for CI/dashboards;
  the component data is the website contract.
- **Image determinism is the hard part.** Backgrounds, scale, theme, and Dynamic
  Type must be pinned or the site repo churns on every run. Pin them explicitly in
  the export writer; this is why it's a separate path from in-report capture.
- **Id stability depends on the bridge plan.** Until concept ids exist, fall back
  to normalised names; this means early image filenames may rename once mappings
  land. Acceptable — content hashing limits the blast radius.

## Sequence

1. `component-emitter.js` (data only, no images) + tests; wire into `src/index.js`
   and the `--format` handling.
2. Add the export image writer + manifest behind a flag; reuse the capture
   pipelines.
3. Document the file shapes in a new `docs/component-data.md` (sibling to
   `tokens-yaml.md`) so the website team has a contract.
4. Re-run on DemoNHSApp2; confirm the Eleventy site can consume it.
