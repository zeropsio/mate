import { defineRule } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "no-platform-globals";
const CLIENT_RUNTIME_ZEROPS_MARKER = "/packages/client-runtime/src/zerops/";
const FORBIDDEN_GLOBALS = new Set(["window", "document", "localStorage", "fetch"]);
const ledger = loadExceptionLedger(RULE_NAME);

const clientRuntimeZeropsPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const markerIndex = normalized.lastIndexOf(CLIENT_RUNTIME_ZEROPS_MARKER);
  if (markerIndex === -1) return undefined;

  const relativePath = normalized.slice(markerIndex + 1);
  return relativePath.includes(".test.") ? undefined : relativePath;
};

const isStatementOrDeclaration = (node: unknown): boolean =>
  typeof node === "object" &&
  node !== null &&
  "type" in node &&
  typeof node.type === "string" &&
  (node.type.endsWith("Statement") || node.type.endsWith("Declaration"));

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require UI-free Zerops client-runtime modules to receive browser platform capabilities explicitly.",
    },
  },
  create(context) {
    const sourcePath = clientRuntimeZeropsPath(context.filename);
    if (sourcePath === undefined) return {};

    return {
      "Program:exit"() {
        const globalScope = context.sourceCode.scopeManager.globalScope;
        if (globalScope === null) return;

        for (const reference of globalScope.through) {
          const identifier = reference.identifier;
          if (!FORBIDDEN_GLOBALS.has(identifier.name)) continue;

          // `typeof window` still reads the unresolved platform binding and must be injected too.
          const statement = context.sourceCode
            .getAncestors(identifier)
            .toReversed()
            .find(isStatementOrDeclaration);
          const kind = identifier.type;
          const fingerprint = normalizeFingerprint(
            context.sourceCode.getText(statement ?? identifier),
          );
          const ledgered = ledger.has({ path: sourcePath, kind, fingerprint });
          if (ledgered && !shouldReportLedgered()) continue;

          context.report({
            node: identifier,
            message: formatFindingMessage({
              ruleName: RULE_NAME,
              summary: `Pass ${identifier.name} into this UI-free module instead of reading the platform global.`,
              kind,
              fingerprint,
              ledgered,
            }),
          });
        }
      },
    };
  },
});
