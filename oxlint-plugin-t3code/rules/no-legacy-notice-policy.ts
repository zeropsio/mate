import { defineRule, type ESTree } from "@oxlint/plugins";
import { formatFindingMessage, loadExceptionLedger, shouldReportLedgered } from "../exceptions.ts";
import { resolveVariable } from "../utils.ts";

const RULE = "no-legacy-notice-policy";
const ledger = loadExceptionLedger(RULE);
const retired = new Set(["zeropsAgentSignInRequired", "spentLoginStatusStale"]);

/** Slice 1 only: freeze the two replaced hosted admission policies, including local aliases. */
export default defineRule({
  meta: {
    type: "problem",
    docs: { description: "Hosted admission is derived by the admission projection." },
  },
  create(context) {
    const path = context.filename.replaceAll("\\", "/").split("/apps/web/src/")[1];
    if (path === undefined || /\.(test|spec)\./u.test(path)) return {};
    const repoPath = `apps/web/src/${path}`;
    const nameOf = (node: ESTree.Node, seen = new Set<ESTree.Node>()): string | undefined => {
      if (seen.has(node)) return undefined;
      seen.add(node);
      if (node.type === "Identifier") {
        const def = resolveVariable(context, node)?.defs[0]?.node;
        if (def?.type === "ImportSpecifier") {
          const name =
            def.imported.type === "Identifier" ? def.imported.name : String(def.imported.value);
          return retired.has(name) ? name : undefined;
        }
        if (def?.type === "VariableDeclarator" && def.init) {
          if (def.id.type === "ObjectPattern") {
            const property = def.id.properties.find(
              (p) =>
                p.type === "Property" &&
                p.value.type === "Identifier" &&
                p.value.name === node.name,
            );
            if (
              property?.type === "Property" &&
              property.key.type === "Identifier" &&
              retired.has(property.key.name)
            )
              return property.key.name;
          }
          return nameOf(def.init, seen);
        }
      }
      if (
        node.type === "MemberExpression" &&
        node.property.type === "Identifier" &&
        retired.has(node.property.name)
      )
        return node.property.name;
      return undefined;
    };
    return {
      CallExpression(node) {
        const name = nameOf(node.callee);
        if (
          name === undefined ||
          (name === "zeropsAgentSignInRequired" && path !== "zerops/chatChrome.ts")
        )
          return;
        const entry = { path: repoPath, kind: "CallExpression", fingerprint: name };
        const ledgered = ledger.entries.some(
          (e) => e.path === entry.path && e.kind === entry.kind && e.fingerprint === name,
        );
        if (ledgered && !shouldReportLedgered()) return;
        context.report({
          node,
          message: formatFindingMessage({
            ruleName: RULE,
            kind: entry.kind,
            fingerprint: name,
            ledgered,
            summary: "Read scoped admission instead of deriving another sign-in policy.",
          }),
        });
      },
    };
  },
});
