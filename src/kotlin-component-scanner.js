const fs = require("fs");
const path = require("path");
const { globSync } = require("glob");
const { extractBraceBlock } = require("./swift-component-scanner");

/**
 * Scan a Jetpack Compose project for component definitions.
 *
 * Components are `@Composable fun Foo(...)` declarations in files matching
 * the components directory glob. For each component we extract:
 *   - name (the function name)
 *   - filePath / relativePath
 *   - signature (function parameters that form the public API)
 *   - preview names (@Preview functions)
 *
 * @param {string} projectPath - Root of the Android prototype
 * @param {string|null} componentsDirOverride - Glob override for component paths
 * @returns {{ components: ComponentDef[], allKotlinFiles: string[] }}
 */
function scanKotlinComponents(projectPath, componentsDirOverride) {
  // Find all Kotlin files in the project (excluding build artefacts)
  const allKotlinFiles = globSync("**/*.kt", {
    cwd: projectPath,
    absolute: true,
    ignore: [
      "**/build/**",
      "**/.gradle/**",
      "**/.idea/**",
      "**/test/**",
      "**/androidTest/**",
    ],
  });

  // Determine which files are "component" files
  const componentsGlob =
    componentsDirOverride || "**/components/**/*.kt";
  const componentFiles = new Set(
    globSync(componentsGlob, {
      cwd: projectPath,
      absolute: true,
      ignore: [
        "**/build/**",
        "**/.gradle/**",
        "**/.idea/**",
        "**/test/**",
        "**/androidTest/**",
      ],
    }),
  );

  const components = [];

  for (const filePath of allKotlinFiles) {
    if (!componentFiles.has(filePath)) continue;

    const content = fs.readFileSync(filePath, "utf-8");
    const stripped = stripKotlinComments(content);
    const relativePath = path.relative(projectPath, filePath);

    const defs = extractComposableDefs(stripped, filePath, relativePath);
    components.push(...defs);
  }

  // Merge overloads — multiple @Composable fun with the same name become
  // one component entry with combined signatures.
  const merged = mergeOverloads(components);

  return { components: merged, allKotlinFiles };
}

/**
 * Strip Kotlin line and block comments, preserving string literals.
 * Kotlin does not support nested block comments (unlike Swift).
 */
function stripKotlinComments(src) {
  let out = "";
  let i = 0;
  const len = src.length;

  while (i < len) {
    // String literal — pass through verbatim
    if (src[i] === '"') {
      // Raw string / multi-line string literal (triple quote)
      if (src[i + 1] === '"' && src[i + 2] === '"') {
        let end = src.indexOf('"""', i + 3);
        if (end === -1) end = len;
        else end += 3;
        out += src.slice(i, end);
        i = end;
        continue;
      }
      out += src[i++];
      while (i < len) {
        if (src[i] === "\\") {
          out += src[i++];
          if (i < len) out += src[i++];
          continue;
        }
        if (src[i] === '"') {
          out += src[i++];
          break;
        }
        out += src[i++];
      }
      continue;
    }
    // Line comment
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < len && src[i] !== "\n") i++;
      continue;
    }
    // Block comment
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < len) {
        if (src[i] === "*" && src[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }
    out += src[i++];
  }
  return out;
}

/**
 * Extract all `@Composable fun Foo(...)` definitions from a single file.
 *
 * Skips private preview functions (@Preview @Composable private fun ...).
 * Returns an array of component definitions.
 */
function extractComposableDefs(content, filePath, relativePath) {
  const defs = [];

  // Find all @Composable annotations followed by a function declaration.
  // The pattern handles optional modifiers between @Composable and fun,
  // and optional visibility modifiers before @Composable.
  //
  // We look for @Composable then scan forward for the `fun` keyword.
  const composablePattern = /@Composable\b/g;
  let match;

  while ((match = composablePattern.exec(content)) !== null) {
    const afterAnnotation = content.slice(match.index + match[0].length);

    // Check if this is a @Preview function — skip those
    const beforeAnnotation = content.slice(
      Math.max(0, match.index - 200),
      match.index,
    );
    if (/@Preview\b/.test(beforeAnnotation.split("\n").pop())) continue;
    // Also check for @Preview on the line above
    const recentLines = beforeAnnotation.trim().split("\n");
    if (
      recentLines.length > 0 &&
      /@Preview/.test(recentLines[recentLines.length - 1])
    ) {
      continue;
    }

    // Find `fun` within the next ~100 chars (allowing for modifiers like
    // `internal`, `private`, `public`, or nothing)
    const funMatch = afterAnnotation.match(
      /^\s*(?:(?:private|internal|public|protected|open|override)\s+)*fun\s+(\w+)\s*\(/,
    );
    if (!funMatch) continue;

    const name = funMatch[1];

    // Skip private composables — they're internal helpers, not public components
    if (/\bprivate\b/.test(funMatch[0])) continue;

    // Extract the parameter list from the opening paren
    const funStart =
      match.index + match[0].length + afterAnnotation.indexOf(funMatch[0]);
    const parenPos = content.indexOf("(", funStart);
    if (parenPos === -1) continue;

    const signature = extractKotlinSignature(content, parenPos);
    const previews = extractKotlinPreviewNames(content, name);

    defs.push({
      name,
      filePath,
      relativePath,
      signature,
      previews,
      platform: "android",
    });
  }

  return defs;
}

/**
 * Extract function parameters from the opening paren of a Kotlin function.
 *
 * Parses parameter lists like:
 *   (modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(0.dp), rowItem: Item)
 *
 * Returns an array of { name, type, annotation, defaultValue, isBinding, isObserved }.
 * `isBinding` and `isObserved` are always false for Kotlin (kept for compatibility
 * with the Swift component shape).
 */
function extractKotlinSignature(content, openParenPos) {
  const block = extractParenBlock(content, openParenPos);
  if (!block || !block.content.trim()) return [];

  const params = [];
  const parts = splitTopLevelCommas(block.content);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Match: [vararg] name: Type [= default]
    // Kotlin params may have annotations like @StringRes, or vararg
    const paramMatch = trimmed.match(
      /^(?:(?:vararg|crossinline|noinline)\s+)?(\w+)\s*:\s*(.+?)(?:\s*=\s*(.+))?$/s,
    );
    if (!paramMatch) continue;

    const paramName = paramMatch[1];
    let paramType = paramMatch[2].trim();
    let defaultValue = paramMatch[3] ? paramMatch[3].trim() : null;

    // Clean up type — remove trailing commas
    paramType = paramType.replace(/,\s*$/, "").trim();

    // Clean up default — remove trailing commas
    if (defaultValue) {
      defaultValue = defaultValue.replace(/,\s*$/, "").trim();
    }

    params.push({
      name: paramName,
      type: paramType,
      annotation: null,
      defaultValue,
      isBinding: false,
      isObserved: false,
    });
  }

  return params;
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
    i++;
  }

  if (depth !== 0) return null;

  return {
    content: source.slice(openPos + 1, i - 1),
    start: openPos,
    end: i,
  };
}

