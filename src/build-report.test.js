const { test } = require("node:test");
const assert = require("node:assert");
const { detectSpacingScale } = require("./build-report");

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
