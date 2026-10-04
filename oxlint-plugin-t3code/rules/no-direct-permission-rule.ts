import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { formatFindingMessage, normalizeFingerprint } from "../exceptions.ts";
import { getPropertyName, resolveVariable, unwrapExpression } from "../utils.ts";

/**
 * HQ's permission rule (`can`, `apps/hq/src/permissions.ts`) is HQ's alone: HQ decides every verb,
 * enforces each write by it and streams what it offers (`@t3tools/shared/hqOffers`); the client
 * draws those decisions and decides none. In the client and shared sources, any import of HQ's
 * module at all, any value imported or re-exported from the rule's wire contract
 * (`@t3tools/shared/zeropsPermissions`, whose reasons and decision shape come in as types), and any
 * facts built `fresh` are reported — with no exception. HQ and the server are not client sources;
 * tests are not either.
 */
const RULE_NAME = "no-direct-permission-rule";

const SCOPE_MARKERS = [
  "/apps/web/src/",
  "/apps/mobile/src/",
  "/apps/desktop/src/",
  "/packages/client-runtime/src/",
  "/packages/shared/src/",
] as const;
const RULE_MODULE = "packages/shared/src/zeropsPermissions.ts";
const MODULE_SOURCE = /(^|\/)zeropsPermissions(\.[cm]?[jt]s)?$/u;
/** HQ's own sources, where `can` lives: by its package, or by a path into it. */
const HQ_SOURCE = /^@t3tools\/hq(\/|$)|(^|\/)apps\/hq\/|(^|\/)hq\/src\//u;

/** The file's repo path where it is a client or shared source the rule covers. */
const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  for (const marker of SCOPE_MARKERS) {
    const index = normalized.lastIndexOf(marker);
    if (index === -1) continue;
    const path = normalized.slice(index + 1);
    return path.includes(".test.") || path === RULE_MODULE ? undefined : path;
  }
  return undefined;
};

/** The module a literal source names, where it names one. */
const sourceOf = (source: unknown): string | undefined =>
  typeof source === "object" &&
  source !== null &&
  "type" in source &&
  source.type === "Literal" &&
  "value" in source &&
  typeof source.value === "string"
    ? source.value
    : undefined;

const namesRuleModule = (source: unknown): boolean => MODULE_SOURCE.test(sourceOf(source) ?? "");

const namesHq = (source: unknown): boolean => HQ_SOURCE.test(sourceOf(source) ?? "");

/** Whether every specifier brings in a type alone. */
const typesOnly = (
  specifiers: ReadonlyArray<ESTree.ImportDeclarationSpecifier | ESTree.ExportSpecifier>,
): boolean =>
  specifiers.length > 0 &&
  specifiers.every(
    (specifier) =>
      (specifier.type === "ImportSpecifier" && specifier.importKind === "type") ||
      (specifier.type === "ExportSpecifier" && specifier.exportKind === "type"),
  );

const isFreshLiteral = (node: Option.Option<ESTree.Node>): boolean =>
  Option.isSome(node) &&
  ((node.value.type === "Literal" && node.value.value === "fresh") ||
    (node.value.type === "TemplateLiteral" &&
      node.value.expressions.length === 0 &&
      node.value.quasis[0]?.value.cooked === "fresh"));

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "HQ's permission rule is HQ's alone: the client imports its wire contract as types, never the rule, and builds no fresh facts.",
    },
  },
  create(context) {
    const sourcePath = coveredPath(context.filename);
    if (sourcePath === undefined) return {};

    const report = (node: ESTree.Node, summary: string) => {
      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary,
          kind: node.type,
          fingerprint: normalizeFingerprint(context.sourceCode.getText(node)),
          ledgered: false,
        }),
      });
    };
    const HQ_ALONE = "HQ's rule is HQ's alone: draw what HQ offers (hqOffers.ts), never import it.";

    /** A constant whose value is the literal `"fresh"`. */
    const freshByName = (node: ESTree.Node): boolean => {
      const variable = resolveVariable(context, node);
      const definition = variable?.defs[0]?.node;
      return (
        definition !== undefined &&
        definition.type === "VariableDeclarator" &&
        isFreshLiteral(unwrapExpression(definition.init))
      );
    };

    return {
      ImportDeclaration(node) {
        if (namesHq(node.source)) return report(node, HQ_ALONE);
        if (!namesRuleModule(node.source)) return;
        if (node.importKind === "type" || typesOnly(node.specifiers)) return;
        report(
          node,
          "Import the rule's wire contract as types alone: HQ decides, the client draws.",
        );
      },
      ExportNamedDeclaration(node) {
        if (namesHq(node.source)) return report(node, HQ_ALONE);
        if (!namesRuleModule(node.source)) return;
        if (node.exportKind === "type" || typesOnly(node.specifiers)) return;
        report(node, "Re-export the rule's wire contract as types alone.");
      },
      ExportAllDeclaration(node) {
        if (namesHq(node.source)) return report(node, HQ_ALONE);
        if (!namesRuleModule(node.source) || node.exportKind === "type") return;
        report(node, "Re-export the rule's wire contract as types alone.");
      },
      ImportExpression(node) {
        if (namesHq(node.source)) return report(node, HQ_ALONE);
        if (!namesRuleModule(node.source)) return;
        report(node, "Never load the rule's wire contract here: import its types.");
      },
      Property(node) {
        if (Option.getOrUndefined(getPropertyName(node.key)) !== "freshness") return;
        const value = unwrapExpression(node.value);
        const fresh =
          isFreshLiteral(value) ||
          (Option.isSome(value) && value.value.type === "Identifier" && freshByName(value.value));
        if (!fresh) return;
        report(node, "The client builds no fresh facts: HQ reads them when it writes.");
      },
    };
  },
});
