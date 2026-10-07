import type { Context, ESTree } from "@oxlint/plugins";

/** Walk syntax, never scope/parent links. Used only for the reviewed guard boundaries. */
export function* syntaxNodes(value: unknown): Generator<ESTree.Node> {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const child of value) yield* syntaxNodes(child);
    return;
  }
  if (!("type" in value) || typeof value.type !== "string") return;
  const node = value as ESTree.Node;
  yield node;
  for (const [key, child] of Object.entries(node)) {
    if (key !== "parent") yield* syntaxNodes(child);
  }
}

export const compactSyntax = (context: Context, node: ESTree.Node): string => {
  let text = "";
  let cursor = node.start;
  for (const comment of context.sourceCode.getAllComments()) {
    if (comment.start < cursor || comment.end > node.end) continue;
    text += context.sourceCode.text.slice(cursor, comment.start);
    cursor = comment.end;
  }
  return (text + context.sourceCode.text.slice(cursor, node.end)).replace(/\s+/gu, "");
};

export const functionNamed = (program: ESTree.Node, name: string): ESTree.Node | undefined => {
  for (const node of syntaxNodes(program)) {
    if (node.type === "FunctionDeclaration" && node.id?.name === name) return node;
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.id.name === name
    ) {
      return node.init ?? undefined;
    }
  }
  return undefined;
};

export const enclosingFunction = (node: ESTree.Node): ESTree.Node | undefined => {
  for (let current = node.parent; current !== null; current = current.parent) {
    if (
      ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(
        current.type,
      )
    ) {
      return current;
    }
  }
  return undefined;
};
