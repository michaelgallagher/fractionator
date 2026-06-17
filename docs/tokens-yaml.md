# Token YAML export

On every run (whenever `yaml` is in `--format`, which it is by default),
Fractionator writes the prototype's design tokens as clean YAML data files for the
design-system website (Eleventy + Nunjucks) to consume — one file per token
**type**, segmented by **platform**:

```
catalogue-output/tokens/
  ios/      colours.yaml  type-sizes.yaml  spacing.yaml
  android/  colours.yaml  type-sizes.yaml  spacing.yaml
```

A platform folder is written only when that platform was scanned. Each file is
pure **data** — no layout or template markup — so the website owns presentation
and consumes these as Eleventy data files. Each carries a `# generated … do not
edit by hand` banner.

## Shapes

### `colours.yaml`

A list of groups, each with optional `heading`/`description` and its colours.
`dark` is omitted for tokens with no dark appearance; hex is quoted and
lower-cased.

```yaml
groups:
  - heading: Core palette
    description: The main brand colours.
    colours:
      - token: blue
        light: "#005eb8"
        dark: "#3698ff"
      - token: warmYellow
        light: "#ffb81c"
```

Without a grouping config (see below) every colour lands in a single untitled
group.

### `type-sizes.yaml`

```yaml
sizes:
  - token: bodySmall   # semantic role name, or a synthesised "size-16"
    size: 12
    weight: bold       # omitted when unspecified
```

### `spacing.yaml`

```yaml
spacing:
  - token: spacing-16  # synthesised; spacing values have no source-side name
    value: 16
    unit: dp           # pt on iOS
```

## Scope: full set vs. captured-from-usage

- **Colours are the full design-system set** — every defined token, whether or
  not the prototype references it. They're read from the definitions (iOS
  `*.colorset` assets + `extension Color` aliases; Android `Color(0x…)` palette
  objects + `colors.xml`), with high-contrast variants excluded so the export is
  the default palette.
- **Type sizes and spacing are captured from usage** — the scale the prototype
  actually uses, since neither has a single design-system definition source the
  way the colour palette does. This is a deliberate, documented limitation; if a
  prototype adopts an explicit type/spacing token definition, a future change can
  read it as the full set.

## Token names

- **iOS colours** — the `extension Color` alias name (`nhsBlue`); assets without
  an alias fall back to the asset name.
- **Android colours** — the palette property name (`blue`, `paleBlue`).
- **Type sizes** — the semantic role (`bodySmall`), or `size-N(-weight)` for
  explicit sizes.
- **Spacing** — `spacing-N`.

## Colour grouping (`--token-groups`)

The semantic grouping of colours (Core palette, Greyscale, Dark/Pale variants,
Fixed colours, …) is editorial and isn't derivable from prototype source, so it's
supplied by an optional config:

```yaml
# token-groups.yaml — keyed by platform, then category
android:
  colours:
    - heading: Core palette
      description: The main brand colours.
      tokens: [blue, green, red, …]
    - heading: Greyscale
      tokens: [grey, grey2, grey3, grey4, grey5]
ios:
  colours: [...]
```

Run with `--token-groups token-groups.yaml`. Groups and the tokens within them
emit in config order. Any defined colour the config doesn't place falls into a
trailing **`Other`** group, so nothing is silently dropped and gaps in the config
stay visible. Token names that don't match a defined colour are skipped.

## Implementation

The export lives in `src/token-emitter.js` (YAML shapes + file writing) and
`src/token-groups-loader.js` (the grouping config), fed by the full colour
definitions exposed from `src/color-resolver.js` and the usage catalogue from
`src/token-catalogue.js`, wired through `src/index.js`. Each has colocated tests.
The original design is in
[plans/archive/token-yaml-export.md](plans/archive/token-yaml-export.md).
