# How component detection works

Fractionator finds component definitions, every place they're used, and how
they're parameterised — all by static analysis, no build required.

## SwiftUI

Components are `struct` types conforming to `View` in files matching the component
directory glob (default `**/Components/**/*.swift`). The scanner:

- Strips comments (including nested block comments).
- Finds `struct FooBar: View` declarations.
- Extracts stored properties as the component **signature**, filtering out
  internal state (`@State`, `@Environment`, `@StateObject`, `private`).
- Scans all `.swift` files for `FooBar(` and `FooBar {` call sites.
- Skips self-references (the component's own file) and `#Preview` blocks.
- Identifies the enclosing view at each call site.

## Jetpack Compose

Components are `@Composable fun` declarations in files matching the component
directory glob (default `**/components/**/*.kt`). The scanner:

- Strips comments (line and block).
- Finds `@Composable fun FooBar(...)` declarations, skipping `@Preview` and
  `private` functions.
- Extracts function parameters as the **signature**, with types and default
  values.
- Merges function overloads (e.g. `BadgeIcon` with `ImageVector` and `Painter`
  variants) into a single entry.
- Scans all `.kt` files for `FooBar(` call sites.
- Skips self-references and `@Preview` function bodies.
- Identifies the enclosing composable at each call site.

## Nunjucks (planned)

`{% macro %}` definitions in `.njk` files, with parameter keys inferred from
call-site object literals. Not yet implemented — see
[plans/component-catalogue.md](plans/component-catalogue.md).

## Usages

Every call site is recorded with its file, line number, raw arguments, and the
enclosing view/screen — so a component's "Used in" list reflects real references
across the codebase, not just its definition.

## Variants

Call sites are clustered by the arguments passed, so you can see how many distinct
*styles* of a component exist — e.g. `NHSSection` called with 11 different
border/background colour combinations. Each variant records its argument signature,
how many times it occurs, and which screens use it.
