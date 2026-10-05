import { defineRule } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { RETIRED_MECHANISMS, type RetiredMechanism } from "../retiredMechanisms.ts";

/**
 * A mechanism the data-layer rewrite retires gains no new site: every occurrence of a retired
 * token (`retiredMechanisms.ts`) outside comments is reported in the client sources and HQ. Its
 * ledger is the rewrite's remaining work; a site goes when its family moves to the new layer.
 */
const RULE_NAME = "no-retired-mechanism";
const LEDGER_DIRECTORY_ENV = "T3CODE_RETIRED_MECHANISM_LEDGER_DIRECTORY";
/** The token's site in a ledger entry: a text match, not one AST node type. */
const KIND = "retired-token";
const SCOPE_MARKERS = [
  "/apps/web/src/",
  "/apps/mobile/src/",
  "/apps/desktop/src/",
  "/apps/hq/src/",
  "/packages/client-runtime/src/",
  "/packages/shared/src/",
] as const;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  for (const marker of SCOPE_MARKERS) {
    const index = normalized.lastIndexOf(marker);
    if (index === -1) continue;
    const path = normalized.slice(index + 1);
    return TEST_FILE_PATTERN.test(path) ? undefined : path;
  }
  return undefined;
};

const NAME_CHARACTER = /[\w$]/u;

/** Each occurrence of the token, bounded where the token itself begins or ends with a name. */
const occurrences = (text: string, token: string): ReadonlyArray<number> => {
  const found: Array<number> = [];
  const boundedStart = NAME_CHARACTER.test(token.at(0) ?? "");
  const boundedEnd = NAME_CHARACTER.test(token.at(-1) ?? "");
  for (let index = text.indexOf(token); index !== -1; index = text.indexOf(token, index + 1)) {
    const before = text[index - 1] ?? "";
    const after = text[index + token.length] ?? "";
    if (boundedStart && NAME_CHARACTER.test(before)) continue;
    if (boundedEnd && NAME_CHARACTER.test(after)) continue;
    found.push(index);
  }
  return found;
};

const summaryOf = (mechanism: RetiredMechanism): string =>
  `\`${mechanism.token}\` is retired (${mechanism.family}): ${mechanism.reason}.`;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "A mechanism the client data-layer rewrite retires gains no new site; its ledger only shrinks.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};

    return {
      Program() {
        const { text } = context.sourceCode;
        const comments = context.sourceCode
          .getAllComments()
          .map((comment) => [comment.start, comment.end] as const);
        const inComment = (index: number) =>
          comments.some(([start, end]) => index >= start && index < end);

        for (const mechanism of RETIRED_MECHANISMS) {
          for (const index of occurrences(text, mechanism.token)) {
            if (inComment(index)) continue;
            const fingerprint = normalizeFingerprint(mechanism.token);
            const ledgered = ledger.has({ path, kind: KIND, fingerprint });
            if (ledgered && !shouldReportLedgered()) continue;
            context.report({
              loc: {
                start: context.sourceCode.getLocFromIndex(index),
                end: context.sourceCode.getLocFromIndex(index + mechanism.token.length),
              },
              message: formatFindingMessage({
                ruleName: RULE_NAME,
                summary: summaryOf(mechanism),
                kind: KIND,
                fingerprint,
                ledgered,
              }),
            });
          }
        }
      },
    };
  },
});
