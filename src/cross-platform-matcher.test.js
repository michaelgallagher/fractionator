const { test } = require("node:test");
const assert = require("node:assert");
const { matchComponents, normalizeName } = require("./cross-platform-matcher");

/** Find the alignment entry whose concept matches. */
function byConcept(entries, concept) {
  return entries.find((e) => e.concept === concept);
}

test("normalizeName strips default prefix and suffix", () => {
  assert.strictEqual(normalizeName("NHSCard"), "card");
  assert.strictEqual(normalizeName("NHSCardUI"), "card");
  assert.strictEqual(normalizeName("CardView"), "card");
  assert.strictEqual(normalizeName("Card"), "card");
  // A name equal to a prefix/suffix is left intact (length guard).
  assert.strictEqual(normalizeName("NHS"), "nhs");
  assert.strictEqual(normalizeName("View"), "view");
});

test("exact name match across platforms", () => {
  const entries = matchComponents({
    ios: [{ name: "BadgeIcon" }],
    android: [{ name: "BadgeIcon" }],
  });
  const entry = byConcept(entries, "BadgeIcon");
  assert.ok(entry);
  assert.strictEqual(entry.source, "exact");
  assert.strictEqual(entry.status, "matched");
  assert.strictEqual(entry.drift, false);
  assert.deepStrictEqual(entry.platforms, {
    ios: "BadgeIcon",
    android: "BadgeIcon",
  });
});

test("normalized match flags drift", () => {
  const entries = matchComponents({
    ios: [{ name: "NHSCard" }],
    android: [{ name: "NHSCardUI" }],
  });
  const entry = byConcept(entries, "Card");
  assert.ok(entry);
  assert.strictEqual(entry.source, "normalized");
  assert.strictEqual(entry.status, "matched");
  assert.strictEqual(entry.drift, true);
  assert.strictEqual(entry.platforms.ios, "NHSCard");
  assert.strictEqual(entry.platforms.android, "NHSCardUI");
});

test("manual mapping overrides auto-matching", () => {
  // RowLink and NHSRowItem would not auto-match; the mapping links them.
  const entries = matchComponents(
    {
      ios: [{ name: "RowLink" }],
      android: [{ name: "NHSRowItem" }],
    },
    {
      mappings: [
        { concept: "Row link", ios: "RowLink", android: "NHSRowItem" },
      ],
    },
  );
  const entry = byConcept(entries, "Row link");
  assert.ok(entry);
  assert.strictEqual(entry.source, "mapping");
  assert.strictEqual(entry.status, "matched");
  assert.strictEqual(entry.drift, true);
  // No leftover platform-only entries for these components.
  assert.strictEqual(entries.length, 1);
});

test("mapping wins over an available exact match", () => {
  const entries = matchComponents(
    {
      ios: [{ name: "Card" }],
      android: [{ name: "Card" }],
    },
    { mappings: [{ concept: "The Card", ios: "Card", android: "Card" }] },
  );
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].concept, "The Card");
  assert.strictEqual(entries[0].source, "mapping");
});

test("mapping names not detected are surfaced as missing", () => {
  const entries = matchComponents(
    { ios: [{ name: "RowLink" }], android: [] },
    { mappings: [{ concept: "Row link", ios: "RowLink", android: "Ghost" }] },
  );
  const entry = byConcept(entries, "Row link");
  assert.deepStrictEqual(entry.missing, ["android:Ghost"]);
});

test("unmatched components become platform-only", () => {
  const entries = matchComponents({
    ios: [{ name: "CampaignCard" }],
    android: [{ name: "BadgeIcon" }],
  });
  const ios = byConcept(entries, "CampaignCard");
  const android = byConcept(entries, "BadgeIcon");
  assert.strictEqual(ios.status, "platform-only");
  assert.strictEqual(ios.source, "ios");
  assert.strictEqual(android.status, "platform-only");
  assert.strictEqual(android.source, "android");
});

test("matched concepts sort before platform-only", () => {
  const entries = matchComponents({
    ios: [{ name: "BadgeIcon" }, { name: "CampaignCard" }],
    android: [{ name: "BadgeIcon" }],
  });
  assert.strictEqual(entries[0].status, "matched");
  assert.strictEqual(entries[entries.length - 1].status, "platform-only");
});
