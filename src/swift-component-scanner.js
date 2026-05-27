const fs = require("fs");
const path = require("path");
const { globSync } = require("glob");

/**
 * Scan a SwiftUI project for component definitions.
 *
 * Components are `struct Foo: View` declarations in files matching the
 * components directory glob. For each component we extract:
 *   - name (the struct name)
 *   - filePath / relativePath
 *   - signature (stored properties that form the public API)
 *   - preview variants (named #Preview blocks)
 *
 * @param {string} projectPath - Root of the iOS prototype
 * @param {string|null} componentsDirOverride - Glob override for component paths
 * @returns {{ components: ComponentDef[], allSwiftFiles: string[] }}
 */
function scanSwiftComponents(projectPath, componentsDirOverride) {
  // Find all Swift files in the project (excluding build artefacts)
  const allSwiftFiles = globSync("**/*.swift", {
    cwd: projectPath,
    absolute: true,
    ignore: [
      "**/DerivedData/**",
      "**/.build/**",
      "**/build/**",
      "**/Pods/**",
      "**/*.generated.swift",
      "**/*Tests/**",
      "**/*UITests/**",
    ],
  });

  // Determine which files are "component" files
  const componentsGlob =
    componentsDirOverride || "**/Components/**/*.swift";
  const componentFiles = new Set(
    globSync(componentsGlob, {
      cwd: projectPath,
      absolute: true,
      ignore: [
        "**/DerivedData/**",
        "**/.build/**",
        "**/build/**",
        "**/Pods/**",
        "**/*Tests/**",
        "**/*UITests/**",
      ],
    }),
  );

  const components = [];

  for (const filePath of allSwiftFiles) {
    if (!componentFiles.has(filePath)) continue;

    const content = fs.readFileSync(filePath, "utf-8");
    const stripped = stripSwiftComments(content);
    const relativePath = path.relative(projectPath, filePath);

    const defs = extractComponentDefs(stripped, filePath, relativePath);
    components.push(...defs);
  }

  return { components, allSwiftFiles };
}

/**
 * Strip Swift line and block comments, preserving string literals.
 * Handles nested block comments (Swift allows them).
 */
function stripSwiftComments(src) {
  let out = "";
  let i = 0;
  const len = src.length;

  while (i < len) {
    // String literal — pass through verbatim
    if (src[i] === '"') {
      // Multi-line string literal (triple quote)
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
    // Block comment (Swift allows nesting)
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      let depth = 1;
      while (i < len && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }
    out += src[i++];
  }
  return out;
}

/**
 * Extract all `struct Foo: View` definitions from a single file.
 * Returns an array of component definitions.
 */
function extractComponentDefs(content, filePath, relativePath) {
  const defs = [];

  // Match struct declarations that conform to View
  // Handles: `struct Foo: View`, `struct Foo: some View`,
  //          `struct Foo<T>: View`, `struct Foo: View, Equatable`
  const structPattern =
    /\bstruct\s+(\w+)(?:<[^>]*>)?\s*:\s*(?:[^{]*?\b)?View\b/g;
  let match;

  while ((match = structPattern.exec(content)) !== null) {
    const name = match[1];
    const structStart = match.index;

    // Find the struct body
    const body = extractBraceBlock(content, content.indexOf("{", structStart));
    if (!body) continue;

    const signature = extractSignature(body.content, name);
    const previews = extractPreviewNames(content, name);

    defs.push({
      name,
      filePath,
      relativePath,
      signature,
      previews,
      platform: "ios",
    });
  }

  return defs;
}

/**
 * Extract stored properties from a struct body that form the component's
 * public API. Filters out @State, @StateObject, @Environment, and private
 * properties — these are internal state, not part of the component's interface.
 */
function extractSignature(structBody, structName) {
  const properties = [];

  // Match property declarations: let/var name: Type (with optional = default)
  // Also handles @Binding var name: Type, @ObservedObject var name: Type
  const lines = structBody.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines, computed properties (with { get/set }), and functions
    if (!trimmed) continue;
    if (/^\bfunc\b/.test(trimmed)) continue;
    if (/^\bvar\b.*\{\s*$/.test(trimmed)) continue; // computed property opener

    // Skip internal state annotations
    if (/@State\b/.test(trimmed) && !/@StateObject/.test(trimmed)) continue;
    if (/@StateObject\b/.test(trimmed)) continue;
    if (/@Environment\b/.test(trimmed)) continue;
    if (/@EnvironmentObject\b/.test(trimmed)) continue;
    if (/@FocusState\b/.test(trimmed)) continue;
    if (/@FetchRequest\b/.test(trimmed)) continue;
    if (/@AppStorage\b/.test(trimmed)) continue;
    if (/@SceneStorage\b/.test(trimmed)) continue;

    // Skip private/fileprivate
    if (/\bprivate\b/.test(trimmed) || /\bfileprivate\b/.test(trimmed))
      continue;

    // Match: [attributes] let/var name: Type [= default]
    const propMatch = trimmed.match(
      /^(?:(@\w+(?:\([^)]*\))?)\s+)?(?:let|var)\s+(\w+)\s*:\s*([^={\n]+?)(?:\s*=\s*(.+?))?$/,
    );
    if (!propMatch) continue;

    const annotation = propMatch[1] || null;
    const propName = propMatch[2];
    let propType = propMatch[3].trim();
    const defaultValue = propMatch[4] ? propMatch[4].trim() : null;

    // Clean up type — remove trailing commas or whitespace
    propType = propType.replace(/,\s*$/, "").trim();

    // Skip the `body` property
    if (propName === "body") continue;

    properties.push({
      name: propName,
      type: propType,
      annotation: annotation || null,
      defaultValue,
      isBinding: annotation === "@Binding",
      isObserved: annotation === "@ObservedObject",
    });
  }

  return properties;
}

/**
 * Extract named #Preview blocks associated with a component.
 */
function extractPreviewNames(content, componentName) {
  const previews = [];

  // Match #Preview("Name") { ... } and @Preview ... func fooPreview
  const previewPattern = /#Preview\s*\(\s*"([^"]+)"\s*\)/g;
  let m;
  while ((m = previewPattern.exec(content)) !== null) {
    previews.push(m[1]);
  }

  // Also match unnamed #Preview or @Preview/@Composable func ...Preview
  if (content.includes("#Preview") && previews.length === 0) {
    previews.push("Default");
  }

  return previews;
}

/**
 * Extract a brace-delimited block starting at the given position.
 * Returns { content, start, end } or null if no block found.
 */
function extractBraceBlock(source, openBracePos) {
  if (openBracePos === -1 || source[openBracePos] !== "{") return null;

  let depth = 1;
  let i = openBracePos + 1;
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
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }

  if (depth !== 0) return null;

  return {
    content: source.slice(openBracePos + 1, i - 1),
    start: openBracePos,
    end: i,
  };
}

module.exports = { scanSwiftComponents, stripSwiftComments, extractBraceBlock };
