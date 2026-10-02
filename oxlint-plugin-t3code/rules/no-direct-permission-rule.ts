import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { getPropertyName, resolveVariable, unwrapExpression } from "../utils.ts";

/**
 * HQ's permission rule (`can`, `@t3tools/shared/zeropsPermissions`) is asked in the client only
 * through `mayOffer` (`packages/client-runtime/src/zerops/offers.ts`, its one ledgered import): the
 * one place cached facts stand in for fresh ones, for an offer and never a write. Anywhere else in
 * the client and shared sources, any import of the module but its types, any re-export of it, and
 * any facts built `fresh` are reported. HQ and the server, which enforce the rule, are not client
 * sources; tests are not either.
 */
const RULE_NAME = "no-direct-permission-rule";
const ledger = loadExceptionLedger(RULE_NAME);

const SCOPE_MARKERS = [
  "/apps/web/src/",
  "/apps/mobile/src/",
  "/apps/desktop/src/",
  "/packages/client-runtime/src/",
  "/packages/shared/src/",
] as const;
const RULE_MODULE = "packages/shared/src/zeropsPermissions.ts";
const MODULE_SOURCE = /(^|\/)zeropsPermissions(\.[cm]?[jt]s)?$/u;

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

const namesRuleModule = (source: unknown): boolean =>
  typeof source === "object" &&
  source !== null &&
  "type" in source &&
  source.type === "Literal" &&
  "value" in source &&
  typeof source.value === "string" &&
  MODULE_SOURCE.test(source.value);

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
        "Ask HQ's permission rule in the client only through mayOffer (offers.ts), and build no fresh facts there.",
    },
  },
  create(context) {
    const sourcePath = coveredPath(context.filename);
    if (sourcePath === undefined) return {};

    const report = (node: ESTree.Node, summary: string) => {
      const kind = node.type;
      const fingerprint = normalizeFingerprint(context.sourceCode.getText(node));
      const ledgered = ledger.has({ path: sourcePath, kind, fingerprint });
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
        if (!namesRuleModule(node.source)) return;
        if (node.importKind === "type" || typesOnly(node.specifiers)) return;
        report(node, "Ask HQ's rule through mayOffer (offers.ts); import its types alone here.");
      },
      ExportNamedDeclaration(node) {
        if (!namesRuleModule(node.source)) return;
        if (node.exportKind === "type" || typesOnly(node.specifiers)) return;
        report(
          node,
          "Pass HQ's rule on through mayOffer (offers.ts) alone; re-export its types only.",
        );
      },
      ExportAllDeclaration(node) {
        if (!namesRuleModule(node.source) || node.exportKind === "type") return;
        report(
          node,
          "Pass HQ's rule on through mayOffer (offers.ts) alone; re-export its types only.",
        );
      },
      ImportExpression(node) {
        if (!namesRuleModule(node.source)) return;
        report(node, "Ask HQ's rule through mayOffer (offers.ts); never load it here.");
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
