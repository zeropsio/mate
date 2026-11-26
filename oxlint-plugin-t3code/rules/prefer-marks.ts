import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "prefer-marks";
const LEDGER_DIRECTORY_ENV = "T3CODE_PREFER_MARKS_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws its own marks; the design harness stages the app. */
const OWNS_ITS_MARKS = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

/** A dot's size: 4 to 10 px square. */
const DOT_SIZE = /^size-(?:1|1\.5|2|2\.5|\[(?:[4-9]|10)px\])$/u;
/** A fill: a ground colour, never a gradient, an image or nothing. */
const FILL =
  /^bg-(?!transparent$|clip-|linear|radial|conic|none$|cover$|contain$|center$|no-repeat$)/u;
/** A count's figures. */
const COUNT_TYPE = /^text-(?:5xs|4xs|3xs|2xs|caption)$/u;

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return OWNS_ITS_MARKS.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/** Every class a static string in the expression can hold, through `cn()` and its branches. */
const staticClasses = (node: ESTree.Node | null | undefined, into: string[]): void => {
  if (node === null || node === undefined) return;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") into.push(...node.value.split(/\s+/u).filter(Boolean));
      return;
    case "TemplateLiteral":
      for (const quasi of node.quasis) {
        into.push(...(quasi.value.cooked ?? "").split(/\s+/u).filter(Boolean));
      }
      for (const expression of node.expressions) staticClasses(expression, into);
      return;
    case "ConditionalExpression":
      staticClasses(node.consequent, into);
      staticClasses(node.alternate, into);
      return;
    case "LogicalExpression":
      staticClasses(node.right, into);
      return;
    case "CallExpression":
      if (node.callee.type === "Identifier" && node.callee.name === "cn") {
        for (const argument of node.arguments) staticClasses(argument as ESTree.Node, into);
      }
      return;
    default:
      return;
  }
};

/** What mark, if any, a plain element's classes draw by hand. */
export const handDrawnMark = (classes: readonly string[]): "dot" | "count" | undefined => {
  // Only what the element itself always draws: a variant's class may draw a pseudo-element or a
  // child (`before:size-2`), or a state the mark is not.
  const bases = classes.filter((name) => !name.includes(":"));
  if (!bases.includes("rounded-full")) return undefined;
  const filled = bases.some((name) => FILL.test(name));
  if (filled && bases.some((name) => DOT_SIZE.test(name))) return "dot";
  if (
    filled &&
    bases.includes("tabular-nums") &&
    bases.some((name) => COUNT_TYPE.test(name)) &&
    bases.some((name) => /^(?:h|min-w)-/u.test(name))
  ) {
    return "count";
  }
  return undefined;
};

/**
 * A plain element drawing a state dot (a filled circle 4 to 10 px across) or a count (a filled
 * round pill of even figures) by hand: the kit's `Dot` and `Badge count` are those marks, so every
 * dot and every count changes in one place.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a plain element drawing a dot or a count by hand; draw it with <Dot> or <Badge count>.",
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
        if (className?.value === null || className?.value === undefined) return;
        const classes: string[] = [];
        staticClasses(
          className.value.type === "JSXExpressionContainer"
            ? (className.value.expression as ESTree.Node)
            : (className.value as ESTree.Node),
          classes,
        );
        const mark = handDrawnMark(classes);
        if (mark === undefined) return;
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
              mark === "dot"
                ? "This element draws a dot by hand: draw it with <Dot tone size>."
                : "This element draws a count by hand: draw it with <Badge count>.",
            kind,
            fingerprint,
            ledgered,
          }),
        });
      },
    };
  },
});
