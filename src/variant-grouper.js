/**
 * Group component usages into "variants" based on the parameter values
 * passed at each call site.
 *
 * A variant is a distinct combination of non-default parameter values.
 * Usages with identical parameter signatures are grouped together.
 *
 * @param {ComponentDef[]} components - Component definitions with signatures
 * @param {Map<string, Usage[]>} usageMap - Component name → usages
 * @returns {Map<string, VariantGroup[]>} - Component name → variant groups
 */
function groupVariants(components, usageMap) {
  const variantMap = new Map();

  for (const comp of components) {
    const usages = usageMap.get(comp.name) || [];
    const groups = groupUsagesByArgs(usages, comp);
    variantMap.set(comp.name, groups);
  }

  return variantMap;
}

/**
 * Group a component's usages by their parsed argument signatures.
 *
 * @param {Usage[]} usages - All usages of this component
 * @param {ComponentDef} component - The component definition
 * @returns {VariantGroup[]}
 */
function groupUsagesByArgs(usages, component) {
  if (usages.length === 0) return [];

  const groups = new Map(); // signature string → { signature, usages }

  for (const usage of usages) {
    const parsed = parseArgs(usage.rawArgs, component.signature);
    const sigKey = signatureKey(parsed);

    if (!groups.has(sigKey)) {
      groups.set(sigKey, {
        signature: parsed,
        signatureKey: sigKey,
        usages: [],
      });
    }
    groups.get(sigKey).usages.push(usage);
  }

  // Sort groups by usage count (most common first)
  const sorted = [...groups.values()].sort(
    (a, b) => b.usages.length - a.usages.length,
  );

  // Label each variant
  return sorted.map((group, i) => ({
    ...group,
    label: generateVariantLabel(group.signature, i, sorted.length),
    count: group.usages.length,
  }));
}

/**
 * Parse raw argument text into a structured representation.
 *
 * Extracts named parameters from call sites like:
 *   `borderColor: .nhsAppPaleBlue, backgroundColor: Color.nhsAppPaleBlue`
 *
 * Returns an array of { name, value } pairs for recognised named arguments,
 * plus a "rest" entry for anything unparseable.
 */
function parseArgs(rawArgs, signature) {
  if (!rawArgs) return [{ name: "_style", value: "default" }];
  if (rawArgs === "{ ... }") return [{ name: "_style", value: "trailing closure only" }];

  const params = [];
  const sigNames = new Set((signature || []).map((s) => s.name));

  // Split on top-level commas (respecting nested parens/braces/strings)
  const parts = splitTopLevel(rawArgs);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === "{ ... }") continue;

    // Named argument: `name: value`
    const namedMatch = trimmed.match(/^(\w+)\s*:\s*(.+)$/s);
    if (namedMatch) {
      const paramName = namedMatch[1];
      let paramValue = namedMatch[2].trim();
      // Normalise whitespace in values
      paramValue = paramValue.replace(/\s+/g, " ");
      // Truncate very long values
      if (paramValue.length > 80) {
        paramValue = paramValue.slice(0, 77) + "...";
      }
      params.push({ name: paramName, value: paramValue });
      continue;
    }

    // Positional argument — use index as name
    let value = trimmed.replace(/\s+/g, " ");
    if (value.length > 80) value = value.slice(0, 77) + "...";
    params.push({ name: `_arg${params.length}`, value });
  }

  if (params.length === 0) {
    return [{ name: "_style", value: "default" }];
  }

  return params;
}

/**
 * Split a string on top-level commas, respecting nested (), {}, [], and strings.
 */
function splitTopLevel(str) {
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

    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      current += ch;
      i++;
      continue;
    }

    if (ch === ")" || ch === "}" || ch === "]") {
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
 * Create a stable string key from a parsed argument list.
 */
function signatureKey(parsed) {
  return parsed
    .map((p) => `${p.name}=${p.value}`)
    .sort()
    .join("|");
}

/**
 * Generate a human-readable label for a variant group.
 */
function generateVariantLabel(parsed, index, totalGroups) {
  if (totalGroups === 1) return "default";

  // If all params are default/trailing-closure-only, call it "default"
  const isDefault = parsed.every(
    (p) =>
      p.value === "default" ||
      p.value === "trailing closure only" ||
      p.name.startsWith("_arg"),
  );
  if (isDefault) return "default";

  // If we have meaningful named params, use them
  const meaningful = parsed.filter(
    (p) =>
      !p.name.startsWith("_") &&
      p.value !== "default" &&
      p.value !== "trailing closure only",
  );

  if (meaningful.length > 0) {
    // Use the first 2–3 non-default params as the label, showing name: value
    const parts = meaningful.slice(0, 3).map((p) => {
      let val = p.value;
      // Shorten enum-like values: .nhsAppPaleBlue → nhsAppPaleBlue
      if (val.startsWith(".")) val = val.slice(1);
      // Shorten Color.foo → foo
      val = val.replace(/^Color\./, "");
      // Truncate long values
      if (val.length > 30) val = val.slice(0, 27) + "...";
      return `${p.name}: ${val}`;
    });
    return parts.join(", ");
  }

  return `variant ${index + 1}`;
}

module.exports = { groupVariants };
