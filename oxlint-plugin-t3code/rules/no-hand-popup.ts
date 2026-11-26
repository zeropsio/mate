import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "no-hand-popup";
const LEDGER_DIRECTORY_ENV = "T3CODE_NO_HAND_POPUP_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws the popups; the design harness stages the app. */
const DRAWS_POPUPS = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

/** Taken out of the page's flow. */
const POSITION = /^(?:fixed|absolute)$/u;
/** Stacked over what is around it. */
const STACK = /^-?z-(?:\d+|\[[^\]]+\])$/u;
/** The ground the kit's popups stand on. */
const POPUP_GROUND = /^(?:bg-popover(?:\/\S+)?|dropdown-glass|shadow-popup)$/u;

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return DRAWS_POPUPS.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/** Whether a class list draws a popup by hand: out of the flow, stacked, on a popup's ground. */
export const drawsPopup = (classes: readonly string[]): boolean =>
  classes.some((name) => POSITION.test(name)) &&
  classes.some((name) => STACK.test(name)) &&
  classes.some((name) => POPUP_GROUND.test(name));

/**
 * A plain element that floats over the page on a popup's ground: placed by hand, it misses the
 * kit's anchoring, flipping, keeping on screen, focus, Escape and motion. A popup tied to a press
 * or a point is a `Popover`, a `Tooltip` or a `Menu` (a point is a virtual `anchor`); a layer over a
 * surface is an `Overlay`.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a plain element positioned and stacked on a popup's ground; use the kit's Popover, Tooltip, Menu or Overlay.",
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
        if (!drawsPopup(className.value.value.split(/\s+/u).filter(Boolean))) return;
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
              "A popup drawn by hand: float it with the kit's Popover, Tooltip or Menu (a point is a virtual anchor), or lay it over a surface with Overlay.",
            kind,
            fingerprint,
            ledgered,
          }),
        });
      },
    };
  },
});
