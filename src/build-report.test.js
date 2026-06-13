const { test } = require("node:test");
const assert = require("node:assert");
const { detectSpacingScale, renderHtml } = require("./build-report");

const sp = (...values) => values.map((value) => ({ value, unit: "pt" }));

test("detectSpacingScale flags values off the 4pt grid", () => {
  const { base, outliers } = detectSpacingScale(sp(0, 2, 4, 6, 8, 12, 16, 20, 24, 32));
  assert.strictEqual(base, 4);
  assert.deepStrictEqual([...outliers].sort((a, b) => a - b), [2, 6]);
});

test("detectSpacingScale flags nothing for a clean 4pt scale", () => {
  const { base, outliers } = detectSpacingScale(sp(4, 8, 16, 24, 32));
  assert.strictEqual(base, 4);
  assert.strictEqual(outliers.size, 0);
});

test("detectSpacingScale ignores zero (not an outlier)", () => {
  const { outliers } = detectSpacingScale(sp(0, 4, 8, 16));
  assert.ok(!outliers.has(0));
});

test("detectSpacingScale gives up when no clear 4pt rhythm", () => {
  // A 5pt-based scale: only 20 is a multiple of 4, well under the 60% threshold.
  const { base, outliers } = detectSpacingScale(sp(5, 10, 15, 20, 25));
  assert.strictEqual(base, null);
  assert.strictEqual(outliers.size, 0);
});

test("detectSpacingScale needs at least three values to infer a rhythm", () => {
  const { base, outliers } = detectSpacingScale(sp(4, 7));
  assert.strictEqual(base, null);
  assert.strictEqual(outliers.size, 0);
});

test("detectSpacingScale de-duplicates repeated values", () => {
  const { base, outliers } = detectSpacingScale(sp(4, 4, 8, 8, 16, 6));
  assert.strictEqual(base, 4);
  assert.deepStrictEqual([...outliers], [6]);
});

// ---------------------------------------------------------------------------
// Accessibility: structural invariants the generated report must always hold.
// These guard the WCAG 2.2 AA baseline documented in docs/a11y/A11Y.md without
// needing a browser — they assert over the generated HTML string. See also the
// manual keyboard/zoom pass in docs/a11y/REPORT.md.
// ---------------------------------------------------------------------------

// A representative catalogue: one component (with a captured preview, variants,
// and a signature), a showcase, and style tokens. This exercises the tablist
// (Components / Showcases / Style tokens), cards, and screenshots.
function sampleCatalogue() {
  return {
    platforms: {
      ios: {
        projectPath: "/repos/my-ios-proto",
        components: [
          {
            name: "PrimaryButton",
            usageCount: 3,
            usages: [{ enclosingView: "Home" }, { enclosingView: "Settings" }],
            variants: [
              { label: "style: .filled", count: 2, usages: [{ enclosingView: "Home" }] },
              { label: "style: .tinted", count: 1, usages: [{ enclosingView: "Settings" }] },
            ],
            signature: [{ name: "title", type: "String" }],
            relativePath: "Sources/PrimaryButton.swift",
            screenshots: [
              { path: "shots/primarybutton.png", previewName: "PrimaryButton", mode: "baseline", cropped: true },
            ],
            previews: [{}],
            previewDiagnostics: [],
            appearsIn: [],
          },
        ],
        showcases: [
          {
            id: "sc1",
            name: "ButtonsShowcase",
            renders: ["PrimaryButton", "SecondaryButton"],
            screenshots: [
              { path: "shots/sc1.png", previewName: "ButtonsShowcase", mode: "baseline", cropped: true },
            ],
            sourceFile: "Sources/Showcase.swift",
          },
        ],
      },
    },
    tokens: {
      ios: {
        colors: [
          {
            display: "accent",
            value: { light: "#2563eb", dark: "#60a5fa" },
            count: 5,
            aliases: [],
            locations: [{ relativePath: "Tokens.swift", lineNumber: 10 }],
          },
        ],
        typography: [
          {
            size: 17,
            weight: "regular",
            display: "body",
            kind: "font",
            count: 8,
            locations: [{ relativePath: "Tokens.swift", lineNumber: 20 }],
          },
        ],
        spacing: [
          {
            value: 16,
            unit: "pt",
            count: 12,
            contexts: ["padding"],
            locations: [{ relativePath: "Tokens.swift", lineNumber: 30 }],
          },
        ],
      },
    },
  };
}

test("report declares a document language", () => {
  const html = renderHtml(sampleCatalogue());
  assert.match(html, /<html lang="[a-z]{2}[^"]*">/);
});

test("report has exactly one h1", () => {
  const html = renderHtml(sampleCatalogue());
  const count = (html.match(/<h1[\s>]/g) || []).length;
  assert.strictEqual(count, 1, "expected a single top-level heading");
});

test("report has a skip link targeting the main landmark", () => {
  const html = renderHtml(sampleCatalogue());
  assert.match(html, /class="skip-link"[^>]*href="#main"|href="#main"[^>]*class="skip-link"/);
  assert.match(html, /<main id="main"/);
});

test("every image has non-empty alt text", () => {
  const html = renderHtml(sampleCatalogue());
  const imgs = html.match(/<img\b[^>]*>/g) || [];
  assert.ok(imgs.length > 0, "fixture should produce at least one image");
  for (const img of imgs) {
    const m = img.match(/\balt="([^"]*)"/);
    assert.ok(m, `img missing alt: ${img}`);
    assert.ok(m[1].trim().length > 0, `img has empty alt: ${img}`);
  }
});

test("every form control has an accessible name", () => {
  const html = renderHtml(sampleCatalogue());
  const controls = html.match(/<(?:input|select)\b[^>]*>/g) || [];
  assert.ok(controls.length > 0, "fixture should produce form controls");
  for (const ctrl of controls) {
    const hasAriaLabel = /\baria-label="[^"]+"/.test(ctrl) || /\baria-labelledby="[^"]+"/.test(ctrl);
    const idMatch = ctrl.match(/\bid="([^"]+)"/);
    const hasLabelFor =
      idMatch && new RegExp(`<label[^>]*\\bfor="${idMatch[1]}"`).test(html);
    assert.ok(hasAriaLabel || hasLabelFor, `control lacks a label: ${ctrl}`);
  }
});

test("every tab controls a matching tabpanel", () => {
  const html = renderHtml(sampleCatalogue());
  const tabs = html.match(/<button\b[^>]*role="tab"[^>]*>/g) || [];
  assert.ok(tabs.length >= 2, "fixture should produce a multi-tab tablist");
  for (const tab of tabs) {
    const controls = tab.match(/\baria-controls="([^"]+)"/);
    assert.ok(controls, `tab missing aria-controls: ${tab}`);
    const panel = new RegExp(`id="${controls[1]}"[^>]*role="tabpanel"`);
    assert.match(html, panel, `no tabpanel for ${controls[1]}`);
  }
});

test("the detail modal is a labelled dialog", () => {
  const html = renderHtml(sampleCatalogue());
  const modal = html.match(/<div id="detail-modal"[^>]*>/);
  assert.ok(modal, "detail modal present");
  assert.match(modal[0], /role="dialog"/);
  assert.match(modal[0], /aria-modal="true"/);
  assert.ok(
    /aria-label="[^"]+"/.test(modal[0]) || /aria-labelledby="[^"]+"/.test(modal[0]),
    "dialog needs an accessible name",
  );
});
