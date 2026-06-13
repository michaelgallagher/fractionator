const { test } = require("node:test");
const assert = require("node:assert");
const { detectRenderedComponents } = require("./swift-screenshot-capture");

const COMPONENTS = new Set([
  "RowLink",
  "DetailView",
  "TextButton",
  "ChevronIcon",
]);

test("detectRenderedComponents finds the components a #Preview body constructs", () => {
  const body = `
    NavigationStack {
      List {
        RowLink(title: "One") { DetailView(item: 1) }
        RowLink(title: "Two") { DetailView(item: 2) }
      }
    }`;
  assert.deepStrictEqual(
    detectRenderedComponents(body, COMPONENTS, null).sort(),
    ["DetailView", "RowLink"],
  );
});

test("detectRenderedComponents attributes a single-component preview to one", () => {
  const body = `TextButton(title: "Tap") {}`;
  assert.deepStrictEqual(detectRenderedComponents(body, COMPONENTS, null), [
    "TextButton",
  ]);
});

test("detectRenderedComponents ignores names in comments and strings", () => {
  const body = `
    // RowLink(title: "x") { DetailView() }
    Text("see RowLink for details")
    TextButton(title: "real") {}`;
  assert.deepStrictEqual(detectRenderedComponents(body, COMPONENTS, null), [
    "TextButton",
  ]);
});

test("detectRenderedComponents skips a self reference", () => {
  const body = `TextButton(title: "x") {}\nChevronIcon()`;
  assert.deepStrictEqual(
    detectRenderedComponents(body, COMPONENTS, "TextButton"),
    ["ChevronIcon"],
  );
});
