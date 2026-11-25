import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { textVariantOf } from "./prefer-text.ts";

const RULE_NAME = "prefer-failure";
const LEDGER_DIRECTORY_ENV = "T3CODE_PREFER_FAILURE_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws its own failures; the design harness stages the app. */
const OWNS_ITS_FAILURES = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

/** The inks a failure is said in, at any strength. */
const FAILURE_INK =
  /^text-(?:destructive|destructive-foreground|status-failed-text|error|error-foreground)(?:\/\d+)?$/u;

/** A type step or its leading: what a line of words is set in. */
const WORDS = /^(?:text-(?:5xs|4xs|3xs|2xs|caption|line|body|prose|emphasis)|leading-[\w.]+)$/u;

/**
 * What a plain line may carry beside its ink and its step and still be nothing but a red line:
 * its place (margin, padding, width, a minimum height held for it) and how it sits.
 */
const PLACE = [
  /^-?(?:m|mx|my|mt|mb|ml|mr|ms|me|p|px|py|pt|pb|pl|pr|ps|pe)-/u,
  /^(?:block|inline|inline-block|text-pretty|text-balance)$/u,
  /^(?:min-w|min-h|max-w|w|flex|self|grow|shrink|basis)-/u,
  /^(?:flex-1|grow|shrink-0|min-w-0|w-full)$/u,
  /^text-(?:left|right|center|start|end)$/u,
];

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return OWNS_ITS_FAILURES.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/**
 * Whether a class list draws a red line and nothing else: an ink, a step, its place. Without a
 * step of its own and without being announced (`announced`, a role of alert or status) it is a
 * word in the failure's tone inside a line ("2 failed" among a row's facts), not a line.
 */
export const isHandDrawnFailure = (classes: readonly string[], announced: boolean): boolean => {
  if (!classes.some((name) => FAILURE_INK.test(name))) return false;
  if (
    !announced &&
    !classes.some((name) =>
      /^text-(?:\d?xs|caption|line|body|prose|emphasis)$/u.test(name.replace(/^(?:[^:]+:)+/u, "")),
    )
  )
    return false;
  // Text's own error look is prefer-text's to report.
  if (textVariantOf(classes) === "error") return false;
  return classes.every((name) => {
    const base = name.replace(/^(?:[^:]+:)+/u, "");
    return (
      FAILURE_INK.test(base) || WORDS.test(base) || PLACE.some((pattern) => pattern.test(base))
    );
  });
};

/**
 * A sentence a plain element sets in a failure's ink and nothing more: a refusal or an error drawn
 * by hand. An action refused where it stands is `Failure size="line"`, which also carries its why,
 * its action and Details; a value wrong where it is typed or listed is `Text variant="error"`. An
 * element that draws more (a truncated row's state word, a clamp, a mark beside the words, a
 * conditional tone) is not reported.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow a plain element drawing a failure\'s red line by hand; use <Failure size="line"> or <Text variant="error">.',
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
        const role = node.attributes.find(
          (candidate): candidate is ESTree.JSXAttribute =>
            candidate.type === "JSXAttribute" &&
            candidate.name.type === "JSXIdentifier" &&
            candidate.name.name === "role",
        );
        const announced =
          role?.value?.type === "Literal" &&
          (role.value.value === "alert" || role.value.value === "status");
        if (!isHandDrawnFailure(className.value.value.split(/\s+/u).filter(Boolean), announced))
          return;
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
            summary:
              'A failure\'s red line drawn by hand: an action\'s refusal is <Failure size="line"> (with its action and Details), a value\'s error is <Text variant="error">.',
            kind,
            fingerprint,
            ledgered,
          }),
        });
      },
    };
  },
});
