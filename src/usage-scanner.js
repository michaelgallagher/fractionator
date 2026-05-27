const fs = require("fs");
const path = require("path");
const { stripSwiftComments, extractBraceBlock } = require("./swift-component-scanner");

/**
 * Scan all source files for call sites of the given components.
 *
 * For each component, finds every `ComponentName(` or `ComponentName {` usage
 * outside the component's own definition file. Extracts:
 *   - file path and line number
 *   - the screen/view that contains the call (nearest enclosing struct: View)
 *   - raw argument text (best-effort extraction)
 *
 * @param {ComponentDef[]} components - From the component scanner
 * @param {string[]} allSourceFiles - All Swift files in the project
 * @param {string} projectPath - Project root for relative paths
 * @returns {Map<string, Usage[]>} - Component name → list of usages
 */
function scanUsages(components, allSourceFiles, projectPath) {
  const usageMap = new Map();
  for (const comp of components) {
    usageMap.set(comp.name, []);
  }

  // Build a set of component names for fast lookup
  const componentNames = new Set(components.map((c) => c.name));

  // Build a map of component name → definition file for exclusion
  const defFiles = new Map();
  for (const comp of components) {
    defFiles.set(comp.name, comp.filePath);
  }

  // Pre-compile a single regex that matches any component name followed by ( or {
  // Sort by length descending so longer names match first
  const sortedNames = [...componentNames].sort((a, b) => b.length - a.length);
  if (sortedNames.length === 0) return usageMap;

  const namesPattern = sortedNames.map(escapeRegex).join("|");
  // Match component call: not preceded by word char (avoid FooNHSSection matching NHSSection)
  // Followed by ( or whitespace+{ (trailing closure syntax)
  const callPattern = new RegExp(
    `(?<![\\w.])(?:${namesPattern})\\s*(?:\\(|\\{)`,
    "g",
  );

  for (const filePath of allSourceFiles) {
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const content = stripSwiftComments(rawContent);
    const rawLines = rawContent.split("\n");
    const relativePath = path.relative(projectPath, filePath);

    // Determine which view/screen this file defines (if any)
    const enclosingView = detectEnclosingView(content);

    let match;
    callPattern.lastIndex = 0;

    while ((match = callPattern.exec(content)) !== null) {
      const matchStr = match[0];
      // Extract the component name (strip trailing whitespace and ( or {)
      const nameMatch = matchStr.match(/^(\w+)/);
      if (!nameMatch) continue;
      const compName = nameMatch[1];

      if (!componentNames.has(compName)) continue;

      // Skip usages in the component's own definition file
      if (defFiles.get(compName) === filePath) continue;

      // Skip usages inside #Preview blocks
      if (isInsidePreview(content, match.index)) continue;

      // Find the line number in the raw source
      const lineNumber = lineNumberAt(content, match.index, rawContent);

      // Extract arguments (best-effort)
      const args = extractCallArguments(content, match.index + matchStr.length - 1);

      const usages = usageMap.get(compName);
      if (usages) {
        usages.push({
          filePath,
          relativePath,
          lineNumber,
          enclosingView: enclosingView || path.basename(filePath, ".swift"),
          rawArgs: args,
        });
      }
    }
  }

  return usageMap;
}

/**
 * Find the primary View struct defined in this file (the "screen" name).
 */
function detectEnclosingView(content) {
  const match = content.match(
    /\bstruct\s+(\w+)\s*(?:<[^>]*>)?\s*:\s*(?:[^{]*?\b)?View\b/,
  );
  return match ? match[1] : null;
}

/**
 * Check whether a position in the source is inside a #Preview or @Preview block.
 */
function isInsidePreview(content, pos) {
  // Search backwards from pos for the nearest #Preview or @Preview
  const before = content.slice(0, pos);
  const lastPreview = Math.max(
    before.lastIndexOf("#Preview"),
    before.lastIndexOf("@Preview"),
    before.lastIndexOf("Preview {"),
  );
  if (lastPreview === -1) return false;

  // Check if we're still inside that preview's brace block
  const bracePos = content.indexOf("{", lastPreview);
  if (bracePos === -1 || bracePos > pos) return false;

  const block = extractBraceBlock(content, bracePos);
  if (!block) return false;

  return pos >= block.start && pos < block.end;
}

/**
 * Map a character offset in the stripped content to a line number in the
 * raw source. Since comment stripping can shift positions, we approximate
 * by counting newlines up to the offset in the stripped content, then
 * searching for the component name near that line in the raw source.
 */
function lineNumberAt(strippedContent, offset, rawContent) {
  // Count newlines in stripped content up to offset
  let newlines = 0;
  for (let i = 0; i < offset && i < strippedContent.length; i++) {
    if (strippedContent[i] === "\n") newlines++;
  }
  // Line numbers are 1-based
  return newlines + 1;
}

/**
 * Extract the argument text of a component call.
 * `pos` should point to the opening ( or { character.
 *
 * Returns a string of the raw arguments, or null if extraction fails.
 * For trailing-closure syntax `Foo { ... }`, returns the closure content.
 * For parenthesised calls `Foo(arg: val)`, returns the args between parens.
 */
function extractCallArguments(content, pos) {
  const ch = content[pos];

  if (ch === "(") {
    // Extract parenthesised arguments
    const block = extractParenBlock(content, pos);
    if (!block) return null;

    let args = block.content.trim();

    // Check for trailing closure after the closing paren
    const afterParen = content.slice(block.end).match(/^\s*\{/);
    if (afterParen) {
      // There's a trailing closure — note it but don't extract the full body
      args = args ? args + " { ... }" : "{ ... }";
    }

    return args || null;
  }

  if (ch === "{") {
    // Trailing closure only (no parenthesised args)
    return "{ ... }";
  }

  return null;
}

/**
 * Extract content between matching parentheses.
 */
function extractParenBlock(source, openPos) {
  if (source[openPos] !== "(") return null;

  let depth = 1;
  let i = openPos + 1;
  const len = source.length;

  while (i < len && depth > 0) {
    const ch = source[i];
    if (ch === '"') {
      // Skip string literal
      if (source[i + 1] === '"' && source[i + 2] === '"') {
        const end = source.indexOf('"""', i + 3);
        i = end === -1 ? len : end + 3;
        continue;
      }
      i++;
      while (i < len) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth > 0) i++;
    else i++;
  }

  if (depth !== 0) return null;

  return {
    content: source.slice(openPos + 1, i - 1),
    start: openPos,
    end: i,
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { scanUsages };
