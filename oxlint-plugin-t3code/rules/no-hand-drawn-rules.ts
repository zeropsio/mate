import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "no-hand-drawn-rules";
const LEDGER_DIRECTORY_ENV = "T3CODE_NO_HAND_DRAWN_RULES_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws its own rules; the design harness stages the app. */
const DRAWS_ITS_OWN = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const base = (name: string): string => name.replace(/^(?:[^:]+:)+/u, "");
const prefixes = (name: string): string[] => name.split(":").slice(0, -1);

/**
 * A list ruling its items: `divide-y`, at any breakpoint. With `divide-x` beside it, it is a cell
 * grid ruled both ways, which no list draws; `divide-x` alone is a row's split.
 */
const DIVIDES = /^divide-y$/u;
const DIVIDES_ACROSS = /^divide-x$/u;
/** A rule along one edge, top or bottom. */
const ACROSS_EDGE = /^border-[tb]$/u;
/** A rule along a side: a cell grid rules both ways, which no list does. */
const SIDE_EDGE = /^border-[lrse](?:-0)?$/u;
/** An item undoing its rule by where it stands: `first:border-t-0`, `last:border-b-0`, … */
const POSITION_RESET = /^border-(?:[tby](?:-0|-transparent)?|transparent)$/u;
const POSITIONS = new Set(["first", "last", "not-first", "not-last"]);
/** A hairline's ink: the border's, or the rule's. */
const RULE_INK = /^(?:bg|border)-(?:border|rule)(?:\/\d+)?$/u;
/** A one-pixel line's own size: across, and upright. */
const HAIRLINE = /^(?:h|w)-px$/u;
/** A one-pixel line across: an upright one between items in a list is a track, not a rule. */
const HAIRLINE_ACROSS = /^h-px$/u;

type Finding = { readonly summary: string };

/** What a plain element's classes draw by hand that `List` or `Separator` draws. */
export const handDrawnRuleOf = (
  classes: readonly string[],
  selfClosing: boolean,
): Finding | undefined => {
  if (
    classes.some((name) => DIVIDES.test(base(name))) &&
    !classes.some((name) => DIVIDES_ACROSS.test(base(name)))
  ) {
    return {
      summary:
        "This list rules its items with divide-y: part them with <List>, which draws the rules.",
    };
  }
  const crossRule = classes.some((name) => prefixes(name).length === 0 && ACROSS_EDGE.test(name));
  const positioned = classes.some(
    (name) =>
      prefixes(name).some((prefix) => POSITIONS.has(prefix)) && POSITION_RESET.test(base(name)),
  );
  const sideRule = classes.some((name) => SIDE_EDGE.test(base(name)));
  if ((crossRule || classes.some((name) => /^not-first:border-t$/u.test(name))) && positioned) {
    if (!sideRule) {
      return {
        summary:
          "This item rules itself by where it stands in its list: put the list on <List>, which draws a rule between its items.",
      };
    }
  }
  const placed = (name: string): boolean => prefixes(name).some((prefix) => POSITIONS.has(prefix));
  if (
    classes.some((name) => placed(name) && HAIRLINE_ACROSS.test(base(name))) &&
    classes.some((name) => placed(name) && RULE_INK.test(base(name)))
  ) {
    return {
      summary:
        'These items draw a hairline between them by hand: put the list on <List> (rule="inset" starts it at the words).',
    };
  }
  const positionedLine = classes.some((name) => /^(?:absolute|fixed|sticky)$/u.test(base(name)));
  if (
    !positionedLine &&
    classes.some((name) => HAIRLINE.test(name)) &&
    classes.some((name) => RULE_INK.test(name) && name.startsWith("bg-"))
  ) {
    return { summary: "This element is a hand-drawn hairline: draw it with <Separator>." };
  }
  if (
    selfClosing &&
    classes.length > 0 &&
    classes.every((name) => ACROSS_EDGE.test(name) || RULE_INK.test(name)) &&
    classes.some((name) => ACROSS_EDGE.test(name))
  ) {
    return { summary: "This empty element only draws a rule: draw it with <Separator>." };
  }
  return undefined;
};

/** Every string an expression holds: a `cn()` call's arguments, a condition's branches, a template's parts. */
const classStrings = (node: unknown): string[] => {
  if (node === null || typeof node !== "object") return [];
  const value = node as { readonly type?: unknown; readonly value?: unknown };
  if (value.type === "Literal") return typeof value.value === "string" ? [value.value] : [];
  if (value.type === "TemplateElement") {
    const cooked = (node as { readonly value: { readonly cooked?: unknown } }).value.cooked;
    return typeof cooked === "string" ? [cooked] : [];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    key === "parent" || key === "range" || key === "loc"
      ? []
      : Array.isArray(child)
        ? child.flatMap(classStrings)
        : classStrings(child),
  );
};

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return DRAWS_ITS_OWN.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/**
 * Dividers drawn by hand on a plain element: a list's `divide-y`, an item that rules itself by its
 * place in its list (`border-t first:border-t-0`), a one-pixel element in the rule's ink, an empty
 * element that is only a rule. `List` and `Separator` draw those in one ink, so a change to every
 * divider happens in one place. A cell grid (ruled both ways), a positioned line (a chart's grid, a
 * track) and a frame's edge are not reported.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow dividers drawn by hand on plain elements; part a list with <List>, two parts with <Separator>.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    return {
      JSXElement(node: ESTree.JSXElement) {
        const opening = node.openingElement;
        if (opening.name.type !== "JSXIdentifier" || !/^[a-z]/u.test(opening.name.name)) return;
        const className = opening.attributes.find(
          (candidate): candidate is ESTree.JSXAttribute =>
            candidate.type === "JSXAttribute" &&
            candidate.name.type === "JSXIdentifier" &&
            candidate.name.name === "className",
        );
        const value = className?.value;
        if (value === null || value === undefined) return;
        const literal = value.type === "Literal" && typeof value.value === "string";
        // A literal is one class list; in an expression (`cn(…)`, a condition, a template) each
        // string is one, judged alone.
        const lists = classStrings(value);
        const finding = lists
          .map((list) =>
            handDrawnRuleOf(
              list.split(/\s+/u).filter(Boolean),
              literal && node.closingElement === null,
            ),
          )
          .find((each) => each !== undefined);
        if (finding === undefined) return;
        const fingerprint = normalizeFingerprint(
          `<${opening.name.name}> ${context.sourceCode.getText(className)}`,
        );
        const kind = opening.type;
        const ledgered = ledger.has({ path, kind, fingerprint });
        if (ledgered && !shouldReportLedgered()) return;
        context.report({
          node: opening,
          message: formatFindingMessage({
            ruleName: RULE_NAME,
            summary: finding.summary,
            kind,
            fingerprint,
            ledgered,
          }),
        });
      },
    };
  },
});
