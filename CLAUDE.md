# Fractionator — agent guide

Fractionator is a CLI that scans SwiftUI / Jetpack Compose prototypes and produces
a **component catalogue**: a self-contained HTML report (plus JSON and Markdown).
All report rendering — HTML structure, embedded CSS, and embedded browser JS —
lives in three template strings in `src/build-report.js`. Static analysis lives in
the `*-scanner.js` / `*-resolver.js` / `token-*.js` modules. Tests are colocated
`*.test.js` files run with `npm test` (`node --test`).

See [`docs/`](docs/) for architecture and the design plans in
[`docs/plans/`](docs/plans/).

## Plans

Non-trivial work gets a design doc in [`docs/plans/`](docs/plans/) (problem /
approach / trade-offs / sequence) with a row added to `docs/plans/README.md`.
Shipped plans move to `docs/plans/archive/`.

## Accessibility (required)

The generated HTML report MUST meet the standard in
[`docs/a11y/A11Y.md`](docs/a11y/A11Y.md) (WCAG 2.2 AA, adapted from
[fecarrico/A11Y.md](https://github.com/fecarrico/A11Y.md)). When you touch the
report:

- **New interactive element ⇒ keyboard path + visible focus + accessible name.**
  Prefer native `<button>`/`<a>`; if you must make a non-semantic element
  clickable, add `role` + `tabindex` + a key handler. Never use a placeholder as
  the only label.
- Modals trap focus and return it to the trigger; honour
  `prefers-reduced-motion`; announce dynamic changes via `aria-live`.
- Run `npm test` — `src/build-report.test.js` enforces structural invariants (one
  `<h1>`, labelled controls, `alt` on images, tab↔tabpanel pairing, labelled
  dialog). Then do the manual keyboard/zoom pass in
  [`docs/a11y/REPORT.md`](docs/a11y/REPORT.md).
- Any deliberate deviation goes in
  [`docs/a11y/EXCEPTIONS.md`](docs/a11y/EXCEPTIONS.md) with a rationale.
