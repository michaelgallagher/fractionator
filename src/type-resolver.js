const fs = require("fs");
const { globSync } = require("glob");

/**
 * Resolve Android Material type roles (`MaterialTheme.typography.bodyLarge`) to
 * their point sizes so semantic type tokens land on the same scale as explicit
 * `N.sp` values — mirroring how the iOS catalogue resolves system text styles.
 *
 * Compose's idiomatic pattern is to define a custom `Typography(...)` in the
 * theme, where each role is a `TextStyle(fontSize = N.sp, …)`, and reference it
 * via `MaterialTheme.typography.<role>` rather than hardcoding sizes. We parse
 * that block; any role the prototype doesn't override falls back to the Material
 * 3 default scale.
 */

const IGNORE_DIRS = [
  "**/DerivedData/**",
  "**/.build/**",
  "**/build/**",
  "**/Pods/**",
];

// Material 3 default type scale (sp), used when a role isn't defined locally.
const M3_DEFAULTS = {
  displayLarge: 57,
  displayMedium: 45,
  displaySmall: 36,
  headlineLarge: 32,
  headlineMedium: 28,
  headlineSmall: 24,
  titleLarge: 22,
  titleMedium: 16,
  titleSmall: 14,
  bodyLarge: 16,
  bodyMedium: 14,
  bodySmall: 12,
  labelLarge: 14,
  labelMedium: 12,
  labelSmall: 11,
};

/**
 * @param {string} projectPath - Android project root
 * @returns {{ resolve: (role: string) => (number|null) }}
 */
function buildAndroidTypeResolver(projectPath) {
  const roles = new Map(); // role → size (sp)

  const files = globSync("**/*.kt", {
    cwd: projectPath,
    absolute: true,
    ignore: IGNORE_DIRS,
  });

  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    indexTextStyleRoles(src, roles);
  }

  function resolve(role) {
    if (roles.has(role)) return roles.get(role);
    return M3_DEFAULTS[role] ?? null;
  }

  return { resolve };
}

/**
 * Parse `role = TextStyle( … fontSize = N.sp … )` assignments into `roles`.
 * Uses balanced-paren extraction so nested calls (FontFamily, etc.) don't
 * confuse the fontSize lookup. The last definition of a role wins, which is
 * fine — duplicate role blocks (e.g. light/dark Typography) share sizes.
 */
function indexTextStyleRoles(src, roles) {
  const assign = /(\w+)\s*=\s*TextStyle\s*\(/g;
  let m;
  while ((m = assign.exec(src)) !== null) {
    const role = m[1];
    const openParen = src.indexOf("(", m.index + m[0].length - 1);
    const block = extractBalancedParens(src, openParen);
    if (!block) continue;
    const sizeMatch = block.match(/\bfontSize\s*=\s*(\d+(?:\.\d+)?)\s*\.sp\b/);
    if (sizeMatch) roles.set(role, parseFloat(sizeMatch[1]));
  }
}

/**
 * Return the substring between `openPos` (a `(`) and its matching `)`, or null
 * if unbalanced. Ignores parens inside string literals.
 */
function extractBalancedParens(src, openPos) {
  if (src[openPos] !== "(") return null;
  let depth = 0;
  let i = openPos;
  const len = src.length;
  while (i < len) {
    const ch = src[i];
    if (ch === '"') {
      i++;
      while (i < len) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === '"') break;
        i++;
      }
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(openPos + 1, i);
    }
    i++;
  }
  return null;
}

module.exports = {
  buildAndroidTypeResolver,
  M3_DEFAULTS,
  // exported for tests
  indexTextStyleRoles,
  extractBalancedParens,
};
