// @effect-diagnostics nodeBuiltinImport:off -- Oxlint checks filesystem siblings synchronously.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { defineRule } from "@oxlint/plugins";

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Report TypeScript siblings that the compiler silently drops by basename.",
    },
  },
  create(context) {
    const file = context.filename;
    const extension = NodePath.extname(file);
    if (!EXTENSIONS.includes(extension) || file.endsWith(".d.ts")) return {};

    const stem = file.slice(0, -extension.length);
    return {
      Program(node) {
        for (const other of EXTENSIONS) {
          const sibling = stem + other;
          if (other === extension || sibling.endsWith(".d.ts")) continue;
          if (NodeFS.statSync(sibling, { throwIfNoEntry: false })?.isFile()) {
            context.report({
              node,
              message: `${file} shares its TypeScript basename with ${NodePath.basename(sibling)}. Rename one so the compiler includes both.`,
            });
          }
        }
      },
    };
  },
});
