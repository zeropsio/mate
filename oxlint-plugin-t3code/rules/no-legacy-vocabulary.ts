import { defineRule, type ESTree } from "@oxlint/plugins";
import { LEGACY_VOCABULARY_PATTERNS } from "@t3tools/shared/legacyVocabulary";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "no-legacy-vocabulary";
const LEDGER_DIRECTORY_ENV = "T3CODE_LEGACY_VOCABULARY_LEDGER_DIRECTORY";
const GUARDED_SOURCE_MARKERS = ["/apps/web/src/", "/apps/mobile/src/", "/apps/desktop/src/"];
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$)/u;

const COPY_SINK_ATTRIBUTES = new Set<string>([
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "label",
  "description",
  "hint",
  "error",
  "message",
  "subtitle",
  "accessibilityLabel",
  "accessibilityHint",
]);

const COPY_PROPERTY_KEYS = new Set<string>([
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "label",
  "description",
  "message",
  "text",
  "accessibilityLabel",
]);

/**
 * This list defines guard scope: these modules hold copy by construction. It is not an exception
 * list; registering another module widens the set of literals checked by this rule.
 */
const COPY_MODULES = [
  "apps/web/src/branding.ts",
  "apps/web/src/hooks/useThreadActions.ts",
  "apps/web/src/environments/primary/auth.ts",
  "apps/web/src/components/settings/settingsSearch.ts",
  "apps/web/src/components/RightPanelTabs.tsx",
  "apps/web/src/rightPanelKinds.ts",
  "apps/web/src/versionSkew.ts",
  "apps/web/src/components/desktopUpdate.logic.ts",
  "apps/web/src/components/settings/providerStatus.ts",
  "apps/web/src/components/BranchToolbar.logic.ts",
  "apps/web/src/connection/platform.ts",
  "apps/web/src/connection/clientMetadata.ts",
  "apps/web/src/components/settings/ThemePreviewCircles.tsx",
  "apps/web/src/components/auth/manualLinkCopy.ts",
  "apps/mobile/src/features/agent-awareness/remoteRegistration.ts",
  "apps/mobile/src/features/connection/pairing.ts",
  "apps/mobile/src/features/threads/projectThreadCreationValidation.ts",
  "apps/mobile/src/features/threads/new-task-context-presentation.ts",
  "apps/mobile/src/features/review/reviewModel.ts",
  "apps/mobile/src/lib/mobileTheme.ts",
  "apps/mobile/src/lib/authClientMetadata.ts",
  "apps/mobile/src/connection/platform.ts",
  "apps/mobile/src/state/use-selected-thread-git-actions.ts",
  "apps/desktop/src/app/DesktopApp.ts",
  "apps/desktop/src/app/DesktopEnvironment.ts",
  "apps/desktop/src/linuxSecretStorage.ts",
  "apps/desktop/src/window/DesktopApplicationMenu.ts",
] as const;

const ledgerDirectory = globalThis.process.env[LEDGER_DIRECTORY_ENV];
const ledger = loadExceptionLedger(RULE_NAME, ledgerDirectory);
const TECHNICAL_IDENTIFIER_PATTERN = /^(?=\S+$)\S*[-_]\S*$/u;

const normalizePath = (path: string): string => `/${path.replaceAll("\\", "/")}`;

const isGuardedSource = (filename: string): boolean => {
  const normalized = normalizePath(filename);
  return GUARDED_SOURCE_MARKERS.some((marker) => normalized.includes(marker));
};

const isCopyModule = (filename: string): boolean => {
  const normalized = normalizePath(filename);
  return COPY_MODULES.some((path) => normalized.endsWith(`/${path}`));
};

const legacyMatch = (value: string) => {
  for (const candidate of LEGACY_VOCABULARY_PATTERNS) {
    const match = candidate.pattern.exec(value);
    if (match !== null) return { name: candidate.name, matchedText: match[0] };
  }
  return undefined;
};

const jsxAttributeForNode = (node: ESTree.Node): ESTree.JSXAttribute | undefined => {
  let current: ESTree.Node | null = node.parent;
  while (current !== null) {
    if (current.type === "JSXAttribute") return current;
    if (current.type === "JSXExpressionContainer") {
      const parent = current.parent;
      return parent.type === "JSXAttribute" ? parent : undefined;
    }
    if (current.type === "JSXElement" || current.type === "JSXFragment") return undefined;
    current = current.parent;
  }
  return undefined;
};

