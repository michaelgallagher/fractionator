# Semantic token definitions for type & spacing

Give type sizes and spacing a canonical definition source on each platform — as
colours already have — so Fractionator exports them as the **full design-system
set** with semantic names, not a captured-from-usage sample with synthesised names.

## Problem

Today the token export is asymmetric (`docs/tokens-yaml.md`):

- **Colours** are read from *definitions* — iOS `.colorset` assets + `extension
  Color` aliases, Android `Color(0x…)` palette objects + `colors.xml`
  (`src/color-resolver.js`). The YAML is the full palette whether or not the
  prototype references each token, with real names (`nhsBlue`).
- **Type and spacing** are captured *from usage* (`src/token-scanner.js`,
  `src/type-resolver.js`, `src/token-catalogue.js`). The export is only the scale
  the prototype happens to use, and names are synthesised (`size-16`,
  `spacing-16`) when no semantic role is found.

This is a documented limitation, not a bug — there's no single definition source
for type/spacing the way there is for colour. The consequence for the website is
that the type and spacing pages would be incomplete and weakly named: exactly the
"synthesised name == missing semantics" smell from the
[roadmap](native-design-systems.md).

## Approach

Two halves — one prototype-side, one tool-side — that can land independently.

### Prototype-side (design-system owner)

Define type and spacing as named, semantic tokens in one place per platform, the
way colours already are:

- **iOS** — a spacing scale (`enum NHSSpacing { static let m: CGFloat = 16 … }`)
  and a semantic type ramp (named `Font` roles, e.g. `bodySmall`, `headingL`).
- **Android** — a spacing `object` and a semantic `TextStyle` ramp (or Material 3
  `Typography` roles mapped to NHS names).

This mirrors the web system's semantic-first naming and gives a stable definition
source to read.

### Tool-side (Fractionator)

Add definition resolvers parallel to `src/color-resolver.js`:

- A **spacing-definition resolver** that reads the spacing scale object/enum and a
  **type-definition resolver** that reads the semantic type ramp, each returning
  the full set of `{ token, value/size, weight }`.
- Wire them into `src/token-emitter.js` so `type-sizes.yaml` / `spacing.yaml`
  prefer the **definition** set when one exists, falling back to the existing
  captured-from-usage path when it doesn't. Same pattern colours already use.
- Keep `--token-groups` working for type/spacing too, so the website can segment
  them editorially (e.g. a display ramp vs. a body ramp).

The captured-from-usage path stays as the fallback and as an *adoption* signal:
"defined but unused" and "used but undefined" become reportable, which feeds the
CI-governance idea in the roadmap.

## Trade-offs

- **Two sources of truth during migration.** Until the prototypes adopt the
  definitions, the fallback path still runs. Accept this; gate on "definition
  present?" per platform per token type, exactly like the colour path degrades
  gracefully.
- **Reading a ramp is fuzzier than reading `.colorset`.** Type/spacing definitions
  are ordinary Swift/Kotlin, not a structured asset catalogue, so the resolver is
  parser-ish. Keep it conservative: match a clearly-shaped definition
  (enum/object of named static constants) and fall back rather than guess.
- **Could be obviated by DTCG.** If the systems adopt DTCG + Style Dictionary
  (roadmap), the definition source becomes the token JSON and these resolvers read
  *that* instead of Swift/Kotlin. Build the resolver behind the same emitter seam
  so the source can be swapped later without touching the YAML shapes.

## Sequence

1. Define the spacing/type tokens prototype-side (owner task; not blocking tool
   work — the resolvers can be built against a fixture).
2. Add the spacing-definition resolver + wire into `src/token-emitter.js`; tests.
3. Add the type-definition resolver + wire in; tests.
4. Surface "defined but unused" / "used but undefined" in the catalogue.
5. Update `docs/tokens-yaml.md` (the scope section) and re-run on DemoNHSApp2.
