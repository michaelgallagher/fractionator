const { test } = require("node:test");
const assert = require("node:assert");
const { buildTokenCatalogue } = require("./token-catalogue");

const at = (relativePath, lineNumber) => ({ relativePath, lineNumber });

test("colors merge by resolved hex and collect aliases", () => {
  const resolver = {
    resolve: (key) =>
      key === "NHSWhite" || key === "nhsWhite" ? { light: "#FFFFFF", dark: "#242B30" } : null,
  };
  const occ = [
    { category: "colors", key: "NHSWhite", display: 'Color("NHSWhite")', kind: "asset", ...at("A.swift", 1) },
    { category: "colors", key: "nhsWhite", display: "Color.nhsWhite", kind: "alias", ...at("B.swift", 2) },
    { category: "colors", key: "nhsWhite", display: "Color.nhsWhite", kind: "alias", ...at("C.swift", 3) },
  ];
  const { colors } = buildTokenCatalogue(occ, resolver);
  assert.strictEqual(colors.length, 1);
  assert.strictEqual(colors[0].count, 3);
  assert.deepStrictEqual(colors[0].value, { light: "#FFFFFF", dark: "#242B30" });
  // Most-used display wins; the other is recorded as an alias.
  assert.strictEqual(colors[0].display, "Color.nhsWhite");
  assert.deepStrictEqual(colors[0].aliases, ['Color("NHSWhite")']);
});

test("unresolved colors group by key and keep semantic kind", () => {
  const resolver = { resolve: () => null };
  const occ = [
    { category: "colors", key: "primary", display: "Color.primary", kind: "semantic", ...at("A.swift", 1) },
    { category: "colors", key: "clear", display: "Color.clear", kind: "semantic", ...at("A.swift", 2) },
  ];
  const { colors } = buildTokenCatalogue(occ, resolver);
  assert.strictEqual(colors.length, 2);
  assert.ok(colors.every((c) => c.value === null && c.kind === "semantic"));
});

test("literal colors keep their own value without a resolver", () => {
  const occ = [
    { category: "colors", key: "#ED8B00", display: "#ED8B00", kind: "literal", value: { light: "#ED8B00" }, ...at("A.kt", 1) },
  ];
  const { colors } = buildTokenCatalogue(occ, null);
  assert.strictEqual(colors[0].value.light, "#ED8B00");
});

test("typography orders as an ascending size scale", () => {
  const occ = [
    { category: "typography", key: "body", display: ".body", kind: "semantic", ...at("A.swift", 1) },
    { category: "typography", key: "system-40", display: ".system(size: 40)", kind: "explicit", size: 40, ...at("A.swift", 2) },
    { category: "typography", key: "caption", display: ".caption", kind: "semantic", ...at("A.swift", 3) },
  ];
  const { typography } = buildTokenCatalogue(occ, null);
  // caption (12) < body (17) < system 40
  assert.deepStrictEqual(
    typography.map((t) => t.key),
    ["caption", "body", "system-40"],
  );
});

test("spacing aggregates by value, ascending, with contexts", () => {
  const occ = [
    { category: "spacing", key: "16", display: "16", value: 16, unit: "pt", context: "spacing", ...at("A.swift", 1) },
    { category: "spacing", key: "16", display: "16", value: 16, unit: "pt", context: "padding", ...at("A.swift", 2) },
    { category: "spacing", key: "4", display: "4", value: 4, unit: "pt", context: "padding", ...at("A.swift", 3) },
  ];
  const { spacing } = buildTokenCatalogue(occ, null);
  assert.deepStrictEqual(spacing.map((s) => s.value), [4, 16]);
  assert.strictEqual(spacing[1].count, 2);
  assert.deepStrictEqual(spacing[1].contexts, ["padding", "spacing"]);
});
