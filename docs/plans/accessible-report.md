# Accessible report

Make the generated HTML report meet WCAG 2.2 AA, and adopt
[A11Y.md](https://github.com/fecarrico/A11Y.md) as the project's durable
accessibility standard so it stays that way.

## Problem

Fractionator's product is the self-contained HTML report (`src/build-report.js` →
`index.html`). Its static structure already has a reasonable baseline — `lang`,
a heading hierarchy, `alt` text, `aria-pressed`, `role="dialog"`, semantic
`<table>`/`<details>`. But the **interactive layer is mouse-only in several
places**, which is the most severe class of accessibility failure:

- Gallery tiles open the detail modal on click only — no keyboard path.
- The detail modal sets `aria-modal="true"` but doesn't trap focus or return focus
  to the trigger on close.
- The screenshot lightbox expands a raw `<img>` on click — not focusable or
  keyboard-operable.
- The filter `<input>` uses its placeholder as the sole label, and the sort
  `<select>` is wrapped in an empty `<label>`, so neither has an accessible name.
- Only `#search` has a visible focus ring; every other control relies on the UA
  default, which the resets suppress in places.

A contrast audit found colours are **not** a defect: secondary text `#6b7280` is
4.59:1 on the page background / 4.83:1 on cards, and every badge pair clears 6:1+
in both light and dark themes.

## Approach

Two tracks.

### Track A — remediate the report (`src/build-report.js`)

Fix in A11Y.md severity order, **keeping the dense layout** (decision below).

**Critical (keyboard & focus)**
1. Gallery tiles: `role="button"` + `aria-label` on the card, `tabindex` toggled
   per view in `applyView`, and an Enter/Space `keydown` handler on `#components`.
2. Modal: remember the trigger element, trap Tab within the open dialog, and
   restore focus to the trigger on close.
3. Screenshot lightbox: wrap clickable previews in a `<button class="screenshot-btn">`
   with an `aria-label`; move focus to the overlay on expand and back on collapse.

**High (labels & focus indicator)**
4. `aria-label="Filter components"` on `#search`; a real (visually-hidden) label
   for `#sort`; `role="search"` on `.controls`.
5. A global `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`
   plus tuned offsets for the grouped buttons whose containers clip overflow.

**Medium (APG, dynamic feedback, motion, landmarks)**
6. Complete the APG tab pattern: `role="tabpanel"` + `aria-labelledby` + `tabindex`
   on panels, tab-button `id`s, roving tabindex, and arrow/Home/End key nav.
7. An `aria-live="polite"` status region announcing the filtered result count.
8. A `prefers-reduced-motion` block disabling transitions and hover transforms.
9. A `<main>` landmark + a skip-to-content link.
10. Label the modal via `aria-labelledby` pointing at the cloned card title.

### Track B — adopt the standard

- Vendor the ruleset under `docs/a11y/` (`A11Y.md`, a filled-in `REPORT.md` audit,
  and `EXCEPTIONS.md`), attributed to the source repo.
- Add a root `CLAUDE.md` requiring the report to satisfy `docs/a11y/A11Y.md` —
  new interactive elements need a keyboard path, visible focus, and an accessible
  name; deviations are logged in `EXCEPTIONS.md`.
- Add structural a11y assertions to `src/build-report.test.js` (one `<h1>`, every
  `<img>` has `alt`, every form control has a name, every `role="tab"` has a
  matching panel, the modal is a labelled `role="dialog"`).

## Trade-offs

- **Density vs. A11Y.md's 44×44 target size and 12px font minimum.** The compact
  gallery/token UI uses 32px controls and 10–11px metadata labels. Decision: keep
  the density and fix *correctness* (keyboard, focus, names, semantics); log the
  two size rules as deliberate exceptions in `docs/a11y/EXCEPTIONS.md`, justified
  by full keyboard equivalence and contrast that still passes 4.5:1.
- **Tab pattern interactivity.** Full APG arrow-key nav is more JS than strictly
  required for AA, but it's the documented pattern and cheap to add given the tab
  scaffolding already exists.
- **No browser-based axe in CI.** The report is a generated string, so we assert
  structural invariants without a headless browser (no new heavy deps); a manual
  axe/Lighthouse pass stays an optional verification step.

## Sequence

1. Track A critical fixes (gallery keyboard, modal trap, lightbox button).
2. Track A high fixes (control labels, global focus-visible).
3. Track A medium fixes (tabs APG, live region, reduced motion, landmarks).
4. Track B: vendor `docs/a11y/`, add `CLAUDE.md`, add structural tests.
5. Verify: `npm test`, generate a report, keyboard-only pass, 400% zoom.
