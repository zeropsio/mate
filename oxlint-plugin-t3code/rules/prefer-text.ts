import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "prefer-text";
const LEDGER_DIRECTORY_ENV = "T3CODE_PREFER_TEXT_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws its own words; the design harness stages the app. */
const OWNS_ITS_WORDS = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

/**
 * Each `Text` variant's look as a plain element writes it, its classes sorted: the table
 * `textVariants` in `apps/web/src/components/ui/text.tsx` draws, without its wrap style.
 */
const VARIANT_OF_LOOK: ReadonlyMap<string, string> = new Map([
  ["font-semibold text-emphasis text-foreground", "headline"],
  ["font-medium text-body text-foreground", "heading"],
  ["font-medium text-caption text-muted-foreground", "label"],
  ["text-body text-muted-foreground", "description"],
  ["text-line text-muted-foreground", "remark"],
  ["text-caption text-muted-foreground", "note"],
  ["tabular-nums text-caption text-muted-foreground", "meta"],
  ["text-caption text-status-failed-text", "error"],
  ["font-mono", "code"],
]);

/** A class that says how words look: a step, an ink, a weight, the mono family, even figures. */
const LOOK =
  /^(?:text-(?:5xs|4xs|3xs|2xs|caption|line|body|prose|emphasis|typed|title|display|foreground|muted-foreground|status-failed-text)|font-(?:mono|medium|semibold)|tabular-nums)$/u;

/** A step's own leading, written again: it changes nothing. */
const STEP_LEADING: Readonly<Record<string, string>> = {
  "text-caption": "leading-4",
  "text-body": "leading-5",
  "text-line": "leading-5",
};

/**
 * What `Text` takes in its `className` (no-restyle's layout and spacing), plus what its variants or
 * its `truncate` already say. A class outside these keeps the element its own: it draws more than
 * the words.
 */
const TEXT_TAKES = [
  /^-?(?:m|mx|my|mt|mb|ml|mr|ms|me|p|px|py|pt|pb|pl|pr|ps|pe|gap|gap-x|gap-y|space-x|space-y)-/u,
  /^(?:flex|inline-flex|grid|inline-grid|block|inline-block|inline|hidden|contents|grow|shrink|isolate|truncate|text-pretty|text-balance)$/u,
  /^(?:flex|grow|shrink|basis|items|justify|self|content|place|order|col|row|grid-cols|grid-rows)-/u,
  /^-?(?:w|h|min-w|min-h|max-w|max-h|size|inset|inset-x|inset-y|top|left|right|bottom|start|end|z)-/u,
  /^(?:absolute|relative|fixed|sticky|static|sr-only|not-sr-only)$/u,
  /^(?:overflow|whitespace|break|wrap|align|cursor|select|pointer-events|float|clear)-/u,
  /^text-(?:left|right|center|start|end|justify)$/u,
];

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return OWNS_ITS_WORDS.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/** The variant a class list draws exactly, with nothing `Text` could not take beside it. */
export const textVariantOf = (classes: readonly string[]): string | undefined => {
  const look = classes.filter((name) => LOOK.test(name));
  const variant = VARIANT_OF_LOOK.get(look.toSorted().join(" "));
  if (variant === undefined) return undefined;
  const step = look.find((name) => STEP_LEADING[name] !== undefined);
  const rest = classes.filter(
    (name) => !LOOK.test(name) && (step === undefined || name !== STEP_LEADING[step]),
  );
  return rest.every((name) => {
    const base = name.replace(/^(?:[^:]+:)+/u, "");
    return TEXT_TAKES.some((pattern) => pattern.test(base));
  })
    ? variant
    : undefined;
};

/**
 * Words a plain element draws in exactly one `Text` variant's look: the variant names what they are,
 * so a change to every note or every meta fact happens in one place. A plain element that draws more
 * than words (a border, a ground, its own leading) is not reported.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a plain element drawing a Text variant's look with utilities; draw it with <Text variant>.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    return {
      JSXOpeningElement(node: ESTree.JSXOpeningElement) {
        if (node.name.type !== "JSXIdentifier" || !/^[a-z]/u.test(node.name.name)) return;
        const className = node.attributes.find(
          (candidate): candidate is ESTree.JSXAttribute =>
            candidate.type === "JSXAttribute" &&
            candidate.name.type === "JSXIdentifier" &&
            candidate.name.name === "className",
        );
        if (className?.value?.type !== "Literal" || typeof className.value.value !== "string") {
          return;
        }
        const variant = textVariantOf(className.value.value.split(/\s+/u).filter(Boolean));
        if (variant === undefined) return;
        const fingerprint = normalizeFingerprint(
          `<${node.name.name}> ${context.sourceCode.getText(className)}`,
        );
        const kind = node.type;
        const ledgered = ledger.has({ path, kind, fingerprint });
        if (ledgered && !shouldReportLedgered()) return;
        context.report({
          node,
          message: formatFindingMessage({
            ruleName: RULE_NAME,
            summary: `These words draw Text's "${variant}" look by hand: draw them with <Text variant="${variant}">.`,
            kind,
            fingerprint,
            ledgered,
          }),
        });
      },
    };
  },
});
