const { test } = require("node:test");
const assert = require("node:assert");
const {
  iosTokenSpec,
  androidTokenSpec,
  rgbFloatToHex,
  argbToHex,
} = require("./token-scanner");

// Identity "stripper" — these unit tests feed already-clean lines.
const noStrip = (s) => s;

/** Run every matcher of one category against a line, flattening the results. */
function run(spec, category, line) {
  return spec[category].flatMap((m) => m(line));
}

// --- iOS colors ---

test("iOS: named asset color", () => {
  const hits = run(iosTokenSpec(noStrip), "colors", '.foreground(Color("NHSGreen"))');
  assert.deepStrictEqual(hits, [
    { key: "NHSGreen", display: 'Color("NHSGreen")', kind: "asset" },
  ]);
});

test("iOS: brand alias vs system color", () => {
  const spec = iosTokenSpec(noStrip);
  const alias = run(spec, "colors", "background(Color.nhsGreen)");
  assert.strictEqual(alias[0].key, "nhsGreen");
  assert.strictEqual(alias[0].kind, "alias");

  const sys = run(spec, "colors", "Color.primary");
  assert.strictEqual(sys[0].kind, "semantic");
});

test("iOS: literal rgb resolves to hex", () => {
  const hits = run(
    iosTokenSpec(noStrip),
    "colors",
    "Color(red: 0.929, green: 0.545, blue: 0.0)",
  );
  assert.strictEqual(hits[0].kind, "literal");
  assert.strictEqual(hits[0].value.light, "#ED8B00");
});

// --- iOS typography ---

test("iOS: explicit system size with weight", () => {
  const hits = run(
    iosTokenSpec(noStrip),
    "typography",
    ".font(.system(size: 20, weight: .bold))",
  );
  assert.strictEqual(hits[0].key, "system-20-bold");
  assert.strictEqual(hits[0].size, 20);
  assert.strictEqual(hits[0].weight, "bold");
});

test("iOS: semantic text style", () => {
  const hits = run(iosTokenSpec(noStrip), "typography", "Text(x).font(.title3)");
  assert.strictEqual(hits[0].key, "title3");
  assert.strictEqual(hits[0].kind, "semantic");
});

// --- iOS spacing ---

test("iOS: stack spacing and edge padding", () => {
  const spec = iosTokenSpec(noStrip);
  const sp = run(spec, "spacing", "VStack(spacing: 16) {");
  assert.strictEqual(sp[0].value, 16);
  assert.strictEqual(sp[0].context, "spacing");

  const pad = run(spec, "spacing", ".padding(.vertical, 8)");
  assert.strictEqual(pad[0].value, 8);
  assert.strictEqual(pad[0].context, "padding");

  const uniform = run(spec, "spacing", ".padding(20)");
  assert.strictEqual(uniform[0].value, 20);
});

// --- Android ---

test("Android: literal hex drops alpha", () => {
  const hits = run(androidTokenSpec(noStrip), "colors", "Color(0xFFED8B00)");
  assert.strictEqual(hits[0].value.light, "#ED8B00");
  assert.strictEqual(hits[0].kind, "literal");
});

test("Android: colorScheme reference is semantic", () => {
  const hits = run(
    androidTokenSpec(noStrip),
    "colors",
    "color = MaterialTheme.colorScheme.primary",
  );
  assert.strictEqual(hits[0].key, "primary");
  assert.strictEqual(hits[0].kind, "semantic");
});

test("Android: sp matcher skips letterSpacing and lineHeight", () => {
  const spec = androidTokenSpec(noStrip);
  assert.deepStrictEqual(run(spec, "typography", "letterSpacing = 0.025.sp,"), []);
  assert.deepStrictEqual(run(spec, "typography", "lineHeight = 24.sp,"), []);
  // Real font sizes still captured, with or without the keyword.
  assert.strictEqual(run(spec, "typography", "fontSize = 16.sp,")[0].size, 16);
  assert.strictEqual(run(spec, "typography", "Text(x, 18.sp)")[0].size, 18);
});

test("Android: sp typography and dp spacing", () => {
  const spec = androidTokenSpec(noStrip);
  const type = run(spec, "typography", "fontSize = 16.sp,");
  assert.strictEqual(type[0].size, 16);

  const sp = run(spec, "spacing", "Modifier.padding(24.dp)");
  assert.strictEqual(sp[0].value, 24);
  assert.strictEqual(sp[0].unit, "dp");
});

test("Android: multiple dp on one line both captured", () => {
  const sp = run(
    androidTokenSpec(noStrip),
    "spacing",
    "padding(horizontal = 16.dp, vertical = 8.dp)",
  );
  assert.deepStrictEqual(
    sp.map((h) => h.value),
    [16, 8],
  );
});

// --- conversion helpers ---

test("rgbFloatToHex clamps and rounds", () => {
  assert.strictEqual(rgbFloatToHex(1, 1, 1), "#FFFFFF");
  assert.strictEqual(rgbFloatToHex(0, 0, 0), "#000000");
  assert.strictEqual(rgbFloatToHex(2, -1, 0.5), "#FF0080");
});

test("argbToHex handles 6- and 8-digit input", () => {
  assert.strictEqual(argbToHex("FFED8B00"), "#ED8B00");
  assert.strictEqual(argbToHex("ED8B00"), "#ED8B00");
});