const copySinkAttributeForNode = (node: ESTree.Node): ESTree.JSXAttribute | undefined => {
  const attribute = jsxAttributeForNode(node);
  return attribute?.name.type === "JSXIdentifier" && COPY_SINK_ATTRIBUTES.has(attribute.name.name)
    ? attribute
    : undefined;
};

const isStringLiteral = (node: ESTree.Node): node is ESTree.StringLiteral =>
  node.type === "Literal" && typeof node.value === "string";

const staticStringValue = (node: ESTree.Node): string | undefined => {
  if (isStringLiteral(node)) return node.value;
  if (node.type === "BinaryExpression") {
    if (node.operator !== "+") return undefined;
    const left = staticStringValue(node.left);
    const right = staticStringValue(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (node.type !== "TemplateLiteral") return undefined;

  let value = node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? "";
  for (const [index, expression] of node.expressions.entries()) {
    const expressionValue = staticStringValue(expression);
    if (expressionValue === undefined) return undefined;
    const quasi = node.quasis[index + 1];
    value += expressionValue + (quasi?.value.cooked ?? quasi?.value.raw ?? "");
  }
  return value;
};

const isSchemaLiteralTag = (node: ESTree.StringLiteral): boolean => {
  let current: ESTree.Node = node;
  while (current.parent?.type === "ArrayExpression") current = current.parent;

  const parent = current.parent;
  if (parent?.type !== "CallExpression" || !parent.arguments.includes(current)) return false;
  const callee = parent.callee;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Schema" &&
    callee.property.type === "Identifier" &&
    (callee.property.name === "Literal" || callee.property.name === "Literals")
  );
};

const expressionWithoutParentheses = (node: ESTree.Node): ESTree.Node => {
  let current = node;
  while (current.parent?.type === "ParenthesizedExpression") current = current.parent;
  return current;
};

const isComparedDiscriminant = (node: ESTree.StringLiteral): boolean => {
  const current = expressionWithoutParentheses(node);
  const parent = current.parent;
  if (parent === null) return false;
  return (
    (parent.type === "BinaryExpression" &&
      (parent.operator === "===" ||
        parent.operator === "!==" ||
        parent.operator === "==" ||
        parent.operator === "!=") &&
      (parent.left === current || parent.right === current)) ||
    (parent.type === "SwitchCase" && parent.test === current)
  );
};

const isNonCopyLiteral = (node: ESTree.StringLiteral): boolean => {
  const parent = node.parent;
  if (parent.type === "ImportDeclaration" || parent.type === "ImportExpression") return true;
  if (parent.type === "Property" && parent.key === node) return true;
  if (parent.type === "TSLiteralType" || isSchemaLiteralTag(node)) return true;
  if (isComparedDiscriminant(node)) return true;
  if (TECHNICAL_IDENTIFIER_PATTERN.test(node.value)) return true;
  return jsxAttributeForNode(node) !== undefined && copySinkAttributeForNode(node) === undefined;
};

const copyPropertyName = (
  property: Pick<ESTree.ObjectProperty, "computed" | "key">,
): string | undefined => {
  if (!property.computed && property.key.type === "Identifier") return property.key.name;
  return staticStringValue(property.key);
};

const isNonCopyExpression = (node: ESTree.Node): boolean => {
  if (isStringLiteral(node)) return isNonCopyLiteral(node);
  const parent = node.parent;
  if (parent?.type === "ImportExpression") return true;
  if (jsxAttributeForNode(node) !== undefined) return copySinkAttributeForNode(node) === undefined;
  return parent?.type === "Property" && parent.key === node;
};

const isCopyPropertyValue = (node: ESTree.Node): boolean => {
  let current = node;
  while (true) {
    const parent = current.parent;
    if (parent === null) return false;
    if (parent.type === "Property") {
      return (
        parent.parent.type === "ObjectExpression" &&
        parent.value === current &&
        COPY_PROPERTY_KEYS.has(copyPropertyName(parent) ?? "")
      );
    }
    if (parent.type === "ParenthesizedExpression" && parent.expression === current) {
      current = parent;
      continue;
    }
    if (
      parent.type === "ConditionalExpression" &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      current = parent;
      continue;
    }
    if (
      parent.type === "LogicalExpression" &&
      (parent.left === current || parent.right === current)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
};

const isDirectJsxChildExpression = (node: ESTree.Node): boolean => {
  let current = node;
  while (true) {
    const parent = current.parent;
    if (parent === null) return false;
    if (parent.type === "JSXExpressionContainer") {
      return (
        parent.expression === current &&
        (parent.parent.type === "JSXElement" || parent.parent.type === "JSXFragment")
      );
    }
    if (
      parent.type === "ConditionalExpression" &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      current = parent;
      continue;
    }
    if (
      parent.type === "LogicalExpression" &&
      (parent.left === current || parent.right === current)
    ) {
      current = parent;
      continue;
    }
    if (parent.type === "ParenthesizedExpression" && parent.expression === current) {
      current = parent;
      continue;
    }
    return false;
  }
};

const outerStaticStringExpression = (node: ESTree.Node): ESTree.Node => {
  let current = node;
  while (true) {
    const parent = current.parent;
    if (parent === null) return current;
    if (
      (parent.type === "BinaryExpression" || parent.type === "TemplateLiteral") &&
      staticStringValue(parent) !== undefined
    ) {
      current = parent;
      continue;
    }
    return current;
  }
};

const isExpressionCopySink = (node: ESTree.Node, copyModule: boolean): boolean => {
  const attribute = jsxAttributeForNode(node);
  if (attribute !== undefined) {
    if (copySinkAttributeForNode(node) !== undefined) return true;
    return copyModule && isStringLiteral(node) && !isNonCopyExpression(node);
  }
  if (isCopyPropertyValue(node) || isDirectJsxChildExpression(node)) return true;
  if (!copyModule) return false;
  return !isNonCopyExpression(node);
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow legacy product vocabulary in closed user-facing copy sinks.",
    },
  },
  create(context) {
    const normalizedFilename = normalizePath(context.filename);
    if (!isGuardedSource(context.filename) || TEST_FILE_PATTERN.test(normalizedFilename)) return {};

    const copyModule = isCopyModule(context.filename);
    const reportedNodes = new WeakSet<ESTree.Node>();

    const reportFinding = (node: ESTree.Node, value: string) => {
      if (reportedNodes.has(node)) return;
      const match = legacyMatch(value);
      if (match === undefined) return;

      reportedNodes.add(node);
      const kind = node.type;
      const fingerprint = normalizeFingerprint(context.sourceCode.text.slice(node.start, node.end));
      const ledgered = ledger.has({ path: context.filename, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;

      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary: `Legacy vocabulary "${match.matchedText}" (${match.name}) is not allowed in the ${kind} copy sink.`,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    };

    return {
      JSXText(node) {
        if (node.value.trim().length === 0) return;
        reportFinding(node, node.value);
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (!COPY_SINK_ATTRIBUTES.has(node.name.name)) return;
        if (node.value?.type === "Literal" && typeof node.value.value === "string") {
          reportFinding(node.value, node.value.value);
          return;
        }
      },
      Literal(node) {
        if (typeof node.value !== "string" || isNonCopyLiteral(node)) return;
        const expression = outerStaticStringExpression(node);
        if (expression !== node || !isExpressionCopySink(node, copyModule)) return;
        reportFinding(node, node.value);
      },
      BinaryExpression(node) {
        const value = staticStringValue(node);
        if (
          value === undefined ||
          outerStaticStringExpression(node) !== node ||
          !isExpressionCopySink(node, copyModule)
        ) {
          return;
        }
        reportFinding(node, value);
      },
      TemplateLiteral(node) {
        const value = staticStringValue(node);
        if (
          value === undefined ||
          outerStaticStringExpression(node) !== node ||
          !isExpressionCopySink(node, copyModule)
        ) {
          return;
        }
        reportFinding(node, value);
      },
      TemplateElement(node) {
        const template = node.parent;
        if (template.type !== "TemplateLiteral" || staticStringValue(template) !== undefined)
          return;
        if (!isExpressionCopySink(template, copyModule)) return;
        reportFinding(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
});
