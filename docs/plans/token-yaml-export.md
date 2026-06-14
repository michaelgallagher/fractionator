# Token YAML export

Emit the design tokens a prototype defines as **YAML data files** that the design
system website (Eleventy + Nunjucks) can consume directly — one file per token
**type** (colours, type sizes, spacing), segmented by **platform**, written into a
`tokens/` folder inside the catalogue output.

## Problem

Fractionator already captures tokens (`src/token-scanner.js` →
`src/token-catalogue.js`) and shows them in the HTML report's *Style tokens* tab.
But that data is:

- **HTML-only / usage-shaped** — it's the palette/scale *as used* in scanned
  source, merged by hex pair, geared to rendering swatches in the report.
- **Not machine-consumable by the website** — the design-system site is built in
  Eleventy + Nunjucks and wants clean YAML *data* it can iterate over, not an
  embedded report.

We want the tool, on every run, to also write YAML the website can drop in. A
sample of the target colour shape lives in
[`colour-token-sample.md`](colour-token-sample.md) — note that the sample is a
full Eleventy *page* (front-matter **plus** a Nunjucks template body). We are
deliberately **not** generating the template body; see Decisions.

## Decisions (settled)

1. **Pure YAML data files** — emit only the token *data* (clean YAML), not the
   `layout:`/`tags:` front-matter or the Nunjucks table markup from the sample.
   Presentation (the `.njk` layout, the swatch table) stays in the website repo,
   which consumes these as data files. Template changes don't force a tool re-run.
2. **Full design-system set** — emit *every defined token*, not just those the
   prototype references. The usage catalogue (`buildTokenCatalogue`) records only
   what appears in source; the website wants the whole palette. So the YAML is
   sourced from the **definitions** (asset catalogs / palette objects), not from
   usage occurrences.
3. **Config-driven colour groups** — semantic groups (Core palette, Greyscale,
   Dark/Pale variants, Fixed colours, …) are editorial and aren't derivable from
   prototype source. An optional grouping config assigns tokens to groups with
   headings/descriptions; without it, colours emit as one default group so the
   pipeline still works out of the box.

## Output layout

```
catalogue-output/
  tokens/
    ios/
      colours.yaml
      type-sizes.yaml
      spacing.yaml
    android/
      colours.yaml
      type-sizes.yaml
      spacing.yaml
```

A platform folder is written only when that platform was scanned. British
spelling (`colours.yaml`) to match the sample and the existing docs.

### Shape — `colours.yaml`

Mirrors the sample's `colourGroups`, minus the page chrome:

```yaml
groups:
  - heading: Accent colour
    description: Set as the tint colour; some native components use it by default.
    colours:
      - token: nhsAccentColor
        light: "#005eb8"
        dark: "#52a0ff"
  - heading: Core palette
    colours:
      - token: nhsBlue
        light: "#0060bf"
        dark: "#2ca2ff"
```

- `dark` is omitted when a token has no dark appearance (e.g. `nhsWarmYellow`,
  the `*Only` fixed colours) — matching the sample.
- Hex strings are quoted and lower-cased `#rrggbb`.

### Shape — `type-sizes.yaml` and `spacing.yaml`

The sample only specifies colours, so we define these. Kept flat and ordered as a
scale:

```yaml
# type-sizes.yaml
sizes:
  - token: footnote      # semantic role name where one exists
    size: 13
    weight: regular      # omitted when unspecified
```

```yaml
# spacing.yaml
spacing:
  - token: spacing-16    # synthesised; values have no source-side name
    value: 16
    unit: pt             # dp on Android
```

## Where the "full set" comes from

Colours have a clean definitional source we already parse — we just need to
expose it. Type sizes and spacing largely do not, so their scope differs:

| Category | iOS source of truth | Android source of truth | Scope |
|----------|---------------------|-------------------------|-------|
| **Colours** | `*.colorset` assets + `extension Color` aliases (`color-resolver.js`) | `Color(0x…)` palette `object`s + `colors.xml` (`color-resolver.js`) | **Full** — every defined token |
| **Type sizes** | system text styles (`SEMANTIC_TYPE_SIZE`) | `Typography(...)` roles + M3 defaults (`type-resolver.js`) | Defined ramp where one exists, else captured-from-usage |
| **Spacing** | none (literals only) | optional `Spacing`/`Dimens` object if present | Defined object if present, else captured-from-usage |

So **colours** are genuinely the full design system; **type/spacing** are
"defined set where a definition exists, otherwise the used scale." This is called
out as a known limitation rather than pretended away — a follow-up can teach the
tool to read an explicit spacing/type token file if the prototypes adopt one.

### Refactor: definition readers

The resolver builders (`buildIosColorResolver`, `buildAndroidColorResolver`,
`buildAndroidTypeResolver`) already read all the definitions internally but only
expose a `resolve(key)` lookup. We surface the underlying maps so the emitter can
enumerate the full set:

