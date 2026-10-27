import type { Context, ESTree, Variable } from "@oxlint/plugins";
import * as Option from "effect/Option";

type ExpressionWrapper =
  | ESTree.ChainExpression
  | ESTree.ParenthesizedExpression
  | ESTree.TSNonNullExpression
  | ESTree.TSAsExpression
  | ESTree.TSTypeAssertion;

type AstNode = ESTree.Node;

const CN_CLASS_BUILDERS = new Set(["cn"]);
const CLASS_BUILDERS_BY_PACKAGE = new Map<string, ReadonlySet<string>>([
  ["clsx", new Set(["clsx"])],
  ["class-variance-authority", new Set(["cva"])],
  ["tailwind-merge", new Set(["twMerge"])],
  ["tailwind-variants", new Set(["tv"])],
]);

const asAstNode = (node: unknown): Option.Option<AstNode> =>
  typeof node === "object" && node !== null && "type" in node && typeof node.type === "string"
    ? Option.some(node as AstNode)
    : Option.none();

const isExpressionWrapper = (node: AstNode): node is ExpressionWrapper =>
  node.type === "ChainExpression" ||
  node.type === "ParenthesizedExpression" ||
  node.type === "TSNonNullExpression" ||
  node.type === "TSAsExpression" ||
  node.type === "TSTypeAssertion";

export function unwrapExpression(node: unknown): Option.Option<AstNode> {
  let current = asAstNode(node);

  while (Option.isSome(current) && isExpressionWrapper(current.value)) {
    current = asAstNode(current.value.expression);
  }

  return current;
}

export function getPropertyName(node: unknown): Option.Option<string> {
  return Option.flatMap(asAstNode(node), (expression) => {
    if (expression.type === "Identifier" && typeof expression.name === "string") {
      return Option.some(expression.name);
    }
    if (expression.type === "PrivateIdentifier" && typeof expression.name === "string") {
      return Option.some(expression.name);
    }
    if (expression.type === "Literal" && typeof expression.value === "string") {
      return Option.some(expression.value);
    }
    return Option.none();
  });
}

export function isIdentifier(node: Option.Option<AstNode>, name?: string): boolean {
  if (Option.isNone(node)) return false;
  const expression = node.value;
  return (
    expression.type === "Identifier" &&
    typeof expression.name === "string" &&
    (name === undefined || expression.name === name)
  );
}

export const resolveVariable = (context: Context, node: unknown): Variable | undefined => {
  const identifier = unwrapExpression(node);
  if (
    Option.isNone(identifier) ||
    (identifier.value.type !== "Identifier" && identifier.value.type !== "JSXIdentifier")
  ) {
    return undefined;
  }

  let scope = context.sourceCode.getScope(identifier.value);
  while (true) {
    const variable = scope.set.get(identifier.value.name);
    if (variable !== undefined || scope.upper === null) return variable;
    scope = scope.upper;
  }
};

const classBuilderNamesForModule = (source: string): ReadonlySet<string> | undefined => {
  const normalizedSource = source.replace(/\.[cm]?[jt]sx?$/u, "");
  if (normalizedSource.endsWith("/lib/utils") || normalizedSource.endsWith("/lib/cn")) {
    return CN_CLASS_BUILDERS;
  }
  return CLASS_BUILDERS_BY_PACKAGE.get(source);
};

const registerClassBuilderImportBindings = (
  context: Context,
  node: ESTree.ImportDeclaration,
  bindings: Set<Variable>,
): void => {
  if (typeof node.source.value !== "string") return;
  const expectedNames = classBuilderNamesForModule(node.source.value);
  if (expectedNames === undefined) return;

  const declaredVariables = context.sourceCode.getDeclaredVariables(node);
  for (const specifier of node.specifiers) {
    if (
      node.importKind === "type" ||
      (specifier.type === "ImportSpecifier" && specifier.importKind === "type") ||
      specifier.type === "ImportNamespaceSpecifier"
    ) {
      continue;
    }

    const importedName =
      specifier.type === "ImportSpecifier"
        ? getPropertyName(specifier.imported)
        : specifier.type === "ImportDefaultSpecifier" && node.source.value === "clsx"
          ? Option.some("clsx")
          : getPropertyName(specifier.local);
    if (Option.isNone(importedName) || !expectedNames.has(importedName.value)) continue;

    const variable = declaredVariables.find((candidate) => candidate.name === specifier.local.name);
    if (variable !== undefined) bindings.add(variable);
  }
};

export const classAttributeName = (node: ESTree.Node): string | undefined => {
  if (node.type !== "JSXAttribute" || node.name.type !== "JSXIdentifier") return undefined;
  return node.name.name;
};

/** Creates a per-file matcher for JSX class syntax and canonical imported class builders. */
export const createClassLikeMatcher = (context: Context): ((node: ESTree.Node) => boolean) => {
  let classBuilderBindings: ReadonlySet<Variable> | undefined;

  const bindings = (): ReadonlySet<Variable> => {
    if (classBuilderBindings !== undefined) return classBuilderBindings;

    const resolved = new Set<Variable>();
    for (const statement of context.sourceCode.ast.body) {
      if (statement.type === "ImportDeclaration") {
        registerClassBuilderImportBindings(context, statement, resolved);
      }
    }
    classBuilderBindings = resolved;
    return resolved;
  };

  return (node) => {
    let current: ESTree.Node | null = node.parent;
    while (current !== null) {
      const attributeName = classAttributeName(current);
      if (attributeName === "className" || attributeName === "class") return true;

      if (
        current.type === "CallExpression" &&
        current.arguments.some(
          (argument) => node.start >= argument.start && node.end <= argument.end,
        )
      ) {
        const variable = resolveVariable(context, current.callee);
        if (variable !== undefined && bindings().has(variable)) return true;
      }
      current = current.parent;
    }
    return false;
  };
};
