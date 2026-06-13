const fs = require("fs");
const path = require("path");

/**
 * Build output reports from the catalogue data.
 *
 * @param {object} catalogue - The full catalogue data
 * @param {string} outputDir - Where to write output files
 * @param {string[]} formats - Which formats to produce (html, json, md)
 */
function buildReport(catalogue, outputDir, formats) {
  fs.mkdirSync(outputDir, { recursive: true });

  if (formats.includes("json")) {
    const jsonPath = path.join(outputDir, "catalogue.json");
    fs.writeFileSync(jsonPath, JSON.stringify(catalogue, null, 2));
    console.log(`   JSON: ${jsonPath}`);
  }

  if (formats.includes("html")) {
    const htmlPath = path.join(outputDir, "index.html");
    fs.writeFileSync(htmlPath, renderHtml(catalogue));
    console.log(`   HTML: ${htmlPath}`);
  }

  if (formats.includes("md")) {
    const mdPath = path.join(outputDir, "catalogue.md");
    fs.writeFileSync(mdPath, renderMarkdown(catalogue));
    console.log(`   Markdown: ${mdPath}`);
  }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function renderHtml(catalogue) {
  const { platforms } = catalogue;
  const allComponents = [];

  const allShowcases = [];

  for (const [platform, data] of Object.entries(platforms)) {
    for (const comp of data.components) {
      allComponents.push({ ...comp, platform });
    }
    for (const showcase of data.showcases || []) {
      allShowcases.push({ ...showcase, platform });
    }
  }

  // Lookup so a component card can render the showcases it appears in. Keyed by
  // platform + id so ids can't collide across platforms.
  const showcaseById = new Map(
    allShowcases.map((s) => [`${s.platform}:${s.id}`, s]),
  );

  // Sort by usage count descending
  allComponents.sort((a, b) => b.usageCount - a.usageCount);

  const totalComponents = allComponents.length;
  const totalUsages = allComponents.reduce((s, c) => s + c.usageCount, 0);
  const unused = allComponents.filter((c) => c.usageCount === 0);
  const singleUse = allComponents.filter((c) => c.usageCount === 1);

  // Canonical platform column order, limited to platforms actually present.
  const platformOrder = ["ios", "android", "web"].filter((p) => platforms[p]);
  const alignmentSection =
    catalogue.alignment && platformOrder.length >= 2
      ? renderAlignment(catalogue.alignment, platformOrder)
      : "";

  const hasAlignment = alignmentSection !== "";

  const tokensSection =
    catalogue.tokens && hasAnyTokens(catalogue.tokens)
      ? renderTokens(catalogue.tokens, platformOrder)
      : "";

  const generatedAt = new Date().toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });

  const repoTags = platformOrder
    .map((p) => {
      const projectPath = platforms[p] && platforms[p].projectPath;
      const repoName = projectPath ? path.basename(projectPath) : p;
      return `<span class="repo-tag"><span class="repo-platform">${PLATFORM_LABELS[p] || p}</span><span class="repo-name">${esc(repoName)}</span></span>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Component Catalogue — Fractionator</title>
<style>
${CSS}
</style>
</head>
<body class="view-gallery">
<div class="container">
  <header>
    <h1>Component catalogue</h1>
    ${repoTags ? `<div class="repo-list">${repoTags}</div>` : ""}
    <p class="generated-at">Generated ${esc(generatedAt)}</p>
  </header>

  ${renderTabs([
    {
      id: "components",
      label: "Components",
      content: `<section class="summary">
      <h2>Summary</h2>
      <div class="stats-grid">
        <div class="stat">
          <span class="stat-value">${totalComponents}</span>
          <span class="stat-label">components</span>
        </div>
        <div class="stat">
          <span class="stat-value">${totalUsages}</span>
          <span class="stat-label">total usages</span>
        </div>
        <div class="stat">
          <span class="stat-value">${unused.length}</span>
          <span class="stat-label">unused</span>
        </div>
        <div class="stat">
          <span class="stat-value">${singleUse.length}</span>
          <span class="stat-label">single-use</span>
        </div>
      </div>
    </section>

    <section class="controls">
      <input type="text" id="search" placeholder="Filter components..." autocomplete="off">
      <label>
        <select id="sort">
          <option value="usages-desc">Most used</option>
          <option value="usages-asc">Least used</option>
          <option value="name-asc">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
          <option value="variants-desc">Most variants</option>
        </select>
      </label>
      <div class="view-toggle" role="group" aria-label="View mode">
        <button type="button" class="view-btn" data-view="gallery" aria-pressed="true">Gallery</button>
        <button type="button" class="view-btn" data-view="list" aria-pressed="false">List</button>
      </div>
    </section>

    <section class="components" id="components">
      ${allComponents.map((c) => renderComponentCard(c, showcaseById)).join("\n      ")}
    </section>`,
    },
    ...(allShowcases.length
      ? [
          {
            id: "showcases",
            label: `Showcases (${allShowcases.length})`,
            content: renderShowcases(allShowcases),
          },
        ]
      : []),
    ...(tokensSection
      ? [{ id: "tokens", label: "Style tokens", content: tokensSection }]
      : []),
    ...(hasAlignment
      ? [
          {
            id: "alignment",
            label: "Cross-platform alignment",
            content: alignmentSection,
          },
        ]
      : []),
  ])}
</div>

<div id="detail-modal" class="detail-modal hidden" role="dialog" aria-modal="true" aria-label="Component detail">
  <div class="detail-modal-backdrop"></div>
  <div class="detail-modal-body">
    <button type="button" class="detail-modal-close" aria-label="Close">&times;</button>
    <div class="detail-modal-content"></div>
  </div>
</div>

<script>
${JS}
</script>
</body>
</html>`;
}

const PLATFORM_LABELS = { ios: "iOS", android: "Android", web: "Web" };

/**
 * Render a set of tabs. A single tab renders without a tab bar (solo panel);
 * multiple tabs render a tab bar plus one panel each, the first one active.
 */
function renderTabs(tabs) {
  if (tabs.length === 1) {
    return `<div class="tab-panel tab-panel-solo" id="tab-${tabs[0].id}">
    ${tabs[0].content}
  </div>`;
  }

  const bar = tabs
    .map(
      (t, i) =>
        `<button class="tab-btn${i === 0 ? " active" : ""}" role="tab" aria-selected="${i === 0}" aria-controls="tab-${t.id}" data-tab="${t.id}">${t.label}</button>`,
    )
    .join("\n    ");

  const panels = tabs
    .map(
      (t, i) =>
        `<div class="tab-panel${i === 0 ? "" : " hidden"}" id="tab-${t.id}">
    ${t.content}
  </div>`,
    )
    .join("\n  ");

  return `<div class="tab-bar" role="tablist">
    ${bar}
  </div>

  ${panels}`;
}

/** True if any platform has at least one token in any category. */
function hasAnyTokens(tokens) {
  return Object.values(tokens).some(
    (t) =>
      t &&
      (t.colors.length > 0 ||
        t.typography.length > 0 ||
        t.spacing.length > 0),
  );
}

/**
 * Render the Style tokens tab: one block per platform, each split into colors,
 * type scale, and spacing scale.
 */
function renderTokens(tokens, platformOrder) {
  const blocks = platformOrder
    .filter((p) => tokens[p])
    .map((p) => {
      const t = tokens[p];
      return `<section class="token-platform">
      <h2 class="token-platform-title">${PLATFORM_LABELS[p] || esc(p)}</h2>
      ${renderColorTokens(t.colors)}
      ${renderTypeTokens(t.typography)}
      ${renderSpacingTokens(t.spacing)}
    </section>`;
    })
    .join("\n    ");

  return `<div class="tokens">
    ${blocks}
  </div>`;
}

function renderColorTokens(colors) {
  if (!colors.length) return "";
  const chips = colors
    .map((c) => {
      const v = c.value || {};
      const light = v.light || null;
      const dark = v.dark || null;
      const swatch = light
        ? dark && dark !== light
          ? `<span class="swatch" style="background:linear-gradient(135deg, ${light} 0 50%, ${dark} 50% 100%)" title="light ${light} · dark ${dark}"></span>`
          : `<span class="swatch" style="background:${light}" title="${light}"></span>`
        : `<span class="swatch swatch-none" title="unresolved">?</span>`;
      const hexLabel = light
        ? dark && dark !== light
          ? `${light} / ${dark}`
          : light
        : "—";
      const aliasNote =
        c.aliases && c.aliases.length
          ? ` <span class="token-alias" title="${esc(c.aliases.join(", "))}">+${c.aliases.length}</span>`
          : "";
      return `<div class="color-chip" title="${esc(locationSummary(c.locations))}">
        ${swatch}
        <div class="color-meta">
          <span class="color-name">${esc(c.display)}${aliasNote}</span>
          <span class="color-hex">${esc(hexLabel)}</span>
        </div>
        <span class="token-count">${c.count}</span>
      </div>`;
    })
    .join("\n      ");

  return `<div class="token-group">
      <h3 class="token-group-title">Colors <span class="token-group-count">${colors.length}</span></h3>
      <div class="color-grid">
      ${chips}
      </div>
    </div>`;
}

function renderTypeTokens(typography) {
  if (!typography.length) return "";
  const rows = typography
    .map((t) => {
      // Clamp the preview to a sensible range so a 64pt token doesn't dominate.
      const previewPx = t.size
        ? Math.max(11, Math.min(34, t.size))
        : 15;
      const sizeLabel = t.size != null ? `${t.size}` : "—";
      return `<div class="type-row" title="${esc(locationSummary(t.locations))}">
        <span class="type-size">${sizeLabel}</span>
        <span class="type-preview" style="font-size:${previewPx}px;font-weight:${t.weight === "bold" || t.weight === "semibold" ? 600 : 400}">${esc(t.display)}</span>
        <span class="type-kind">${t.kind}</span>
        <span class="token-count">${t.count}</span>
      </div>`;
    })
    .join("\n      ");

  return `<div class="token-group">
      <h3 class="token-group-title">Type scale <span class="token-group-count">${typography.length}</span></h3>
      <div class="type-list">
      ${rows}
      </div>
    </div>`;
}

function renderSpacingTokens(spacing) {
  if (!spacing.length) return "";
  const maxValue = spacing.reduce((m, s) => Math.max(m, s.value), 0) || 1;
  const rows = spacing
    .map((s) => {
      const widthPct = Math.max(2, (s.value / maxValue) * 100);
      return `<div class="space-row" title="${esc(s.contexts.join(", "))} · ${esc(locationSummary(s.locations))}">
        <span class="space-value">${s.value}<span class="space-unit">${esc(s.unit)}</span></span>
        <span class="space-bar-track"><span class="space-bar" style="width:${widthPct}%"></span></span>
        <span class="token-count">${s.count}</span>
      </div>`;
    })
    .join("\n      ");

  return `<div class="token-group">
      <h3 class="token-group-title">Spacing scale <span class="token-group-count">${spacing.length}</span></h3>
      <div class="space-list">
      ${rows}
      </div>
    </div>`;
}

/** Short human summary of where a token appears, for hover tooltips. */
function locationSummary(locations) {
  if (!locations || !locations.length) return "";
  const files = [...new Set(locations.map((l) => l.relativePath))];
  const shown = files.slice(0, 3).join(", ");
  const more = files.length > 3 ? ` +${files.length - 3} more` : "";
  return `${files.length} file${files.length !== 1 ? "s" : ""}: ${shown}${more}`;
}

function renderAlignment(alignment, platformOrder) {
  const matched = alignment.filter((a) => a.status === "matched");
  const platformOnly = alignment.filter((a) => a.status === "platform-only");

  const headCells = platformOrder
    .map((p) => `<th>${PLATFORM_LABELS[p] || esc(p)}</th>`)
    .join("");

  const rows = alignment
    .map((entry) => {
      const cells = platformOrder
        .map((p) => {
          const name = entry.platforms[p];
          return name
            ? `<td class="align-name">${esc(name)}</td>`
            : `<td class="align-absent">—</td>`;
        })
        .join("");

      const statusBadge =
        entry.status === "platform-only"
          ? `<span class="badge badge-platform-only">platform-only</span>`
          : entry.drift
            ? `<span class="badge badge-drift">name drift</span>`
            : `<span class="badge badge-aligned">aligned</span>`;

      return `<tr class="${entry.drift ? "row-drift" : ""}">
        <td class="align-concept">${esc(entry.concept)}</td>
        ${cells}
        <td>${statusBadge}</td>
      </tr>`;
    })
    .join("\n        ");

  return `<section class="alignment">
    <h2>Cross-platform alignment</h2>
    <p class="alignment-summary">${matched.length} shared concept${matched.length !== 1 ? "s" : ""} · ${platformOnly.length} platform-only</p>
    <table class="alignment-table">
      <thead><tr><th>Concept</th>${headCells}<th>Status</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </section>`;
}

/**
 * Render the preview screenshots for a card.
 *
 * Without variations (every shot is the baseline mode) this renders a single
 * flat strip, captioned by preview name when there's more than one — identical
 * to the original layout. With variations, screenshots are grouped by preview
 * and each group shows one figure per display mode, captioned by mode label.
 */
function renderScreenshots(screenshots) {
  const hasVariations = screenshots.some(
    (s) => s.mode && s.mode !== "baseline",
  );

  if (!hasVariations) {
    const figures = screenshots
      .map(
        (s) => `<figure class="screenshot-figure">
              <img src="${esc(s.path)}" alt="Preview: ${esc(s.previewName)}" class="screenshot-img" loading="lazy">
              ${screenshots.length > 1 ? `<figcaption>${esc(s.previewName)}</figcaption>` : ""}
            </figure>`,
      )
      .join("\n            ");
    return `<div class="screenshot-strip">${figures}</div>`;
  }

  // Group by preview id, preserving first-seen order. Modes within a group are
  // in capture order (baseline first).
  const groups = new Map();
  for (const s of screenshots) {
    const key = s.id || s.previewName;
    if (!groups.has(key)) {
      groups.set(key, { previewName: s.previewName, shots: [] });
    }
    groups.get(key).shots.push(s);
  }

  return [...groups.values()]
    .map((group) => {
      const figures = group.shots
        .map(
          (s) => `<figure class="screenshot-figure">
              <img src="${esc(s.path)}" alt="Preview: ${esc(s.previewName)} (${esc(s.modeLabel || s.mode)})" class="screenshot-img" loading="lazy">
              <figcaption>${esc(s.modeLabel || s.mode)}</figcaption>
            </figure>`,
        )
        .join("\n            ");
      return `<div class="preview-group">
          <h5>${esc(group.previewName)}</h5>
          <div class="screenshot-strip">${figures}</div>
        </div>`;
    })
    .join("\n        ");
}

/**
 * Classify a component's preview coverage so the report can explain a missing
 * image instead of silently omitting it:
 *  - captured: at least one screenshot (optionally flagged all-fallback)
 *  - none:     no #Preview exists in the source
 *  - skipped:  a #Preview exists but couldn't be captured (with the reason)
 */
function previewStatus(comp) {
  const screenshots = comp.screenshots || [];
  if (screenshots.length > 0) {
    const allFallback = screenshots.every((s) => s.cropped === false);
    return { kind: "captured", allFallback };
  }

  // No solo capture, but the component is rendered by one or more showcase
  // previews — its image lives there, so this is not a failure.
  if ((comp.appearsIn || []).length > 0) {
    return { kind: "showcased" };
  }

  const previewCount = (comp.previews || []).length;
  if (previewCount === 0) {
    return { kind: "none", label: "No #Preview in the source file." };
  }

  const reasons = [
    ...new Set(
      (comp.previewDiagnostics || []).filter((d) => d.skip).map((d) => d.skip),
    ),
  ];
  return {
    kind: "skipped",
    label: reasons.length
      ? `#Preview exists but wasn't captured: ${reasons.join("; ")}.`
      : "#Preview exists but couldn't be captured.",
  };
}

function renderComponentCard(comp, showcaseById = new Map()) {
  const screenList = [...new Set(comp.usages.map((u) => u.enclosingView))];
  const variantCount = comp.variants.length;
  const screenshots = comp.screenshots || [];
  const status = previewStatus(comp);
  const showcases = (comp.appearsIn || [])
    .map((id) => showcaseById.get(`${comp.platform}:${id}`))
    .filter(Boolean);

  const statusBadge =
    status.kind === "none"
      ? `<span class="badge badge-no-preview">no preview</span>`
      : status.kind === "skipped"
        ? `<span class="badge badge-no-preview">preview skipped</span>`
        : status.kind === "showcased"
          ? `<span class="badge badge-showcase">in showcase</span>`
          : status.allFallback
            ? `<span class="badge badge-fallback">full-screen</span>`
            : "";

  let previewSection;
  if (screenshots.length > 0) {
    previewSection = `<div class="card-section card-section-preview">
          <h4>Preview${screenshots.length > 1 ? "s" : ""}</h4>
          ${renderScreenshots(screenshots)}
          ${showcases.length ? renderShowcaseBacklink(showcases) : ""}
        </div>`;
  } else if (showcases.length > 0) {
    previewSection = `<div class="card-section card-section-preview">
          <h4>Preview${showcases.length > 1 ? "s" : ""}</h4>
          ${showcases.map((s) => renderShowcaseOnCard(s, comp.name)).join("\n          ")}
        </div>`;
  } else {
    previewSection = `<div class="card-section card-section-preview">
          <h4>Preview</h4>
          <p class="preview-missing preview-missing-${status.kind}">${esc(status.label)}</p>
        </div>`;
  }

  return `<article class="component-card" data-name="${esc(comp.name)}" data-usages="${comp.usageCount}" data-variants="${variantCount}" data-platform="${comp.platform}" data-preview-status="${status.kind}">
      <div class="card-header">
        <h3 class="card-title">${esc(comp.name)}</h3>
        <div class="card-meta">
          <span class="badge badge-platform">${comp.platform}</span>
          <span class="badge">${comp.usageCount} usage${comp.usageCount !== 1 ? "s" : ""}</span>
          ${variantCount > 1 ? `<span class="badge badge-variants">${variantCount} variants</span>` : ""}
          ${statusBadge}
        </div>
      </div>
      <div class="card-body">
        ${previewSection}
        <div class="card-section">
          <h4>File</h4>
          <code>${esc(comp.relativePath)}</code>
        </div>
        ${
          comp.signature.length > 0
            ? `<div class="card-section">
          <h4>Signature</h4>
          <div class="signature">${comp.signature.map((p) => renderParam(p)).join("")}</div>
        </div>`
            : ""
        }
        ${
          screenList.length > 0
            ? `<div class="card-section">
          <h4>Used in</h4>
          <div class="screen-list">${screenList.map((s) => `<span class="screen-tag">${esc(s)}</span>`).join(" ")}</div>
        </div>`
            : `<div class="card-section"><p class="unused-note">Not used outside its definition file</p></div>`
        }
        ${variantCount > 1 ? renderVariants(comp.variants) : ""}
      </div>
    </article>`;
}

/**
 * Render a showcase preview inline on a component card: the captured image plus
 * the other components it shows alongside this one.
 */
function renderShowcaseOnCard(showcase, selfName) {
  const others = (showcase.renders || []).filter((r) => r !== selfName);
  const withChips = others.length
    ? `<div class="screen-list showcase-with">${others
        .map((r) => `<span class="screen-tag">${esc(r)}</span>`)
        .join(" ")}</div>`
    : "";
  return `<div class="showcase-on-card">
            <p class="showcase-note">Shown in showcase <strong>${esc(showcase.name)}</strong>${others.length ? ` — with` : ""}</p>
            ${withChips}
            ${renderScreenshots(showcase.screenshots)}
          </div>`;
}

/** A one-line backlink for a component that has its own preview but also appears in showcases. */
function renderShowcaseBacklink(showcases) {
  return `<p class="showcase-note">Also shown in: ${showcases
    .map((s) => `<span class="showcase-link">${esc(s.name)}</span>`)
    .join(", ")}</p>`;
}

/**
 * The Showcases tab: one card per multi-component preview, with its image and a
 * chip for every component it renders.
 */
function renderShowcases(showcases) {
  const cards = showcases
    .map(
      (s) => `<article class="component-card showcase-card" data-name="${esc(s.name)}" data-platform="${esc(s.platform)}" id="showcase-${esc(s.id)}">
      <div class="card-header">
        <h3 class="card-title">${esc(s.name)}</h3>
        <div class="card-meta">
          <span class="badge badge-platform">${esc(s.platform)}</span>
          <span class="badge badge-showcase">${(s.renders || []).length} components</span>
        </div>
      </div>
      <div class="card-body">
        <div class="card-section">
          ${renderScreenshots(s.screenshots)}
        </div>
        <div class="card-section">
          <h4>Components shown</h4>
          <div class="screen-list">${(s.renders || [])
            .map((r) => `<span class="screen-tag">${esc(r)}</span>`)
            .join(" ")}</div>
        </div>
        <div class="card-section">
          <h4>Source</h4>
          <code>${esc(s.sourceFile)}</code>
        </div>
      </div>
    </article>`,
    )
    .join("\n      ");
  return `<section class="components" id="showcases">${cards}</section>`;
}

function renderParam(p) {
  const binding = p.isBinding
    ? '<span class="annotation">@Binding</span> '
    : "";
  const observed = p.isObserved
    ? '<span class="annotation">@ObservedObject</span> '
    : "";
  const annotation =
    p.annotation && !p.isBinding && !p.isObserved
      ? `<span class="annotation">${esc(p.annotation)}</span> `
      : "";
  const defaultVal = p.defaultValue
    ? ` <span class="default">= ${esc(p.defaultValue)}</span>`
    : "";

  return `<div class="param">${annotation}${binding}${observed}<span class="param-name">${esc(p.name)}</span>: <span class="param-type">${esc(p.type)}</span>${defaultVal}</div>`;
}

function renderVariants(variants) {
  const blocks = variants
    .map((v) => {
      const screens = [...new Set(v.usages.map((u) => u.enclosingView))];
      const screenTags = screens.map((s) => `<span class="screen-tag">${esc(s)}</span>`).join(" ");
      return `<div class="variant-block">
          <div class="variant-header">
            <span class="variant-label">${esc(v.label)}</span>
            <span class="variant-count">×${v.count}</span>
          </div>
          ${screens.length > 0 ? `<div class="screen-list">${screenTags}</div>` : ""}
        </div>`;
    })
    .join("\n        ");

  return `<details class="card-section variants-expander">
          <summary class="variants-summary">Variants <span class="variants-badge">${variants.length}</span></summary>
          <div class="variant-list">
        ${blocks}
          </div>
        </details>`;
}

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const CSS = `
:root {
  --bg: #f8f9fa;
  --surface: #ffffff;
  --text: #1a1a1a;
  --text-secondary: #6b7280;
  --border: #e5e7eb;
  --accent: #2563eb;
  --accent-light: #eff6ff;
  --badge-bg: #f3f4f6;
  --badge-text: #374151;
  --variant-bg: #fafafa;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --mono: "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111111;
    --surface: #1a1a1a;
    --text: #e5e5e5;
    --text-secondary: #9ca3af;
    --border: #2d2d2d;
    --accent: #60a5fa;
    --accent-light: #1e293b;
    --badge-bg: #262626;
    --badge-text: #d1d5db;
    --variant-bg: #141414;
  }
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.5; }
.container { max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem; }

header { margin-bottom: 2rem; }
h1 { font-size: 1.75rem; font-weight: 700; }
.subtitle { color: var(--text-secondary); margin-top: 0.25rem; }
.repo-list { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.6rem; }
.repo-tag { display: inline-flex; align-items: center; gap: 0; font-size: 0.8rem; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.repo-platform { padding: 0.2rem 0.5rem; background: var(--accent-light); color: var(--accent); font-weight: 600; }
.repo-name { padding: 0.2rem 0.6rem; background: var(--surface); color: var(--text-secondary); font-family: var(--mono); }
.generated-at { font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.35rem; }

.summary { margin-bottom: 2rem; }
.summary h2 { font-size: 1rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 0.75rem; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; }
.stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; text-align: center; }
.stat-value { display: block; font-size: 1.5rem; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 0.8rem; color: var(--text-secondary); }

.controls {
  display: flex; gap: 0.75rem; margin-bottom: 1.5rem; flex-wrap: wrap;
  position: sticky; top: 0; z-index: 50;
  padding: 0.75rem 0; background: var(--bg);
  border-bottom: 1px solid var(--border);
}
#search {
  flex: 1; min-width: 200px; padding: 0.5rem 0.75rem; border: 1px solid var(--border);
  border-radius: 6px; font-size: 0.9rem; background: var(--surface); color: var(--text);
}
#search:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
select {
  padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 6px;
  font-size: 0.9rem; background: var(--surface); color: var(--text);
}

.view-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.view-btn {
  background: var(--surface); border: none; cursor: pointer; font-family: var(--font);
  font-size: 0.85rem; color: var(--text-secondary); padding: 0.5rem 0.85rem;
}
.view-btn + .view-btn { border-left: 1px solid var(--border); }
.view-btn:hover { color: var(--text); }
.view-btn[aria-pressed="true"] { background: var(--accent-light); color: var(--accent); font-weight: 600; }

.component-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  margin-bottom: 1rem; overflow: hidden;
}
.card-header {
  display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;
  padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); gap: 0.5rem;
}
.card-title { font-size: 1rem; font-weight: 600; }
.card-meta { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.badge {
  font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 999px;
  background: var(--badge-bg); color: var(--badge-text);
}
.badge-platform { background: var(--accent-light); color: var(--accent); font-weight: 600; }
.badge-variants { background: #fef3c7; color: #92400e; }
.badge-no-preview { background: #fee2e2; color: #991b1b; }
.badge-fallback { background: #e0e7ff; color: #3730a3; }
.badge-showcase { background: #dcfce7; color: #166534; }
@media (prefers-color-scheme: dark) {
  .badge-variants { background: #422006; color: #fbbf24; }
  .badge-no-preview { background: #450a0a; color: #fca5a5; }
  .badge-fallback { background: #1e1b4b; color: #a5b4fc; }
  .badge-showcase { background: #052e16; color: #4ade80; }
}

.preview-missing { font-size: 0.85rem; color: var(--text-secondary); font-style: italic; margin: 0; }
.showcase-note { font-size: 0.8rem; color: var(--text-secondary); margin: 0 0 0.4rem; }
.showcase-note strong { color: var(--text); }
.showcase-on-card { margin-bottom: 0.75rem; }
.showcase-on-card:last-child { margin-bottom: 0; }
.showcase-with { margin-bottom: 0.4rem; }
.showcase-link { font-size: 0.75rem; padding: 0.1rem 0.4rem; border-radius: 4px; background: #dcfce7; color: #166534; }
@media (prefers-color-scheme: dark) { .showcase-link { background: #052e16; color: #4ade80; } }

.card-body { padding: 0.75rem 1rem; }
.card-section { margin-bottom: 0.75rem; }
.card-section:last-child { margin-bottom: 0; }
.card-section h4 { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 0.35rem; }
.card-section code { font-family: var(--mono); font-size: 0.8rem; color: var(--text-secondary); }

.signature { font-family: var(--mono); font-size: 0.8rem; }
.param { padding: 0.15rem 0; }
.param-name { color: var(--accent); }
.param-type { color: var(--text-secondary); }
.annotation { color: #9333ea; }
@media (prefers-color-scheme: dark) { .annotation { color: #c084fc; } }
.default { color: var(--text-secondary); font-style: italic; }

.screen-list { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.screen-tag { font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 4px; background: var(--badge-bg); color: var(--badge-text); }

.unused-note { color: var(--text-secondary); font-style: italic; font-size: 0.85rem; }

.preview-group { margin-bottom: 1rem; }
.preview-group:last-child { margin-bottom: 0; }
.preview-group h5 { font-size: 0.8rem; margin: 0 0 0.4rem; color: var(--text-secondary); font-weight: 600; }
.screenshot-strip { display: flex; gap: 0.75rem; overflow-x: auto; padding-bottom: 0.5rem; }
.screenshot-figure { flex: 0 0 auto; text-align: center; }
.screenshot-figure figcaption { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem; }
.screenshot-img {
  max-height: 320px; width: auto; border-radius: 6px; border: 1px solid var(--border);
  cursor: pointer; transition: transform 0.15s ease;
}
.screenshot-img:hover { transform: scale(1.02); }
.screenshot-img.expanded {
  max-height: none; max-width: 100%; position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%); z-index: 1000; border-radius: 8px;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
}
.screenshot-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 999; cursor: pointer;
}

.variants-expander { border: none; }
.variants-expander > .variant-list { margin-top: 0.5rem; }
.variants-summary {
  cursor: pointer; list-style: none; display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-secondary); user-select: none;
}
.variants-summary::-webkit-details-marker { display: none; }
.variants-summary::before {
  content: '▶'; font-size: 0.55rem; transition: transform 0.15s; color: var(--text-secondary);
}
.variants-expander[open] > .variants-summary::before { transform: rotate(90deg); }
.variants-badge {
  font-size: 0.7rem; padding: 0.05rem 0.4rem; border-radius: 999px;
  background: var(--badge-bg); color: var(--badge-text); font-weight: 600; letter-spacing: 0;
}
.variant-list { display: flex; flex-direction: column; gap: 0.5rem; }
.variant-block { padding: 0.4rem 0.6rem; background: var(--variant-bg); border: 1px solid var(--border); border-radius: 6px; }
.variant-header { display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem; margin-bottom: 0.25rem; }
.variant-header:last-child { margin-bottom: 0; }
.variant-label { font-family: var(--mono); font-size: 0.8rem; word-break: break-all; }
.variant-count { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }

.component-card.hidden { display: none; }

/* --- Gallery view --- */
/* Tile rules are scoped to #components so the detail modal (which clones a card
   outside #components) renders the full, un-collapsed card. */
body.view-gallery .container { max-width: 1400px; }
body.view-gallery #components {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
  align-items: start;
}
body.view-gallery #components .component-card { margin-bottom: 0; cursor: pointer; }
body.view-gallery #components .component-card:hover { border-color: var(--accent); }
/* Compact tile: keep header + preview, drop the detail sections. */
body.view-gallery #components .card-body > .card-section { display: none; }
body.view-gallery #components .card-body > .card-section-preview { display: block; margin-bottom: 0; }
body.view-gallery #components .card-section-preview h4 { display: none; }
/* Lean badges: platform + usage only. */
body.view-gallery #components .card-meta .badge-variants,
body.view-gallery #components .card-meta .badge-no-preview,
body.view-gallery #components .card-meta .badge-fallback,
body.view-gallery #components .card-meta .badge-showcase { display: none; }
/* One representative thumbnail per tile, so a component with many full-screen
   fallback captures doesn't stack into a giant cell and break the grid. */
body.view-gallery #components .card-section-preview .screenshot-figure:not(:first-child),
body.view-gallery #components .card-section-preview .preview-group:not(:first-of-type),
body.view-gallery #components .card-section-preview .showcase-on-card:not(:first-of-type) { display: none; }
/* Letterbox thumbnails so a 126px glyph and a full-screen fallback both fit. */
body.view-gallery #components .screenshot-strip { overflow: visible; }
body.view-gallery #components .screenshot-img { max-height: 150px; }
body.view-gallery #components .screenshot-figure figcaption,
body.view-gallery #components .preview-group h5,
body.view-gallery #components .showcase-note { display: none; }

/* --- Detail modal (drill-in from a gallery tile) --- */
body.modal-open { overflow: hidden; }
.detail-modal { position: fixed; inset: 0; z-index: 200; }
.detail-modal.hidden { display: none; }
.detail-modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.6); cursor: pointer; }
.detail-modal-body {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(680px, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow-y: auto;
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
}
.detail-modal-close {
  position: absolute; top: 0.5rem; right: 0.5rem; z-index: 1; cursor: pointer;
  width: 2rem; height: 2rem; border: none; border-radius: 6px; line-height: 1;
  font-size: 1.4rem; background: var(--surface); color: var(--text-secondary);
}
.detail-modal-close:hover { color: var(--text); }
.detail-modal-content .component-card { margin: 0; border: none; }

.tab-bar {
  display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 1.5rem;
}
.tab-btn {
  background: none; border: none; cursor: pointer; font-family: var(--font);
  font-size: 0.9rem; font-weight: 500; color: var(--text-secondary);
  padding: 0.6rem 1.1rem; border-bottom: 2px solid transparent; margin-bottom: -2px;
  transition: color 0.15s, border-color 0.15s;
}
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
.tab-panel { display: block; }
.tab-panel.hidden { display: none; }

.alignment { margin-bottom: 2rem; }
.alignment h2 { font-size: 1rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 0.35rem; }
.alignment-summary { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.75rem; }
.alignment-table { width: 100%; font-size: 0.85rem; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.alignment-table th { text-align: left; font-weight: 600; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
.alignment-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
.alignment-table tr:last-child td { border-bottom: none; }
.align-concept { font-weight: 600; }
.align-name { font-family: var(--mono); font-size: 0.8rem; }
.align-absent { color: var(--text-secondary); text-align: center; }
.alignment-table tr.row-drift { background: var(--variant-bg); }
.badge-drift { background: #fef3c7; color: #92400e; }
.badge-aligned { background: #dcfce7; color: #166534; }
.badge-platform-only { background: var(--badge-bg); color: var(--text-secondary); }
@media (prefers-color-scheme: dark) {
  .badge-drift { background: #422006; color: #fbbf24; }
  .badge-aligned { background: #052e16; color: #4ade80; }
}

/* --- Style tokens tab --- */
.tokens { display: flex; flex-direction: column; gap: 2rem; }
.token-platform-title {
  font-size: 1rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-secondary); margin-bottom: 1rem;
  padding-bottom: 0.4rem; border-bottom: 1px solid var(--border);
}
.token-group { margin-bottom: 1.5rem; }
.token-group:last-child { margin-bottom: 0; }
.token-group-title {
  font-size: 0.8rem; font-weight: 600; color: var(--text); margin-bottom: 0.6rem;
  display: flex; align-items: center; gap: 0.4rem;
}
.token-group-count {
  font-size: 0.7rem; font-weight: 600; color: var(--text-secondary);
  background: var(--badge-bg); border-radius: 999px; padding: 0.05rem 0.45rem;
}
.token-count { font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }

/* Colors */
.color-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem;
}
.color-chip {
  display: flex; align-items: center; gap: 0.6rem;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 0.5rem 0.6rem;
}
.swatch {
  width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0;
  border: 1px solid rgba(0,0,0,0.12); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
}
.swatch-none {
  display: flex; align-items: center; justify-content: center;
  background: var(--badge-bg); color: var(--text-secondary); font-size: 0.8rem; font-weight: 600;
}
.color-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.color-name { font-size: 0.78rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.color-hex { font-family: var(--mono); font-size: 0.68rem; color: var(--text-secondary); }
.token-alias {
  font-size: 0.62rem; font-weight: 600; color: var(--text-secondary);
  background: var(--badge-bg); border-radius: 999px; padding: 0 0.3rem; vertical-align: middle;
}

/* Type scale */
.type-list { display: flex; flex-direction: column; gap: 0.15rem; }
.type-row {
  display: grid; grid-template-columns: 2.5rem 1fr auto auto; align-items: baseline; gap: 0.75rem;
  padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border);
}
.type-row:last-child { border-bottom: none; }
.type-size { font-family: var(--mono); font-size: 0.78rem; color: var(--text-secondary); text-align: right; }
.type-preview { color: var(--text); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.type-kind { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); }

/* Spacing scale */
.space-list { display: flex; flex-direction: column; gap: 0.2rem; }
.space-row {
  display: grid; grid-template-columns: 3.5rem 1fr auto; align-items: center; gap: 0.75rem;
  padding: 0.25rem 0.6rem;
}
.space-value { font-family: var(--mono); font-size: 0.8rem; text-align: right; }
.space-unit { color: var(--text-secondary); font-size: 0.65rem; margin-left: 1px; }
.space-bar-track { background: var(--badge-bg); border-radius: 999px; height: 0.55rem; }
.space-bar { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
`;

// ---------------------------------------------------------------------------
// JS (embedded in HTML)
// ---------------------------------------------------------------------------

const JS = `
(function() {
  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  const container = document.getElementById('components');

  function getCards() {
    return Array.from(container.querySelectorAll('.component-card'));
  }

  function applyFilter() {
    const q = search.value.toLowerCase().trim();
    for (const card of getCards()) {
      const name = card.dataset.name.toLowerCase();
      const platform = card.dataset.platform;
      const match = !q || name.includes(q) || platform.includes(q);
      card.classList.toggle('hidden', !match);
    }
  }

  function applySort() {
    const cards = getCards();
    const key = sort.value;
    cards.sort((a, b) => {
      switch (key) {
        case 'usages-desc': return +b.dataset.usages - +a.dataset.usages;
        case 'usages-asc': return +a.dataset.usages - +b.dataset.usages;
        case 'name-asc': return a.dataset.name.localeCompare(b.dataset.name);
        case 'name-desc': return b.dataset.name.localeCompare(a.dataset.name);
        case 'variants-desc': return +b.dataset.variants - +a.dataset.variants;
        default: return 0;
      }
    });
    for (const card of cards) container.appendChild(card);
  }

  search.addEventListener('input', applyFilter);
  sort.addEventListener('change', applySort);

  // Gallery / List view toggle (persisted)
  const viewBtns = Array.from(document.querySelectorAll('.view-btn'));
  function applyView(view) {
    const v = view === 'list' ? 'list' : 'gallery';
    document.body.classList.toggle('view-gallery', v === 'gallery');
    document.body.classList.toggle('view-list', v === 'list');
    for (const btn of viewBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === v));
    }
    try { localStorage.setItem('fractionator-view', v); } catch (e) {}
  }
  for (const btn of viewBtns) {
    btn.addEventListener('click', function() { applyView(btn.dataset.view); });
  }
  let savedView = 'gallery';
  try { savedView = localStorage.getItem('fractionator-view') || 'gallery'; } catch (e) {}
  applyView(savedView);

  // Detail modal: clicking a gallery tile opens its full card.
  const modal = document.getElementById('detail-modal');
  const modalContent = modal.querySelector('.detail-modal-content');
  function openDetail(card) {
    modalContent.innerHTML = '';
    const clone = card.cloneNode(true);
    clone.classList.remove('hidden');
    modalContent.appendChild(clone);
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    modal.querySelector('.detail-modal-close').focus();
  }
  function closeDetail() {
    if (modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    modalContent.innerHTML = '';
  }
  container.addEventListener('click', function(e) {
    if (!document.body.classList.contains('view-gallery')) return;
    const card = e.target.closest('.component-card');
    if (card) openDetail(card);
  });
  modal.querySelector('.detail-modal-backdrop').addEventListener('click', closeDetail);
  modal.querySelector('.detail-modal-close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    const expanded = document.querySelector('.screenshot-img.expanded');
    if (expanded) {
      expanded.classList.remove('expanded');
      document.querySelector('.screenshot-overlay')?.remove();
      return;
    }
    closeDetail();
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab-btn').forEach(function(b) {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(function(p) {
        p.classList.add('hidden');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      var target = document.getElementById('tab-' + btn.dataset.tab);
      if (target) target.classList.remove('hidden');
    });
  });

  // Screenshot expand/collapse
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('screenshot-overlay')) {
      e.target.remove();
      document.querySelector('.screenshot-img.expanded')?.classList.remove('expanded');
      return;
    }
    if (e.target.classList.contains('screenshot-img')) {
      // In gallery mode a tile thumbnail opens the detail modal (handled by the
      // container click listener); don't also pop the lightbox.
      if (document.body.classList.contains('view-gallery') && e.target.closest('#components')) {
        return;
      }
      if (e.target.classList.contains('expanded')) {
        e.target.classList.remove('expanded');
        document.querySelector('.screenshot-overlay')?.remove();
      } else {
        const overlay = document.createElement('div');
        overlay.className = 'screenshot-overlay';
        document.body.appendChild(overlay);
        e.target.classList.add('expanded');
      }
    }
  });
})();
`;

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function renderMarkdown(catalogue) {
  const lines = ["# Component Catalogue\n"];

  for (const [platform, data] of Object.entries(catalogue.platforms)) {
    lines.push(`## ${platform.toUpperCase()}\n`);
    lines.push(`| Component | Usages | Variants | Used in |`);
    lines.push(`|-----------|--------|----------|---------|`);

    const sorted = [...data.components].sort(
      (a, b) => b.usageCount - a.usageCount,
    );

    for (const comp of sorted) {
      const screens = [
        ...new Set(comp.usages.map((u) => u.enclosingView)),
      ].join(", ");
      lines.push(
        `| ${comp.name} | ${comp.usageCount} | ${comp.variants.length} | ${screens || "—"} |`,
      );
    }
    lines.push("");
  }

  const platformOrder = ["ios", "android", "web"].filter(
    (p) => catalogue.platforms[p],
  );
  if (catalogue.alignment && platformOrder.length >= 2) {
    lines.push("## Cross-platform alignment\n");
    const headers = [
      "Concept",
      ...platformOrder.map((p) => PLATFORM_LABELS[p] || p),
      "Status",
    ];
    lines.push(`| ${headers.join(" | ")} |`);
    lines.push(`|${headers.map(() => "---").join("|")}|`);

    for (const entry of catalogue.alignment) {
      const cells = platformOrder.map((p) => entry.platforms[p] || "—");
      const status =
        entry.status === "platform-only"
          ? "platform-only"
          : entry.drift
            ? "name drift"
            : "aligned";
      lines.push(`| ${entry.concept} | ${cells.join(" | ")} | ${status} |`);
    }
    lines.push("");
  }

  if (catalogue.tokens && hasAnyTokens(catalogue.tokens)) {
    lines.push("## Style tokens\n");
    for (const p of platformOrder) {
      const t = catalogue.tokens[p];
      if (!t) continue;
      lines.push(`### ${PLATFORM_LABELS[p] || p}\n`);
      renderTokenMarkdown(lines, t);
    }
  }

  return lines.join("\n");
}

/** Append a platform's token tables (colors, type, spacing) to `lines`. */
function renderTokenMarkdown(lines, tokens) {
  if (tokens.colors.length) {
    lines.push("**Colors**\n");
    lines.push("| Color | Value | Kind | Count |");
    lines.push("|-------|-------|------|-------|");
    for (const c of tokens.colors) {
      const v = c.value
        ? c.value.dark && c.value.dark !== c.value.light
          ? `${c.value.light} / ${c.value.dark}`
          : c.value.light
        : "—";
      lines.push(`| \`${c.display}\` | ${v} | ${c.kind} | ${c.count} |`);
    }
    lines.push("");
  }

  if (tokens.typography.length) {
    lines.push("**Type scale**\n");
    lines.push("| Size | Token | Kind | Count |");
    lines.push("|------|-------|------|-------|");
    for (const t of tokens.typography) {
      lines.push(
        `| ${t.size != null ? t.size : "—"} | \`${t.display}\` | ${t.kind} | ${t.count} |`,
      );
    }
    lines.push("");
  }

  if (tokens.spacing.length) {
    lines.push("**Spacing scale**\n");
    lines.push("| Value | Contexts | Count |");
    lines.push("|-------|----------|-------|");
    for (const s of tokens.spacing) {
      lines.push(
        `| ${s.value}${s.unit} | ${s.contexts.join(", ")} | ${s.count} |`,
      );
    }
    lines.push("");
  }
}

module.exports = { buildReport };