/**
 * Split a string on top-level commas, respecting nested (), {}, [], and strings.
 */
function splitTopLevelCommas(str) {
  const parts = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let i = 0;

  while (i < str.length) {
    const ch = str[i];

    if (inString) {
      current += ch;
      if (ch === "\\" && i + 1 < str.length) {
        current += str[++i];
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      current += ch;
      i++;
      continue;
    }

    if (ch === "(" || ch === "{" || ch === "[" || ch === "<") {
      depth++;
      current += ch;
      i++;
      continue;
    }

    if (ch === ")" || ch === "}" || ch === "]" || ch === ">") {
      depth--;
      current += ch;
      i++;
      continue;
    }

    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Extract @Preview function names associated with components in this file.
 */
function extractKotlinPreviewNames(content, componentName) {
  const previews = [];

  // Match @Preview with optional name parameter followed by @Composable fun
  const pattern = /@Preview\b(?:\s*\([^)]*\))?\s*@Composable\s+(?:(?:private|internal)\s+)?fun\s+(\w+)/g;
  let m;

  while ((m = pattern.exec(content)) !== null) {
    const previewName = m[1];
    // Also check for a name parameter: @Preview(name = "Foo")
    const annotationStr = m[0];
    const nameParam = annotationStr.match(/name\s*=\s*"([^"]+)"/);
    if (nameParam) {
      previews.push(nameParam[1]);
    } else {
      // Use the function name, cleaned up:
      // NHSCardPreview → NHSCard → NHS Card
      const stripped = previewName.replace(/Preview$/, "");
      const label = stripped
        .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase boundary
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // acronym boundary
        .trim();
      previews.push(label || "Default");
    }
  }

  if (previews.length === 0 && content.includes("@Preview")) {
    previews.push("Default");
  }

  return previews;
}

/**
 * Merge overloaded @Composable functions (same name, different signatures)
 * into a single component entry. The first overload's signature is primary;
 * additional signatures are noted as overloads.
 */
function mergeOverloads(components) {
  const byName = new Map();

  for (const comp of components) {
    if (byName.has(comp.name)) {
      const existing = byName.get(comp.name);
      existing.overloads = (existing.overloads || 1) + 1;
      // Merge previews
      const existingPreviews = new Set(existing.previews);
      for (const p of comp.previews) {
        if (!existingPreviews.has(p)) existing.previews.push(p);
      }
    } else {
      byName.set(comp.name, { ...comp, overloads: 1 });
    }
  }

  return [...byName.values()];
}

/**
 * Detect the primary @Composable function in a Kotlin file.
 * Used by the usage scanner to identify which "screen" a usage is in.
 */
function detectKotlinEnclosingView(content) {
  // Find the first non-private, non-preview @Composable fun
  const pattern =
    /@Composable\s+(?!private\b)fun\s+(\w+)/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const name = match[1];
    // Skip preview functions
    const before = content.slice(Math.max(0, match.index - 100), match.index);
    if (/@Preview/.test(before)) continue;
    return name;
  }

  return null;
}

/**
 * Check whether a position in Kotlin source is inside a @Preview function body.
 */
function isInsideKotlinPreview(content, pos) {
  // Search backwards from pos for the nearest @Preview
  const before = content.slice(0, pos);
  const lastPreview = before.lastIndexOf("@Preview");
  if (lastPreview === -1) return false;

  // Check that there's a @Composable fun ... { between @Preview and pos
  const afterPreview = content.slice(lastPreview, pos + 200);
  const funMatch = afterPreview.match(
    /@Preview\b(?:\s*\([^)]*\))?\s*@Composable\s+(?:(?:private|internal)\s+)?fun\s+\w+\s*\([^)]*\)\s*\{/,
  );
  if (!funMatch) return false;

  // Find the opening brace of this preview function
  const braceOffset = lastPreview + funMatch.index + funMatch[0].length - 1;
  if (braceOffset >= content.length || content[braceOffset] !== "{") return false;

  const block = extractBraceBlock(content, braceOffset);
  if (!block) return false;

  return pos >= block.start && pos < block.end;
}

module.exports = {
  scanKotlinComponents,
  stripKotlinComments,
  detectKotlinEnclosingView,
  isInsideKotlinPreview,
};
