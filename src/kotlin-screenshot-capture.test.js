const { test } = require("node:test");
const assert = require("node:assert");
const {
  extractPreviewFunctionRecords,
  detectRenderedComponents,
} = require("./kotlin-screenshot-capture");

const COMPONENTS = new Set([
  "NHSFilledButton",
  "NHSOutlinedButton",
  "NHSTextButton",
  "NHSIconButton",
  "WidgetCard",
  "getSampleCardData", // a helper the scanner may miscount as a component
]);

test("detectRenderedComponents finds the components a body calls", () => {
  const body = `
    Column {
      NHSFilledButton("Filled", onClick = {})
      NHSOutlinedButton("Outlined", onClick = {})
      NHSTextButton("Text", onClick = {})
    }`;
  assert.deepStrictEqual(detectRenderedComponents(body, COMPONENTS, "X").sort(), [
    "NHSFilledButton",
    "NHSOutlinedButton",
    "NHSTextButton",
  ]);
});

test("detectRenderedComponents ignores lowercase helpers and the preview itself", () => {
  const body = `
    val data = getSampleCardData()
    WidgetCard(data)
    NHSFilledButton("x", onClick = {})`;
  const found = detectRenderedComponents(body, COMPONENTS, "WidgetCard");
  assert.ok(!found.includes("getSampleCardData"), "drops lowercase helper");
  assert.ok(!found.includes("WidgetCard"), "drops self");
  assert.deepStrictEqual(found, ["NHSFilledButton"]);
});

test("detectRenderedComponents ignores names in comments and strings", () => {
  const body = `
    // NHSOutlinedButton("not real")
    Text("see NHSTextButton for details")
    NHSFilledButton("real", onClick = {})`;
  assert.deepStrictEqual(detectRenderedComponents(body, COMPONENTS, "X"), [
    "NHSFilledButton",
  ]);
});

test("detectRenderedComponents does not partial-match substrings", () => {
  // NHSIconButton contains "Button" — a bare "Button(" must not match it, and
  // NHSFilledButton must not match "NHSFilled".
  const names = new Set(["Button", "NHSFilledButton"]);
  const body = `NHSFilledButton("x", onClick = {})`;
  assert.deepStrictEqual(detectRenderedComponents(body, names, "X"), [
    "NHSFilledButton",
  ]);
});

test("extractPreviewFunctionRecords computes renders for a showcase preview", () => {
  const src = `
    package com.x
    @Preview(name = "NHS Buttons")
    @Composable
    fun NHSButtonsPreview() {
      Column {
        NHSFilledButton("Filled", onClick = {})
        NHSOutlinedButton("Outlined", onClick = {})
      }
    }`;
  const [rec] = extractPreviewFunctionRecords(src, "com.x", COMPONENTS);
  assert.strictEqual(rec.functionName, "NHSButtonsPreview");
  assert.strictEqual(rec.previewName, "NHS Buttons");
  assert.strictEqual(rec.skip, null);
  assert.deepStrictEqual(rec.renders.sort(), [
    "NHSFilledButton",
    "NHSOutlinedButton",
  ]);
});

test("extractPreviewFunctionRecords skips private and parameterised previews", () => {
  const src = `
    package com.x
    @Preview @Composable private fun PrivatePreview() { NHSFilledButton("x") {} }
    @Preview @Composable fun ParamPreview(value: Int) { NHSTextButton("x") {} }
    @Preview @Composable fun OkPreview(value: Int = 1) { NHSIconButton() }`;
  const recs = extractPreviewFunctionRecords(src, "com.x", COMPONENTS);
  const byName = Object.fromEntries(recs.map((r) => [r.functionName, r.skip]));
  assert.match(byName.PrivatePreview, /private/);
  assert.match(byName.ParamPreview, /parameter/i);
  assert.strictEqual(byName.OkPreview, null, "default-valued param is capturable");
});

test("extractPreviewFunctionRecords leaves renders empty without componentNames", () => {
  const src = `
    package com.x
    @Preview @Composable fun P() { NHSFilledButton("x") {} }`;
  const [rec] = extractPreviewFunctionRecords(src, "com.x");
  assert.deepStrictEqual(rec.renders, []);
});
