import { defineRule, type ESTree } from "@oxlint/plugins";

const SCANNED_ROOTS = [
  "apps/server/src",
  "packages/contracts/src",
  "packages/shared/src",
  "packages/client-runtime/src",
];
// The vocabulary table spells the old name in order to ban it (design-system R4).
const VOCABULARY_TABLE = "packages/shared/src/legacyVocabulary.ts";
const OLD_NAME = /\bT3 Code\b/u;

export default defineRule({
  meta: {
    type: "problem",
    docs: { description: "Use the current product name in server and shared-package literals." },
  },
  create(context) {
    const filename = `/${context.filename.replaceAll("\\", "/")}`;
    if (!/\.tsx?$/u.test(filename) || /\.test\.tsx?$/u.test(filename)) return {};
    const root = SCANNED_ROOTS.find((root) => filename.includes(`/${root}/`));
    if (!root) return {};
    const file = filename.slice(filename.lastIndexOf(`/${root}/`) + 1);
    if (file === VOCABULARY_TABLE) return {};

    function check(node: ESTree.Node, text: string) {
      if (OLD_NAME.test(text)) {
        context.report({
          node,
          message: `${file}: Replace "T3 Code" with the current product name.`,
        });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      JSXText: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.cooked ?? node.value.raw),
    };
  },
});
