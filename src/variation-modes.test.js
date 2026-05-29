const { test } = require("node:test");
const assert = require("node:assert");
const {
  MODES,
  SELECTABLE,
  parseVariations,
  screenshotFilename,
} = require("./variation-modes");

test("parseVariations defaults to baseline only", () => {
  assert.deepStrictEqual(parseVariations(undefined), ["baseline"]);
  assert.deepStrictEqual(parseVariations(""), ["baseline"]);
  assert.deepStrictEqual(parseVariations("   "), ["baseline"]);
});

test("parseVariations prepends baseline and preserves order", () => {
  assert.deepStrictEqual(parseVariations("dark,type"), [
    "baseline",
    "dark",
    "type",
  ]);
});

test("parseVariations is case-insensitive and trims whitespace", () => {
  assert.deepStrictEqual(parseVariations(" Dark , CONTRAST "), [
    "baseline",
    "dark",
    "contrast",
  ]);
});

test("parseVariations de-duplicates", () => {
  assert.deepStrictEqual(parseVariations("dark,dark"), ["baseline", "dark"]);
});

test("parseVariations 'all' expands to every selectable mode", () => {
  assert.deepStrictEqual(parseVariations("all"), ["baseline", ...SELECTABLE]);
});

test("parseVariations throws on unknown mode", () => {
  assert.throws(() => parseVariations("sideways"), /Unknown variation/);
});

test("screenshotFilename keeps baseline bare, suffixes others", () => {
  assert.strictEqual(screenshotFilename("Card_Default", "baseline"), "Card_Default.png");
  assert.strictEqual(screenshotFilename("Card_Default", "dark"), "Card_Default__dark.png");
});

test("every selectable mode and baseline define both platform trait sets", () => {
  for (const id of ["baseline", ...SELECTABLE]) {
    const mode = MODES[id];
    assert.ok(mode, `mode ${id} exists`);
    assert.ok(mode.label, `mode ${id} has a label`);
    for (const key of ["appearance", "content_size", "increase_contrast"]) {
      assert.ok(mode.ios[key], `mode ${id} ios.${key}`);
    }
    for (const key of ["night", "font_scale", "high_text_contrast"]) {
      assert.ok(mode.android[key], `mode ${id} android.${key}`);
    }
  }
});
