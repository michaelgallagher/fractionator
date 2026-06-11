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

  for (const [platform, data] of Object.entries(platforms)) {
    for (const comp of data.components) {
      allComponents.push({ ...comp, platform });
    }
  }

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
<body>
<div class="container">
  <header>
    <h1>Component catalogue</h1>
    ${repoTags ? `<div class="repo-list">${repoTags}</div>` : ""}
    <p class="generated-at">Generated ${esc(generatedAt)}</p>
  </header>

  ${
    hasAlignment
      ? `<div class="tab-bar" role="tablist">
    <button class="tab-btn active" role="tab" aria-selected="true" aria-controls="tab-components" data-tab="components">Components</button>
    <button class="tab-btn" role="tab" aria-selected="false" aria-controls="tab-alignment" data-tab="alignment">Cross-platform alignment</button>
  </div>`
      : ""
  }

  <div class="tab-panel${hasAlignment ? "" : " tab-panel-solo"}" id="tab-components">
    <section class="summary">
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
    </section>

    <section class="components" id="components">
      ${allComponents.map((c) => renderComponentCard(c)).join("\n      ")}
    </section>
  </div>

  ${
    hasAlignment
      ? `<div class="tab-panel hidden" id="tab-alignment">
    ${alignmentSection}
  </div>`
      : ""
  }
</div>

<script>
${JS}
</script>
</body>
</html>`;
}

const PLATFORM_LABELS = { ios: "iOS", android: "Android", web: "Web" };

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

function renderComponentCard(comp) {
  const screenList = [...new Set(comp.usages.map((u) => u.enclosingView))];
  const variantCount = comp.variants.length;
  const screenshots = comp.screenshots || [];

  return `<article class="component-card" data-name="${esc(comp.name)}" data-usages="${comp.usageCount}" data-variants="${variantCount}" data-platform="${comp.platform}">
      <div class="card-header">
        <h3 class="card-title">${esc(comp.name)}</h3>
        <div class="card-meta">
          <span class="badge badge-platform">${comp.platform}</span>
          <span class="badge">${comp.usageCount} usage${comp.usageCount !== 1 ? "s" : ""}</span>
          ${variantCount > 1 ? `<span class="badge badge-variants">${variantCount} variants</span>` : ""}
        </div>
      </div>
      <div class="card-body">
        ${
          screenshots.length > 0
            ? `<div class="card-section">
          <h4>Preview${screenshots.length > 1 ? "s" : ""}</h4>
          ${renderScreenshots(screenshots)}
        </div>`
            : ""
        }
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
  const rows = variants
    .map(
      (v) => `<tr>
        <td class="variant-label">${esc(v.label)}</td>
        <td class="variant-count">${v.count}</td>
        <td class="variant-screens">${[...new Set(v.usages.map((u) => u.enclosingView))].map((s) => `<span class="screen-tag">${esc(s)}</span>`).join(" ")}</td>
      </tr>`,
    )
    .join("\n        ");

  return `<div class="card-section">
          <h4>Variants</h4>
          <table class="variants-table">
            <thead><tr><th>Style</th><th>Count</th><th>Screens</th></tr></thead>
            <tbody>
        ${rows}
            </tbody>
          </table>
        </div>`;
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

.controls { display: flex; gap: 0.75rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
#search {
  flex: 1; min-width: 200px; padding: 0.5rem 0.75rem; border: 1px solid var(--border);
  border-radius: 6px; font-size: 0.9rem; background: var(--surface); color: var(--text);
}
#search:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
select {
  padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 6px;
  font-size: 0.9rem; background: var(--surface); color: var(--text);
}

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
@media (prefers-color-scheme: dark) {
  .badge-variants { background: #422006; color: #fbbf24; }
}

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

.variants-table { width: 100%; font-size: 0.85rem; border-collapse: collapse; }
.variants-table th { text-align: left; font-weight: 600; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
.variants-table td { padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
.variant-label { font-family: var(--mono); font-size: 0.8rem; white-space: nowrap; }
.variant-count { font-weight: 600; text-align: center; min-width: 3rem; }

.component-card.hidden { display: none; }

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

  return lines.join("\n");
}

module.exports = { buildReport };
