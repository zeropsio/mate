import { defineRule, type ESTree } from "@oxlint/plugins";
import { formatFindingMessage, loadExceptionLedger, shouldReportLedgered } from "../exceptions.ts";

const RULE_NAME = "reduced-motion-home";
const ledger = loadExceptionLedger(RULE_NAME);
const QUERY = /^\(\s*prefers-reduced-motion\s*:\s*(?:reduce|no-preference)\s*\)$/u;
const SUMMARY =
  "Whether the person asked for less motion is read from ~/lib/reducedMotion (prefersReducedMotion, onReducedMotionChange, useReducedMotion)";

export default defineRule({
  meta: { type: "problem", docs: { description: SUMMARY } },
  create(context) {
    const path = `/${context.filename.replaceAll("\\", "/")}`;
    if (
      !path.includes("/apps/web/src/") ||
      path.endsWith("/apps/web/src/lib/reducedMotion.ts") ||
      /\.test\.[^/]*$/u.test(path)
    )
      return {};

    function check(node: ESTree.Node, text: string) {
      const fingerprint = text.trim();
      if (!QUERY.test(fingerprint)) return;
      const kind = node.type;
      const ledgered = ledger.has({ path, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;
      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary: SUMMARY,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0) check(node, node.quasis[0]?.value.cooked ?? "");
      },
    };
  },
});
