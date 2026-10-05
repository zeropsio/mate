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
const WHITESPACE = /\s/u;

/** Source text with comments dropped and whitespace kept only where it separates two names. */
interface CompactText {
  readonly text: string;
  /** The source offset of each compact character. */
  readonly offsets: ReadonlyArray<number>;
}

/**
 * Compacts text so a formatter's rewrap neither hides a site nor breaks an entry: comments and
 * whitespace go, except one space between two name characters (`const x` stays two words).
 */
const compact = (
  text: string,
  skipped: ReadonlyArray<readonly [number, number]> = [],
): CompactText => {
  let out = "";
  const offsets: Array<number> = [];
  let pendingSpace = false;
  let skip = 0;
  for (let index = 0; index < text.length; index += 1) {
    while (skip < skipped.length && skipped[skip]![1] <= index) skip += 1;
    const range = skipped[skip];
    if ((range !== undefined && index >= range[0]) || WHITESPACE.test(text[index]!)) {
      pendingSpace = out.length > 0;
      continue;
    }
    const character = text[index]!;
    if (pendingSpace && NAME_CHARACTER.test(out.at(-1)!) && NAME_CHARACTER.test(character)) {
      out += " ";
      offsets.push(index - 1);
    }
    pendingSpace = false;
    out += character;
    offsets.push(index);
  }
  return { text: out, offsets };
};

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

const COMPACT_TOKENS: ReadonlyMap<RetiredMechanism, string> = new Map(
  RETIRED_MECHANISMS.map((mechanism) => [mechanism, compact(mechanism.token).text]),
);

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
        const comments = context.sourceCode
          .getAllComments()
          .map((comment) => [comment.start, comment.end] as const);
        const source = compact(context.sourceCode.text, comments);

        for (const [mechanism, token] of COMPACT_TOKENS) {
          if (mechanism.paths !== undefined && !mechanism.paths.includes(path)) continue;
          for (const index of occurrences(source.text, token)) {
            const fingerprint = normalizeFingerprint(mechanism.token);
            const ledgered = ledger.has({ path, kind: KIND, fingerprint });
            if (ledgered && !shouldReportLedgered()) continue;
            context.report({
              loc: {
                start: context.sourceCode.getLocFromIndex(source.offsets[index]!),
                end: context.sourceCode.getLocFromIndex(
                  source.offsets[index + token.length - 1]! + 1,
                ),
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
