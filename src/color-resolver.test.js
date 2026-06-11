const { test } = require("node:test");
const assert = require("node:assert");
const {
  colorsetToHex,
  parseComponent,
} = require("./color-resolver");

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
