import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "prefer-item-grounds";
const LEDGER_DIRECTORY_ENV = "T3CODE_PREFER_ITEM_GROUNDS_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws the grounds; the design harness stages the app. */
const OWNS_ITS_GROUNDS = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

/** A theme ground or a step of the ink, the stuff a hand-drawn hover ground is mixed from. */
const NEUTRAL_GROUND =
  /^!?bg-(?:accent|muted|foreground|secondary|background|card)(?:\/(?:\d+(?:\.\d+)?|\[[^\]]+\]))?!?$/u;

/** A variant that lights an item while the pointer is on it or on what it groups. */
const POINTER_VARIANT = /(?:^|[-[:])hover(?:[/:\]>,)]|$)/u;

/** A utility's variants (everything before its last `:` outside brackets) and the utility itself. */
const splitVariants = (token: string): { readonly variants: string; readonly utility: string } => {
  let depth = 0;
  let cut = -1;
  for (let index = 0; index < token.length; index += 1) {
    const character = token.charAt(index);
    if (character === "[" || character === "(") depth += 1;
    else if (character === "]" || character === ")") depth -= 1;
    else if (character === ":" && depth === 0) cut = index;
  }
  return cut === -1
    ? { variants: "", utility: token }
    : { variants: token.slice(0, cut + 1), utility: token.slice(cut + 1) };
};

/**
 * The hand-drawn pointer grounds in one class string: a neutral ground behind a hover variant.
 * A string that also sets a resting ground of its own (a chip, a tile) is its own surface, lit a
 * step deeper, and is not reported.
 */
export const handDrawnItemGrounds = (classes: readonly string[]): readonly string[] => {
  const split = classes.map(splitVariants);
  const rests = split.some(
    ({ variants, utility }) => variants === "" && /^bg-(?!clip-|none$)/u.test(utility),
  );
  if (rests) return [];
  return split
    .filter(
      ({ variants, utility }) => POINTER_VARIANT.test(variants) && NEUTRAL_GROUND.test(utility),
    )
    .map(({ variants, utility }) => `${variants}${utility}`);
};

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return OWNS_ITS_GROUNDS.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/**
 * A pressable item's ground under the pointer is one token, `bg-item-hover`, and the ground of
 * the one picked among its list is `bg-item-picked`: a step of the ink that lights alike on every
 * surface. A ground mixed by hand from the theme's accent, muted or ink behind `hover:` is a look
 * of its own that drifts from every other row; draw the row with `Row pressable` (and `picked`),
 * or name the token.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a hand-mixed hover ground on a pressable item; draw it with Row pressable or bg-item-hover.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    const check = (node: ESTree.Node, text: string) => {
      const found = handDrawnItemGrounds(text.split(/\s+/u).filter(Boolean));
      if (found.length === 0) return;
      const kind = node.type;
      const fingerprint = normalizeFingerprint(context.sourceCode.getText(node));
      const ledgered = ledger.has({ path, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;
      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary: `${found.join(", ")} mixes a hover ground by hand: a pressable item lights with bg-item-hover (Row pressable, Card pressable), the picked one stands on bg-item-picked.`,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
});
