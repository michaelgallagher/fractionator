# Plans

Design plans for Fractionator — what we're building and why. Completed plans move
to [`archive/`](archive/) once shipped, kept for the design rationale.

## Active

| Plan | Status | Summary |
|------|--------|---------|
| [component-catalogue.md](component-catalogue.md) | Core shipped; web/Nunjucks pending | The master plan: scan native + web prototypes, detect components/usages/variants, capture previews, and output a cross-platform catalogue. SwiftUI and Compose are built; the Nunjucks/web path is not. |
| [accessible-report.md](accessible-report.md) | In progress | Make the generated HTML report meet WCAG 2.2 AA (keyboard, focus, labels, APG tabs, motion, landmarks) and adopt [A11Y.md](https://github.com/fecarrico/A11Y.md) as the project's durable accessibility standard under `docs/a11y/`. |
| [native-design-systems.md](native-design-systems.md) | Analysis / roadmap | Umbrella analysis: how Fractionator supports building the NHS iOS/Android design systems and publishing them to the web design system. The legibility principle, the forward-generate vs reverse-extract split, the concept join key as the bridge to web, and the sequence for the three plans below. |
| [semantic-token-definitions.md](semantic-token-definitions.md) | Proposed | Give type and spacing a canonical definition source (like colours have) so they export as the full design-system set with semantic names instead of captured-from-usage with synthesised names. |
| [component-data-export.md](component-data-export.md) | Proposed | Emit website-ready per-component data and publishable images — parallel to the token YAML export — so the Eleventy site can render native component pages without parsing the capture-oriented `catalogue.json`. |
| [web-design-system-bridge.md](web-design-system-bridge.md) | Proposed | Make a shared concept the join key across web/iOS/android and diff native tokens against the web source of truth, so the three systems read as one design system documented three ways with drift made visible. |

## Done (archived)

| Plan | Shipped | Summary |
|------|---------|---------|
| [component-previews-and-gallery.md](archive/component-previews-and-gallery.md) | ✅ | Component-only previews (Part 1) plus a dense gallery grid with a Gallery/List toggle, click-to-drill-in detail modal, platform grouping, and collapsed list detail (Part 2); token deep-linking and spacing-outlier flagging. |
| [style-tokens-tab.md](archive/style-tokens-tab.md) | ✅ | Capture and display design tokens — colours, type sizes, spacing — as a Style tokens tab, plus JSON/Markdown. |
| [missing-and-blank-previews.md](archive/missing-and-blank-previews.md) | ✅ | Why some components produced no image (or a blank one), and the fixes: blank-render detection + fallback (F1), `@Previewable @State` support (F3), and surfacing preview gaps in the report (F5). Both platforms. |
| [preview-component-attribution.md](archive/preview-component-attribution.md) | ✅ | Attribute previews to components from the **preview body** (the components it actually renders), and treat multi-component previews as first-class **showcases**. Both platforms. |

## Authoring a plan

Plans are markdown design docs: the problem, the approach, the trade-offs, and a
recommended sequence. When a plan ships, move it to `archive/` and update the
tables above. Prototype-side follow-ups noted in a plan (e.g. "add a `#Preview`")
stay the prototype owner's responsibility and don't block archiving.
