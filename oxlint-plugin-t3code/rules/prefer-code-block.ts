import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "prefer-code-block";
const LEDGER_DIRECTORY_ENV = "T3CODE_PREFER_CODE_BLOCK_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws its own blocks; the design harness stages the app. */
const OWNS_ITS_BLOCKS = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return OWNS_ITS_BLOCKS.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/**
 * A `<pre>` in the web client: a block of literal text drawn by hand. Its ground, step, leading,
 * wrap and Copy press are `CodeBlock`'s (`LogView`'s for lines that arrive one by one), so every
 * config, output, patch and answer reads one way and changes in one place.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a hand-drawn <pre> in the web client; draw a block of literal text with <CodeBlock> or <LogView>.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    return {
      JSXOpeningElement(node: ESTree.JSXOpeningElement) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "pre") return;
        const className = node.attributes.find(
          (candidate): candidate is ESTree.JSXAttribute =>
            candidate.type === "JSXAttribute" &&
            candidate.name.type === "JSXIdentifier" &&
            candidate.name.name === "className",
        );
        const fingerprint = normalizeFingerprint(
          className === undefined ? "<pre>" : `<pre> ${context.sourceCode.getText(className)}`,
        );
        const kind = node.type;
        const ledgered = ledger.has({ path, kind, fingerprint });
        if (ledgered && !shouldReportLedgered()) return;
        context.report({
          node,
          message: formatFindingMessage({
            ruleName: RULE_NAME,
            summary:
              "This <pre> draws a block of literal text by hand: draw it with <CodeBlock> (or <LogView> for lines that arrive one by one).",
            kind,
            fingerprint,
            ledgered,
          }),
        });
      },
    };
  },
});