- iOS: union of `extension Color` alias names (preferred — these are the API
  names like `nhsBlue`) with any asset that has no alias, each resolved to
  `{light, dark?}`.
- Android: the paired `schemes` map (base scheme + prop → `{light, dark?}`) plus
  `colors.xml` names.

Concretely, have each `build*Resolver` also return a `definitions()` (or list the
maps it built) alongside `resolve`, or factor the map-reading into small exported
helpers the emitter calls directly. Either keeps the parsing logic in one place;
no second parser.

## Token naming

The YAML `token:` is the design-system API name:

- **iOS** — the `extension Color` static name (`nhsBlue`), stripped of the
  `Color.` prefix. Assets without an alias fall back to the (lower-camel) asset
  name.
- **Android** — the palette property name (`blue` from `NHSColors.blue`), or the
  `colors.xml` name. Whether to keep the object prefix is settled during
  implementation against the real DemoNHSApp2 source.

## Grouping config

Optional file, passed via a new `--token-groups <path>` CLI option:

```yaml
# token-groups.yaml
ios:
  colours:
    - heading: Accent colour
      description: Set as the tint colour…
      tokens: [nhsAccentColor]
    - heading: Core palette
      tokens: [nhsBlue, nhsAquaGreen, nhsBlack, …]
    - heading: Greyscale
      tokens: [nhsGrey1, nhsGrey2, …]
android:
  colours: [...]
```

- Groups and the tokens within them emit in config order.
- Any defined token **not** listed lands in a trailing `Other` group, so nothing
  is silently dropped (and missing tokens are visible to whoever curates the
  config).
- No config ⇒ a single default group containing every token. The pipeline always
  produces valid YAML.
- Loader reuses `js-yaml` (already a dependency) and follows
  `mapping-loader.js`'s shape/validation conventions.

## Wiring

- **New module** `src/token-emitter.js` — pure functions that take the
  definition sets + grouping config and return the YAML-ready JS objects
  (`buildColourGroups`, `buildTypeSizes`, `buildSpacing`), plus a `writeTokenYaml`
  that `yaml.dump`s them to `tokens/<platform>/<file>.yaml`. Colocated
  `token-emitter.test.js`.
- **`src/index.js`** — after each platform's catalogue is built, gather that
  platform's definition sets and call the emitter. Guarded by the format flag.
- **CLI / formats** — add `yaml` to the `--format` set and to the default
  (`html,json` → `html,json,yaml`), so a normal run produces the `tokens/` folder.
  Add `--token-groups <path>`. `bin/cli.js` + the `formats` plumbing in
  `index.js`/`build-report.js`.
- **Emitter ownership** — `buildReport` writes the report formats; token YAML is
  a separate concern with its own definition inputs, so it's invoked from
  `index.js` directly rather than threaded through `buildReport`. (Revisit if it
  reads cleaner inside `buildReport`.)

## Trade-offs

- **Definitions vs. usage.** Sourcing from definitions (not the usage catalogue)
  means the YAML can list tokens the prototype never uses — exactly what the
  website wants, but it does double-read the colour sources. Acceptable; the
  reads are cheap and already happen for resolution.
- **British spelling / `colours.yaml`.** Matches the sample and the website's
  expectations; the rest of the codebase already uses "colours" in docs.
- **Type/spacing completeness gap.** Honest scope: these aren't a true "full
  set." Documented, with a clear upgrade path, rather than faked.
- **Config burden for groups.** Faithful grouping needs a curated file. Mitigated
  by the no-config default and the `Other` catch-all.

## Accessibility

The token YAML is **data, not report HTML**, so the report a11y standard
(`docs/a11y/A11Y.md`) doesn't apply to the files themselves. The HTML report is
untouched by this work, so its `build-report.test.js` invariants still hold. No
new a11y surface.

## Sequence

1. **Definition readers** — expose the full colour-definition sets from
   `color-resolver.js` (both platforms); add tests over fixture asset
   catalogs / palette objects.
2. **Emitter (colours)** — `token-emitter.js` building `groups` with the default
   single-group behaviour; `yaml.dump` + file layout; tests.
3. **Grouping config** — `--token-groups` loader + group assignment + `Other`
   catch-all; tests.
4. **Type sizes & spacing** — emit the type ramp (semantic/M3) and spacing scale;
   document the definitions-vs-usage scope; tests.
5. **Wiring** — `--format yaml` (default-on), `index.js` integration, console
   summary line; run end-to-end against DemoNHSApp2 (`--android`) and the iOS
   prototype.
6. **Docs** — short `docs/tokens-yaml.md` (or a section in `docs/output.md`) and
   move this plan to `archive/`.

## Open questions

- **Android token names** — keep the palette-object prefix (`NHSColors.blue`) or
  bare prop (`blue`)? Decide against real DemoNHSApp2 source in step 1.
- **Default formats** — is YAML on by default, or opt-in via `--format`? Leaning
  default-on so "when the tool is run" it just appears; easy to flip.
