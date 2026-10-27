import { defineRule, type ESTree } from "@oxlint/plugins";
import { resolveVariable } from "../utils.ts";

/** Migrated recovery owns durable outcome presentation; aliases cannot restore its old toast. */
export default defineRule({
  meta: {
    type: "problem",
    docs: { description: "Recovery results stay with their account operation." },
  },
  create(context) {
    const path = context.filename.replaceAll("\\", "/");
    if (!/apps\/web\/src\/zerops\/(useMateRecoveryAction|recoveryOutcomes)\.tsx?$/u.test(path))
      return {};
    const nameOf = (node: ESTree.Node, seen = new Set<ESTree.Node>()): string | undefined => {
      if (seen.has(node)) return undefined;
      seen.add(node);
      if (node.type === "Identifier") {
        const definition = resolveVariable(context, node)?.defs[0]?.node;
        if (
          definition?.type === "ImportSpecifier" &&
          definition.parent.type === "ImportDeclaration" &&
          /(?:^|\/)ui\/toast(?:\.tsx)?$/u.test(String(definition.parent.source.value))
        ) {
          return definition.imported.type === "Identifier"
            ? definition.imported.name
            : String(definition.imported.value);
        }
        if (
          definition?.type === "ImportNamespaceSpecifier" &&
          definition.parent.type === "ImportDeclaration" &&
          /(?:^|\/)ui\/toast(?:\.tsx)?$/u.test(String(definition.parent.source.value))
        )
          return "toast";
        if (definition?.type === "VariableDeclarator" && definition.init) {
          const base = nameOf(definition.init, seen);
          if (definition.id.type === "ObjectPattern") {
            const property = definition.id.properties.find(
              (entry) =>
                entry.type === "Property" &&
                entry.value.type === "Identifier" &&
                entry.value.name === node.name,
            );
            if (property?.type === "Property" && property.key.type === "Identifier")
              return `${base}.${property.key.name}`;
          }
          return base;
        }
      }
      if (node.type === "MemberExpression") {
        const property =
          node.property.type === "Identifier" && !node.computed
            ? node.property.name
            : node.property.type === "Literal"
              ? String(node.property.value)
              : undefined;
        return `${nameOf(node.object, seen)}.${property}`;
      }
      return undefined;
    };
    const forbidden = (node: ESTree.Node) =>
      ["toastManager.add", "toast.toastManager.add"].includes(nameOf(node) ?? "");
    const report = (node: ESTree.Node) =>
      context.report({
        node,
        message:
          "Recovery results must read their retained operation; toastManager.add loses the originating request (E8).",
      });
    return {
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || node.init === null) return;
        if (!["toastManager", "toast.toastManager"].includes(nameOf(node.init) ?? "")) return;
        for (const property of node.id.properties)
          if (
            property.type === "Property" &&
            property.key.type === "Identifier" &&
            property.key.name === "add"
          )
            report(property);
      },
      CallExpression(node) {
        if (forbidden(node.callee)) report(node);
      },
      MemberExpression(node) {
        if (node.parent.type === "CallExpression" && node.parent.callee === node) return;
        if (forbidden(node)) report(node);
      },
    };
  },
});
