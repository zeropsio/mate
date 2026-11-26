import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "no-hand-drawn-box";
const LEDGER_DIRECTORY_ENV = "T3CODE_NO_HAND_DRAWN_BOX_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws its own boxes; the design harness stages the app. */
const OWNS_ITS_BOXES = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

/** A box's corner: the scale's control, card and sheet radii (a mark's and a pill's are marks). */
const BOX_RADIUS = /^rounded-(?:control|card|sheet)$/u;

/** A ground: any `bg-` colour, not the background utilities that paint none. */
const GROUND =
  /^bg-(?!(?:transparent|none|cover|contain|auto|center|top|bottom|left|right|fixed|local|scroll|repeat|no-repeat|repeat-x|repeat-y|origin-\S+|clip-\S+|linear-\S+|radial(?:-\S+)?|conic(?:-\S+)?|blend-\S+)$)\S+$/u;

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return OWNS_ITS_BOXES.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/** Every class a className's literal parts can apply: its strings, `cn()` arguments and branches. */
const literalClasses = (node: ESTree.Node | null | undefined, into: string[]): void => {
  if (node === null || node === undefined) return;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") into.push(...node.value.split(/\s+/u));
      return;
    case "TemplateLiteral":
      for (const quasi of node.quasis) into.push(...(quasi.value.cooked ?? "").split(/\s+/u));
      for (const expression of node.expressions) literalClasses(expression, into);
      return;
    case "JSXExpressionContainer":
      if (node.expression.type !== "JSXEmptyExpression") literalClasses(node.expression, into);
      return;
    case "CallExpression":
      for (const argument of node.arguments) literalClasses(argument as ESTree.Node, into);
      return;
    case "ConditionalExpression":
      literalClasses(node.consequent, into);
      literalClasses(node.alternate, into);
      return;
    case "LogicalExpression":
      literalClasses(node.right, into);
      return;
    case "ArrayExpression":
      for (const element of node.elements) literalClasses(element as ESTree.Node | null, into);
      return;
    default:
      return;
  }
};

/** A box at rest: a box's corner and a ground, neither behind a variant (`hover:`, `data-*:`). */
export const drawsABox = (classes: readonly string[]): boolean => {
  const atRest = classes.filter((name) => name !== "" && !name.includes(":"));
  return atRest.some((name) => BOX_RADIUS.test(name)) && atRest.some((name) => GROUND.test(name));
};

/**
 * A plain element that draws a box of its own — a box's corner and a ground at rest — where the
 * kit has the piece for its job: a `Card` form (a card, an inset well, a wash, a slot, a sheet), a
 * `MessageBubble`, a `PictureFrame`, a `Badge`. A ground behind a variant (a row lit under the
 * pointer, a picked row) is not reported; a class constant the element reads by name is not read.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a plain element drawing its own box (a box radius and a ground); use the kit's Card, MessageBubble or PictureFrame.",
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
        literalClasses(className.value as ESTree.Node, classes);
        if (!drawsABox(classes)) return;
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
              "This element draws a box by hand (a box's corner and a ground): use the kit's piece for its job — a Card form, a MessageBubble, a PictureFrame.",
            kind,
            fingerprint,
            ledgered,
          }),
        });
      },
    };
  },
});
