const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadTokenGroups, groupsFor } = require("./token-groups-loader");

/** Write `content` to a temp .yaml file and run `fn` with its path. */
function withGroupsFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fract-groups-"));
  const file = path.join(dir, "token-groups.yaml");
  fs.writeFileSync(file, content);
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("loadTokenGroups parses a valid config", () => {
  const yaml = `
ios:
  colours:
    - heading: Accent colour
      description: The tint colour.
      tokens: [nhsAccentColor]
    - heading: Core palette
      tokens: [nhsBlue, nhsGreen]
android:
  colours:
    - heading: Core palette
      tokens: [blue, green]
`;
  withGroupsFile(yaml, (file) => {
    const config = loadTokenGroups(file);
    assert.strictEqual(config.ios.colours.length, 2);
    assert.deepStrictEqual(config.ios.colours[0], {
      heading: "Accent colour",
      description: "The tint colour.",
      tokens: ["nhsAccentColor"],
    });
    assert.deepStrictEqual(config.android.colours[0].tokens, ["blue", "green"]);
  });
});

test("loadTokenGroups rejects a non-list category", () => {
  withGroupsFile("ios:\n  colours: nope\n", (file) => {
    assert.throws(() => loadTokenGroups(file), /must be a list of groups/);
  });
});

test("loadTokenGroups rejects a group missing heading or tokens", () => {
  withGroupsFile("ios:\n  colours:\n    - tokens: [a]\n", (file) => {
    assert.throws(() => loadTokenGroups(file), /needs a string "heading"/);
  });
  withGroupsFile("ios:\n  colours:\n    - heading: X\n", (file) => {
    assert.throws(() => loadTokenGroups(file), /needs a "tokens" list/);
  });
});

test("loadTokenGroups reports a clear error for a missing file", () => {
  assert.throws(
    () => loadTokenGroups("/no/such/token-groups.yaml"),
    /Cannot read token-groups file/,
  );
});

test("groupsFor slices a platform+category, undefined when absent", () => {
  const config = { ios: { colours: [{ heading: "Core", tokens: ["a"] }] } };
  assert.deepStrictEqual(groupsFor(config, "ios", "colours"), [
    { heading: "Core", tokens: ["a"] },
  ]);
  assert.strictEqual(groupsFor(config, "ios", "spacing"), undefined);
  assert.strictEqual(groupsFor(config, "android", "colours"), undefined);
  assert.strictEqual(groupsFor(undefined, "ios", "colours"), undefined);
});
