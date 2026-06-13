# Plans

Design plans for Fractionator — what we're building and why. Completed plans move
to [`archive/`](archive/) once shipped, kept for the design rationale.

## Active

| Plan | Status | Summary |
|------|--------|---------|
| [component-catalogue.md](component-catalogue.md) | Core shipped; web/Nunjucks pending | The master plan: scan native + web prototypes, detect components/usages/variants, capture previews, and output a cross-platform catalogue. SwiftUI and Compose are built; the Nunjucks/web path is not. |
| [component-previews-and-gallery.md](component-previews-and-gallery.md) | Part 1 shipped; Part 2 pending | **Part 1** (component-only previews via `ImageRenderer` / `GraphicsLayer`) is built. **Part 2** — a dense gallery grid with a list/gallery toggle and platform grouping — is not yet built. |

## Done (archived)

| Plan | Shipped | Summary |
|------|---------|---------|
| [style-tokens-tab.md](archive/style-tokens-tab.md) | ✅ | Capture and display design tokens — colours, type sizes, spacing — as a Style tokens tab, plus JSON/Markdown. |
| [missing-and-blank-previews.md](archive/missing-and-blank-previews.md) | ✅ | Why some components produced no image (or a blank one), and the fixes: blank-render detection + fallback (F1), `@Previewable @State` support (F3), and surfacing preview gaps in the report (F5). Both platforms. |
| [preview-component-attribution.md](archive/preview-component-attribution.md) | ✅ | Attribute previews to components from the **preview body** (the components it actually renders), and treat multi-component previews as first-class **showcases**. Both platforms. |

## Authoring a plan

Plans are markdown design docs: the problem, the approach, the trade-offs, and a
recommended sequence. When a plan ships, move it to `archive/` and update the
tables above. Prototype-side follow-ups noted in a plan (e.g. "add a `#Preview`")
stay the prototype owner's responsibility and don't block archiving.
