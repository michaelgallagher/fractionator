const { test } = require("node:test");
const assert = require("node:assert");
const {
  colorsetToHex,
  parseComponent,
  schemeMode,
  buildIosColorDefinitions,
  buildAndroidColorDefinitions,
} = require("./color-resolver");

test("schemeMode pairs light and dark palette objects by base", () => {
  assert.deepStrictEqual(schemeMode("NHSLightColors"), {
    base: "NHSColors",
    mode: "light",
  });
  assert.deepStrictEqual(schemeMode("NHSDarkColors"), {
    base: "NHSColors",
    mode: "dark",
  });
  // High-contrast pair shares its own base, distinct from the normal scheme.
  assert.deepStrictEqual(schemeMode("NHSHighContrastLightColors"), {
    base: "NHSHighContrastColors",
    mode: "light",
  });
  assert.deepStrictEqual(schemeMode("NHSHighContrastDarkColors"), {
    base: "NHSHighContrastColors",
    mode: "dark",
  });
  // No mode word → light-only scheme keyed by itself.
  assert.deepStrictEqual(schemeMode("BrandColors"), {
    base: "BrandColors",
    mode: "light",
  });
});

test("parseComponent handles float, integer, and hex forms", () => {
  assert.strictEqual(parseComponent("0.5"), 0.5);
  assert.strictEqual(parseComponent("1.000"), 1);
  assert.strictEqual(parseComponent("255"), 1);
  assert.strictEqual(parseComponent("128"), 128 / 255);
  assert.strictEqual(parseComponent("0xFF"), 1);
  assert.strictEqual(parseComponent(undefined), null);
});

test("colorsetToHex reads light and dark appearances", () => {
  const json = {
    colors: [
      {
        color: {
          components: { red: "0.929", green: "0.545", blue: "0.000" },
        },
      },
      {
        appearances: [{ appearance: "luminosity", value: "dark" }],
        color: {
          components: { red: "1.000", green: "0.635", blue: "0.251" },
        },
      },
    ],
  };
  assert.deepStrictEqual(colorsetToHex(json), {
    light: "#ED8B00",
    dark: "#FFA240",
  });
});

test("colorsetToHex skips high-contrast variants", () => {
  const json = {
    colors: [
      {
        appearances: [{ appearance: "contrast", value: "high" }],
        color: { components: { red: "1", green: "0", blue: "0" } },
      },
      {
        color: { components: { red: "0", green: "0", blue: "0" } },
      },
    ],
  };
  assert.deepStrictEqual(colorsetToHex(json), { light: "#000000" });
});

test("colorsetToHex returns null when nothing resolvable", () => {
  assert.strictEqual(colorsetToHex({ colors: [] }), null);
});

test("buildIosColorDefinitions names tokens by alias and resolves via assets", () => {
  const assets = new Map([
    ["NHSBlue", { light: "#005EB8", dark: "#52A0FF" }],
    ["NHSWarmYellow", { light: "#FFB81C" }],
  ]);
  const aliases = new Map([
    ["nhsBlue", { assetName: "NHSBlue" }],
    ["nhsWarmYellow", { assetName: "NHSWarmYellow" }],
  ]);
  assert.deepStrictEqual(buildIosColorDefinitions(assets, aliases), [
    { token: "nhsBlue", light: "#005EB8", dark: "#52A0FF" },
    { token: "nhsWarmYellow", light: "#FFB81C" }, // no dark key when absent
  ]);
});

test("buildIosColorDefinitions resolves case-insensitively and includes literal-hex aliases", () => {
  const assets = new Map([["NHSGreen", { light: "#007F3B", dark: "#00C55F" }]]);
  const aliases = new Map([
    ["nhsgreen", { assetName: "nhsgreen" }], // different case than the asset
    ["nhsBrand", { hex: "#AB1234" }], // literal Color(red:green:blue:) alias
  ]);
  assert.deepStrictEqual(buildIosColorDefinitions(assets, aliases), [
    { token: "nhsgreen", light: "#007F3B", dark: "#00C55F" },
    { token: "nhsBrand", light: "#AB1234" },
  ]);
});

test("buildIosColorDefinitions appends assets that have no alias", () => {
  const assets = new Map([
    ["NHSBlue", { light: "#005EB8" }],
    ["NHSOrphan", { light: "#123456" }],
  ]);
  const aliases = new Map([["nhsBlue", { assetName: "NHSBlue" }]]);
  assert.deepStrictEqual(buildIosColorDefinitions(assets, aliases), [
    { token: "nhsBlue", light: "#005EB8" },
    { token: "NHSOrphan", light: "#123456" },
  ]);
});

test("buildAndroidColorDefinitions pairs props by scheme in source order", () => {
  const schemes = new Map([
    ["NHSColors|paleBlue", { light: "#CCDFF1", dark: "#002F5C" }],
    ["NHSColors|blue", { light: "#005EB8", dark: "#3698FF" }],
    ["NHSColors|warmYellow", { light: "#FFB81C" }],
  ]);
  assert.deepStrictEqual(buildAndroidColorDefinitions(schemes), [
    { token: "paleBlue", light: "#CCDFF1", dark: "#002F5C" },
    { token: "blue", light: "#005EB8", dark: "#3698FF" },
    { token: "warmYellow", light: "#FFB81C" },
  ]);
});

test("buildAndroidColorDefinitions excludes high-contrast schemes", () => {
  const schemes = new Map([
    ["NHSColors|blue", { light: "#005EB8", dark: "#3698FF" }],
    ["NHSHighContrastColors|blue", { light: "#000000", dark: "#FFFFFF" }],
  ]);
  assert.deepStrictEqual(buildAndroidColorDefinitions(schemes), [
    { token: "blue", light: "#005EB8", dark: "#3698FF" },
  ]);
});

test("buildAndroidColorDefinitions appends colors.xml names not in the palette", () => {
  const schemes = new Map([["NHSColors|blue", { light: "#005EB8" }]]);
  const xmlColors = new Map([
    ["blue", "#999999"], // already a palette prop — skipped
    ["legacyTeal", "#00A5A5"],
  ]);
  assert.deepStrictEqual(buildAndroidColorDefinitions(schemes, xmlColors), [
    { token: "blue", light: "#005EB8" },
    { token: "legacyTeal", light: "#00A5A5" },
  ]);
});
