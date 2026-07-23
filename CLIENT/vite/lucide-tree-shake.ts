import type { Plugin } from "vite";

/**
 * lucide-tree-shake
 * -----------------
 * lucide-react@1.x ships a single barrel entry (dist/esm/lucide-react.mjs) with
 * an empty `exports` map. Under Vite 8 / Rolldown that barrel does NOT
 * tree-shake, so `import { Menu } from "lucide-react"` drags the ENTIRE icon set
 * (~630KB raw / ~156KB gzipped) into the bundle even though the app uses ~45
 * icons.
 *
 * This plugin rewrites named lucide-react imports to their per-icon deep paths
 * BEFORE bundling, so only the icons actually used are pulled in:
 *
 *   import { Menu, Bell } from "lucide-react";
 *     ->
 *   import Menu from "lucide-react/dist/esm/icons/menu.mjs";
 *   import Bell from "lucide-react/dist/esm/icons/bell.mjs";
 *
 * Notes:
 *  - Only transforms the *named-import-only* form (which is how every icon is
 *    imported in this codebase). Namespace/default/aliased imports are left
 *    untouched so nothing unexpected breaks; if one ever appears the build
 *    still works (just without the shrink for that line).
 *  - Icon file names are the PascalCase import converted to kebab-case, which
 *    was verified to resolve for every icon this app imports.
 */

const ICON_DIR = "lucide-react/dist/esm/icons";

function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

export function lucideTreeShake(): Plugin {
  // Matches: import { A, B as C, D } from "lucide-react";  (single statement)
  const importRe =
    /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["'];?/g;

  return {
    name: "lucide-tree-shake",
    enforce: "pre",
    transform(code, id) {
      const normId = id.replace(/\\/g, "/");
      if (!normId.includes("/src/")) return null;
      if (!/\.[jt]sx?($|\?)/.test(normId)) return null;
      if (!code.includes("lucide-react")) return null;

      let changed = false;
      const out = code.replace(importRe, (_match, group: string) => {
        const specifiers = group
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        const lines: string[] = [];
        for (const spec of specifiers) {
          // Support "Icon" and "Icon as Alias"
          const asMatch = spec.match(/^([A-Za-z0-9_]+)\s+as\s+([A-Za-z0-9_]+)$/);
          const original = asMatch ? asMatch[1] : spec;
          const local = asMatch ? asMatch[2] : spec;
          if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(original)) {
            // Bail out on anything unexpected — keep original import intact.
            return _match;
          }
          lines.push(
            `import ${local} from "${ICON_DIR}/${toKebab(original)}.mjs";`
          );
        }
        changed = true;
        return lines.join("\n");
      });

      return changed ? { code: out, map: null } : null;
    },
  };
}
