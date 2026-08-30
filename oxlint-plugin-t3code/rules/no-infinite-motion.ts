import { defineRule, type ESTree, type Variable } from "@oxlint/plugins";
import * as Option from "effect/Option";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { getPropertyName, unwrapExpression } from "../utils.ts";

const RULE_NAME = "no-infinite-motion";
const LEDGER_DIRECTORY_ENV = "T3CODE_INFINITE_MOTION_LEDGER_DIRECTORY";
const WEB_SOURCE_MARKER = "/apps/web/src/";
const MOBILE_SOURCE_MARKER = "/apps/mobile/src/";
const TEST_FILE_PATTERN = /\.(?:spec|test)\.[^/]+$/u;
const INFINITE_TOKEN_PATTERN = /(?:^|[^-_a-z0-9])infinite(?=$|[^-_a-z0-9])/iu;
const ARBITRARY_ANIMATION_PATTERN = /^animate-\[([^\]]+)\]$/iu;
const INFINITE_ANIMATION_CLASSES = new Set([
  "animate-spin",
  "animate-pulse",
  "animate-ping",
  "animate-bounce",
]);
const CLASS_BUILDER_IMPORTS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ["/lib/utils", new Set(["cn"])],
  ["/lib/cn", new Set(["cn"])],
  ["clsx", new Set(["clsx"])],
  ["class-variance-authority", new Set(["cva"])],
  ["tailwind-merge", new Set(["twMerge"])],
  ["tailwind-variants", new Set(["tv"])],
];

// Keep this list identical to zone rule 6 in scripts/z3-zone-architecture.test.ts.
const PROTECTED_ROOTS = new Set([
  "apps/web/src/components/zerops/ZeropsServiceMap.tsx",
  "apps/web/src/components/zerops/ZeropsLifecycleStrip.tsx",
  "apps/web/src/components/zerops/ZeropsToolCard.tsx",
  "apps/web/src/components/zerops/ZeropsQuickActions.tsx",
]);

// ActivityIndicator is not guarded yet because R6 has no mobile protected roots.

const ledgerDirectory = globalThis.process.env[LEDGER_DIRECTORY_ENV];
const ledger = loadExceptionLedger(RULE_NAME, ledgerDirectory);

const sourcePath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  for (const [marker, root] of [
    [WEB_SOURCE_MARKER, "apps/web/src/"],
    [MOBILE_SOURCE_MARKER, "apps/mobile/src/"],
  ] as const) {
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex !== -1) return `${root}${normalized.slice(markerIndex + marker.length)}`;
  }
  return undefined;
};

const importedModuleEndsWith = (source: string, suffix: string): boolean =>
  source.replace(/\.[cm]?[jt]sx?$/u, "").endsWith(suffix);

const containsInfiniteAnimationClass = (value: string): boolean =>
  value.split(/\s+/u).some((token) => {
    const utility = token.split(":").at(-1)?.toLowerCase() ?? "";
    if (INFINITE_ANIMATION_CLASSES.has(utility)) return true;

    const arbitrary = ARBITRARY_ANIMATION_PATTERN.exec(utility);
    return arbitrary?.[1]?.split("_").some((part) => /^infinite$/iu.test(part)) ?? false;
  });

const classAttributeName = (node: ESTree.Node): string | undefined => {
  if (node.type !== "JSXAttribute" || node.name.type !== "JSXIdentifier") return undefined;
  return node.name.name;
};

const staticStringValue = (node: unknown): string | undefined => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression)) return undefined;
  if (expression.value.type === "Literal" && typeof expression.value.value === "string") {
    return expression.value.value;
  }
  if (expression.value.type === "TemplateLiteral" && expression.value.expressions.length === 0) {
    return expression.value.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
  }
  return undefined;
};

