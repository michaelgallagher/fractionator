# Accessibility exceptions

Deliberate deviations from [`A11Y.md`](A11Y.md), each with a rationale and the
mitigation that keeps it within WCAG 2.2 AA. Anything here is a conscious choice,
not an oversight — revisit if the report's purpose or audience changes.

## EX-1 — Target sizes below 44×44 CSS px

**Rule:** A11Y.md 🔵 "Target size — aim for 44×44."

**Where:** the detail-modal close button (32px), the Gallery/List toggle and tab
buttons, and the small chips/badges in the cards and token tables.

**Why:** Fractionator's report is a dense, information-rich catalogue (often
hundreds of components and tokens). Enlarging every control to 44px would force a
much sparser layout and undermine the tool's scan-many-at-once purpose.

**Mitigation / why it's still AA:** WCAG 2.2's *Target Size (Minimum)* (2.5.8) is
AA at **24×24** with spacing exceptions, not 44 — every interactive control clears
that. All of these controls also have a full keyboard path (Tab + Enter/Space, or
the surrounding tile/`<details>`), so pointer precision is never the only route.

## EX-2 — Metadata fonts below 12px

**Rule:** A11Y.md "minimum font size 12px; ≤10px needs 7:1 contrast."

**Where:** caption / token-scale / badge labels at `0.62rem–0.7rem` (~10–11px).

**Why:** these are secondary metadata in tightly-packed tables (type scale,
spacing scale, location lines). Bumping them to 12px breaks the table rhythm and
the dense gallery tiles.

**Mitigation / why it's still AA:** the affected text still meets the **4.5:1**
contrast minimum (secondary `#6b7280` is 4.59:1 on the page background, 4.83:1 on
cards), it is never the sole carrier of essential information (full names/values
appear at normal size or in the expandable detail), and the whole report remains
functional at 400% zoom — so users who need larger text can get it.
