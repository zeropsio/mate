import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "page-title-is-page-header";
const LEDGER_DIRECTORY_ENV = "T3CODE_PAGE_TITLE_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws the page's head; the design harness stages the app. */
const OWNS_THE_HEAD = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return OWNS_THE_HEAD.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/**
 * A page's title is the one `<h1>` its `PageHeader` draws: a hand-made `<h1>` (written, or passed
 * as a `render`) is a page head of its own, with its own step, weight and line. A page whose title
 * is not a head (a hero's headline, a bar's title) is a ledgered exception.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow a hand-made <h1>: a page's title is PageHeader's.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    return {
      JSXOpeningElement(node: ESTree.JSXOpeningElement) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "h1") return;
        const fingerprint = normalizeFingerprint(context.sourceCode.getText(node));
        const kind = node.type;
        const ledgered = ledger.has({ path, kind, fingerprint });
        if (ledgered && !shouldReportLedgered()) return;
        context.report({
          node,
          message: formatFindingMessage({
            ruleName: RULE_NAME,
            summary:
              "A page's title is PageHeader's: head the page with <PageHeader title> instead of an <h1> of its own.",
            kind,
            fingerprint,
            ledgered,
          }),
        });
      },
    };
  },
});
