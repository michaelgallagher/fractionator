# Fractionator documentation

Start with the [project README](../README.md) for the overview and quick start.
These docs go deeper on each part of the tool.

## Using the tool

- **[Usage](usage.md)** — full CLI reference, examples, and display-trait
  variations.
- **[Output](output.md)** — the HTML report (component cards, Showcases tab,
  preview-status badges, Style tokens tab, alignment table) and the JSON / Markdown
  formats.
- **[Writing capturable previews](writing-capturable-previews.md)** — how to author
  `#Preview` / `@Preview` blocks so components render cleanly. The report's badges
  are a punch-list against this guide.

## How it works

- **[Component detection](component-detection.md)** — how components, usages, and
  variants are found (SwiftUI, Compose, Nunjucks).
- **[Screenshot capture](screenshot-capture.md)** — the preview-rendering
  pipelines (iOS `ImageRenderer`, Android `GraphicsLayer`), the blank-render
  fallback, skipped previews, and multi-component showcases.
- **[Style tokens](style-tokens.md)** — capturing colours, type sizes, and spacing.
- **[Cross-platform alignment](cross-platform-alignment.md)** — matching components
  across platforms and curating a mapping.
- **[Architecture](architecture.md)** — the pipeline and module map.

## Accessibility

- **[A11Y.md](a11y/A11Y.md)** — the WCAG 2.2 AA standard the generated report must
  meet, plus the [audit](a11y/REPORT.md) and logged [exceptions](a11y/EXCEPTIONS.md).

## Plans

- **[Plans](plans/README.md)** — what's planned and what's shipped. Completed plans
  live in [`plans/archive/`](plans/archive/) for the design rationale.
