# Accessibility audit — generated HTML report

Audit of `src/build-report.js` output against [`A11Y.md`](A11Y.md). Re-run the
manual checks whenever the report's interactive layer changes.

_Last audited: 2026-06-13._

## Findings & status

| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | 🔴 | Gallery tiles opened the modal on click only — no keyboard path | ✅ Fixed — tiles get `role="button"` + `tabindex` (gallery only) and an Enter/Space handler |
| 2 | 🔴 | Detail modal didn't trap focus or restore it to the trigger | ✅ Fixed — Tab trap + `modalTrigger.focus()` on close |
| 3 | 🔴 | Screenshot lightbox expanded a raw `<img>` (not focusable) | ✅ Fixed — wrapped in `<button class="screenshot-btn">`; focus moves to overlay and back |
| 4 | 🟠 | `#search` used placeholder as sole label; `#sort` wrapped in an empty `<label>` | ✅ Fixed — `<label for>` for both; region labelled |
| 5 | 🟠 | No visible focus indicator except `#search` | ✅ Fixed — global `:focus-visible` outline (2px) with tuned offsets |
| 6 | 🟡 | Tablist incomplete (no tabpanel roles, no arrow-key nav) | ✅ Fixed — `role="tabpanel"` + `aria-labelledby`, roving tabindex, arrow/Home/End |
| 7 | 🟡 | Filtering gave no screen-reader feedback | ✅ Fixed — `role="status" aria-live="polite"` result count |
| 8 | 🟡 | No reduced-motion support | ✅ Fixed — `@media (prefers-reduced-motion: reduce)` |
| 9 | 🟡 | No `<main>` landmark or skip link | ✅ Fixed — `<main id="main">` + skip link |
| 10 | 🟡 | Modal had a generic `aria-label` | ✅ Fixed — `aria-labelledby` → component name |
| — | — | Contrast (secondary text, badges) | ✅ Pass — all ≥ 4.5:1 text / ≥ 6:1 badges, light & dark |
| — | 🔵 | 44×44 targets / 12px min font | ⚠️ Exception — see [`EXCEPTIONS.md`](EXCEPTIONS.md) |

## Automated checks
`npm test` asserts: one `<h1>`, `lang` set, skip link + `<main>`, every `<img>` has
`alt`, every form control is labelled, every `role="tab"` maps to a `role="tabpanel"`,
and the modal is a labelled `role="dialog"`. (`src/build-report.test.js`.)

## Manual checks (re-run on interactive changes)
- [ ] Tab from the top: skip link → search → sort → view toggle → tabs → first tile.
- [ ] Enter/Space on a gallery tile opens the modal; focus lands on Close.
- [ ] Tab is trapped inside the modal; Esc closes it; focus returns to the tile.
- [ ] Left/Right (and Home/End) move between tabs; the panel follows.
- [ ] Enter/Space on a screenshot opens the lightbox; Esc closes it; focus returns.
- [ ] Type in the filter — a screen reader announces the result count.
- [ ] 400% browser zoom: still usable, no clipped controls.
- [ ] Focus rings are visible in both light and dark `prefers-color-scheme`.
- [ ] Optional: a browser axe-core / Lighthouse pass reports no new violations.