/**
 * Guards literal infinite-motion primitives at their semantic use sites. Without type or inter-file
 * data flow, non-literal repeat counts, class values that arrive through props, and string
 * composition such as `className={"animate-" + "spin"}` remain gaps. Supported bindings
 * intentionally exclude default/barrel Spinner imports and local Reanimated re-exports because
 * those forms are outside the component and runtime import contracts.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Reject continuous animation primitives unless an exact reviewed exception covers them.",
    },
  },
  create(context) {
    const path = sourcePath(context.filename);
    if (path === undefined || TEST_FILE_PATTERN.test(path)) return {};

    const reanimatedFunctions = new Set<Variable>();
    const reanimatedNamespaces = new Set<Variable>();
    const reactNativeAnimated = new Set<Variable>();
    const reactNativeStyleSheets = new Set<Variable>();
    const reactNativeNamespaces = new Set<Variable>();
    const spinnerComponents = new Set<Variable>();
    const classBuilders = new Set<Variable>();
    const reportedNodes = new WeakSet<ESTree.Node>();

    const resolveVariable = (node: ESTree.Node, name: string): Variable | undefined => {
      let scope = context.sourceCode.getScope(node);
      while (true) {
        const variable = scope.set.get(name);
        if (variable !== undefined || scope.upper === null) return variable;
        scope = scope.upper;
      }
    };

    const resolvedIdentifierIsIn = (node: unknown, variables: ReadonlySet<Variable>): boolean => {
      const identifier = unwrapExpression(node);
      if (Option.isNone(identifier) || identifier.value.type !== "Identifier") return false;
      const variable = resolveVariable(identifier.value, identifier.value.name);
      return variable !== undefined && variables.has(variable);
    };

    const namespaceMemberIs = (
      node: unknown,
      namespaces: ReadonlySet<Variable>,
      propertyName: string,
    ): boolean => {
      const member = unwrapExpression(node);
      if (Option.isNone(member) || member.value.type !== "MemberExpression") return false;
      return (
        Option.getOrUndefined(getPropertyName(member.value.property)) === propertyName &&
        resolvedIdentifierIsIn(member.value.object, namespaces)
      );
    };

    const memberCallUses = (
      node: ESTree.CallExpression,
      directObjects: ReadonlySet<Variable>,
      namespaceObjectName: string,
      methodName: string,
    ): boolean => {
      const callee = unwrapExpression(node.callee);
      if (Option.isNone(callee) || callee.value.type !== "MemberExpression") return false;
      if (Option.getOrUndefined(getPropertyName(callee.value.property)) !== methodName)
        return false;
      return (
        resolvedIdentifierIsIn(callee.value.object, directObjects) ||
        namespaceMemberIs(callee.value.object, reactNativeNamespaces, namespaceObjectName)
      );
    };

    const isClassBuilderCall = (node: ESTree.CallExpression): boolean =>
      resolvedIdentifierIsIn(node.callee, classBuilders);

    const isClassLike = (node: ESTree.Node): boolean => {
      let current: ESTree.Node | null = node.parent;
      while (current !== null) {
        const attributeName = classAttributeName(current);
        if (attributeName === "className" || attributeName === "class") return true;

        if (
          current.type === "CallExpression" &&
          isClassBuilderCall(current) &&
          current.arguments.some(
            (argument) => node.start >= argument.start && node.end <= argument.end,
          )
        ) {
          return true;
        }
        current = current.parent;
      }
      return false;
    };

    const isInsideJsxStyle = (node: ESTree.Node): boolean => {
      let current: ESTree.Node | null = node.parent;
      while (current !== null) {
        if (classAttributeName(current) === "style") return true;
        current = current.parent;
      }
      return false;
    };

    const isInsideStyleSheetCreate = (node: ESTree.Node): boolean => {
      let current: ESTree.Node | null = node.parent;
      while (current !== null) {
        if (
          current.type === "CallExpression" &&
          memberCallUses(current, reactNativeStyleSheets, "StyleSheet", "create") &&
          current.arguments.some(
            (argument) => node.start >= argument.start && node.end <= argument.end,
          )
        ) {
          return true;
        }
        current = current.parent;
      }
      return false;
    };

    const report = (node: ESTree.Node, summary: string) => {
      if (reportedNodes.has(node)) return;
      reportedNodes.add(node);
      const kind = node.type;
      const fingerprint = normalizeFingerprint(context.sourceCode.text.slice(node.start, node.end));
      const ledgered = ledger.has({ path, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;

      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    };

    const checkClassLiteral = (node: ESTree.Node, value: string) => {
      if (!isClassLike(node) || !containsInfiniteAnimationClass(value)) return;
      report(node, "Use a finite or reviewed stepped animation instead of an infinite utility.");
    };

    const isGlobalInfinity = (node: unknown): boolean => {
      const identifier = unwrapExpression(node);
      if (
        Option.isNone(identifier) ||
        identifier.value.type !== "Identifier" ||
        identifier.value.name !== "Infinity"
      ) {
        return false;
      }
      const variable = resolveVariable(identifier.value, identifier.value.name);
      return (
        variable === undefined || (variable.scope.type === "global" && variable.defs.length === 0)
      );
    };

    const isInfiniteRepeatCount = (argument: unknown): boolean => {
      if (isGlobalInfinity(argument)) return true;
      const expression = unwrapExpression(argument);
      if (
        Option.isNone(expression) ||
        expression.value.type !== "UnaryExpression" ||
        expression.value.operator !== "-"
      ) {
        return false;
      }
      const operand = unwrapExpression(expression.value.argument);
      return (
        Option.isSome(operand) && operand.value.type === "Literal" && operand.value.value === 1
      );
    };

    const isReanimatedWithRepeat = (node: ESTree.CallExpression): boolean => {
      const callee = unwrapExpression(node.callee);
      if (Option.isNone(callee)) return false;
      if (callee.value.type === "Identifier") {
        return resolvedIdentifierIsIn(callee.value, reanimatedFunctions);
      }
      if (callee.value.type !== "MemberExpression") return false;
      return (
        Option.getOrUndefined(getPropertyName(callee.value.property)) === "withRepeat" &&
        resolvedIdentifierIsIn(callee.value.object, reanimatedNamespaces)
      );
    };

    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        const declaredVariables = context.sourceCode.getDeclaredVariables(node);

        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;
          const variable = declaredVariables.find(
            (candidate) => candidate.name === specifier.local.name,
          );
          if (variable === undefined) continue;

          const importedName =
            specifier.type === "ImportSpecifier"
              ? Option.getOrUndefined(getPropertyName(specifier.imported))
              : undefined;

          if (node.source.value === "react-native-reanimated") {
            if (specifier.type === "ImportNamespaceSpecifier") {
              reanimatedNamespaces.add(variable);
            } else if (importedName === "withRepeat") {
              reanimatedFunctions.add(variable);
            }
          }

          if (node.source.value === "react-native") {
            if (specifier.type === "ImportNamespaceSpecifier") {
              reactNativeNamespaces.add(variable);
            } else if (importedName === "Animated") {
              reactNativeAnimated.add(variable);
            } else if (importedName === "StyleSheet") {
              reactNativeStyleSheets.add(variable);
            }
          }

          if (
            specifier.type === "ImportSpecifier" &&
            importedName === "Spinner" &&
            importedModuleEndsWith(node.source.value, "/ui/spinner")
          ) {
            spinnerComponents.add(variable);
          }

          const builderNames = CLASS_BUILDER_IMPORTS.find(([suffix]) =>
            importedModuleEndsWith(node.source.value, suffix),
          )?.[1];
          if (
            (specifier.type === "ImportSpecifier" &&
              importedName !== undefined &&
              builderNames?.has(importedName) === true) ||
            (specifier.type === "ImportDefaultSpecifier" &&
              importedModuleEndsWith(node.source.value, "clsx"))
          ) {
            classBuilders.add(variable);
          }
        }
      },
      VariableDeclarator(node) {
        if (
          node.parent.type !== "VariableDeclaration" ||
          node.parent.kind !== "const" ||
          node.id.type !== "Identifier"
        ) {
          return;
        }
        const initializer = unwrapExpression(node.init);
        if (
          Option.isNone(initializer) ||
          initializer.value.type !== "Literal" ||
          typeof initializer.value.value !== "string" ||
          !containsInfiniteAnimationClass(initializer.value.value)
        ) {
          return;
        }
        const bindingName = node.id.name;
        const variable = context.sourceCode
          .getDeclaredVariables(node)
          .find((candidate) => candidate.name === bindingName);
        if (variable?.references.some((reference) => isClassLike(reference.identifier)) === true) {
          report(
            initializer.value,
            "Use a finite or reviewed stepped animation instead of an infinite utility.",
          );
        }
      },
      CallExpression(node) {
        if (
          node.arguments.length >= 2 &&
          isInfiniteRepeatCount(node.arguments[1]) &&
          isReanimatedWithRepeat(node)
        ) {
          report(node, "Replace an infinite Reanimated repeat with a finite duty-cycle helper.");
        }

        if (memberCallUses(node, reactNativeAnimated, "Animated", "loop")) {
          report(node, "Replace Animated.loop with finite or reviewed stepped motion.");
        }
      },
      JSXOpeningElement(node) {
        if (!PROTECTED_ROOTS.has(path) || node.name.type !== "JSXIdentifier") return;
        const variable = resolveVariable(node.name, node.name.name);
        if (variable === undefined || !spinnerComponents.has(variable)) return;
        report(
          node,
          "Protected Zerops roots must render a finite status phrase instead of Spinner.",
        );
      },
      Property(node) {
        if (!isInsideJsxStyle(node) && !isInsideStyleSheetCreate(node)) return;
        const key = Option.getOrUndefined(getPropertyName(node.key));
        const value = staticStringValue(node.value);
        if (value === undefined) return;
        const infinite =
          (key === "animationIterationCount" && /^infinite$/iu.test(value.trim())) ||
          (key === "animation" && INFINITE_TOKEN_PATTERN.test(value));
        if (infinite) {
          report(
            node,
            "Replace an infinite inline animation with finite or reviewed stepped motion.",
          );
        }
      },
      Literal(node) {
        if (typeof node.value === "string") checkClassLiteral(node, node.value);
      },
      TemplateElement(node) {
        checkClassLiteral(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
});
