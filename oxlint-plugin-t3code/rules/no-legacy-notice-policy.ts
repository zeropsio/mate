import { defineRule, type ESTree } from "@oxlint/plugins";
import { formatFindingMessage, loadExceptionLedger, shouldReportLedgered } from "../exceptions.ts";
import { resolveVariable } from "../utils.ts";

const RULE = "no-legacy-notice-policy";
const ledger = loadExceptionLedger(RULE);
const retired = new Set(["zeropsAgentSignInRequired", "spentLoginStatusStale"]);
/** Only the existing arrival consumers keep their any-agent question in this slice. */
function isArrivalCall(path: string, node: ESTree.CallExpression): boolean {
  let child: ESTree.Node = node;
  let parent: ESTree.Node | null = node.parent;
  while (parent !== null) {
    if (
      path === "components/ChatView.tsx" &&
      parent.type === "Property" &&
      parent.key.type === "Identifier" &&
      parent.key.name === "signInRequired" &&
      parent.parent.type === "ObjectExpression" &&
      parent.parent.parent.type === "CallExpression" &&
      parent.parent.parent.callee.type === "Identifier" &&
      parent.parent.parent.callee.name === "mateArrivalHoldsComposer"
    )
      return true;
    if (
      path === "components/zerops/ZeropsMateEmptyState.tsx" &&
      parent.type === "VariableDeclarator" &&
      parent.id.type === "Identifier" &&
      parent.id.name === "signInRequired"
    )
      return true;
    if (
      path === "components/zerops/crew/CrewPanel.tsx" &&
      parent.type === "IfStatement" &&
      parent.test === child &&
      parent.consequent.type === "BlockStatement" &&
      parent.consequent.body.some(
        (statement) =>
          statement.type === "ReturnStatement" &&
          statement.argument?.type === "JSXElement" &&
          statement.argument.openingElement.name.type === "JSXIdentifier" &&
          (statement.argument.openingElement.name.name === "ZeropsMateEmptyState" ||
            (statement.argument.openingElement.name.name === "div" &&
              statement.argument.children.some(
                (element) =>
                  element.type === "JSXElement" &&
                  element.openingElement.name.type === "JSXIdentifier" &&
                  element.openingElement.name.name === "ZeropsMateEmptyState",
              ))),
      )
    )
      return true;
    child = parent;
    parent = parent.parent;
  }
  return false;
}

/** Slice 1 only: freeze the two replaced hosted admission policies, including local aliases. */
export default defineRule({
  meta: {
    type: "problem",
    docs: { description: "Hosted admission is derived by the admission projection." },
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    const match =
      /(?:^|\/)((?:apps\/(?:web|desktop)|packages\/(?:client-runtime|shared))\/src\/(.*))$/u.exec(
        filename,
      );
    if (match === null || /\.(test|spec)\./u.test(match[1]!)) return {};
    const repoPath = match[1]!;
    const path = repoPath.startsWith("apps/web/src/") ? match[2]! : repoPath;
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
          (name === "zeropsAgentSignInRequired" && isArrivalCall(path, node))
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
