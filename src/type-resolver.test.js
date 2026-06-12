const { test } = require("node:test");
const assert = require("node:assert");
const {
  indexTextStyleRoles,
  extractBalancedParens,
} = require("./type-resolver");

test("indexTextStyleRoles maps roles to fontSize", () => {
  const src = `
    val Typography = Typography(
      titleLarge = TextStyle(
        fontFamily = Frutiger,
        fontWeight = FontWeight.Bold,
        fontSize = 22.sp,
      ),
      bodyLarge = TextStyle(
        fontSize = 16.sp,
      ),
    )`;
  const roles = new Map();
  indexTextStyleRoles(src, roles);
  assert.strictEqual(roles.get("titleLarge"), 22);
  assert.strictEqual(roles.get("bodyLarge"), 16);
});

test("indexTextStyleRoles ignores parens inside nested calls/strings", () => {
  const src = `
    bodyMedium = TextStyle(
      fontFamily = FontFamily(Font(R.font.x, weight = "(900)")),
      fontSize = 14.sp,
    )`;
  const roles = new Map();
  indexTextStyleRoles(src, roles);
  assert.strictEqual(roles.get("bodyMedium"), 14);
});

test("indexTextStyleRoles: last definition wins for duplicate roles", () => {
  const src = `
    bodyLarge = TextStyle(fontSize = 16.sp)
    bodyLarge = TextStyle(fontSize = 18.sp)`;
  const roles = new Map();
  indexTextStyleRoles(src, roles);
  assert.strictEqual(roles.get("bodyLarge"), 18);
});

test("extractBalancedParens returns inner content", () => {
  assert.strictEqual(extractBalancedParens("f(a, g(b), c)", 1), "a, g(b), c");
  assert.strictEqual(extractBalancedParens("(unterminated", 0), null);
});
