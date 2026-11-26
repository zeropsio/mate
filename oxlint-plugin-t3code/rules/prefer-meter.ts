import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "prefer-meter";
const LEDGER_DIRECTORY_ENV = "T3CODE_PREFER_METER_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws its own quantities; the design harness stages the app. */
const DRAWS_ITS_OWN = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

/** A swatch's size: a dot beside a series' name. */
const SWATCH_SIZE = /^size-(?:1|1\.5|2|2\.5|3)$/u;
const SWATCH_CORNER = /^rounded-(?:full|mark)$/u;
const FILL_INK = /^bg-/u;

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return DRAWS_ITS_OWN.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

const attribute = (node: ESTree.JSXOpeningElement, name: string): ESTree.JSXAttribute | undefined =>
  node.attributes.find(
    (candidate): candidate is ESTree.JSXAttribute =>
      candidate.type === "JSXAttribute" &&
      candidate.name.type === "JSXIdentifier" &&
      candidate.name.name === name,
  );

/** Every class word written literally in a `className`: a string, a template's text, `cn`'s. */
const classWords = (value: ESTree.JSXAttribute["value"]): readonly string[] => {
  const words: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const typed = node as { readonly type?: string };
    if (typed.type === "Literal") {
      const literal = (node as ESTree.StringLiteral).value;
      if (typeof literal === "string") words.push(...literal.split(/\s+/u).filter(Boolean));
      return;
    }
    if (typed.type === "TemplateElement") {
      const raw = (node as ESTree.TemplateElement).value.raw;
      words.push(...raw.split(/\s+/u).filter(Boolean));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "parent") continue;
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(value);
  return words;
};

/** The inline style's properties by name, when it is an object written in place. */
const styleProperties = (
  value: ESTree.JSXAttribute["value"],
): ReadonlyMap<string, ESTree.Expression> | undefined => {
  if (value?.type !== "JSXExpressionContainer") return undefined;
  const expression = value.expression;
  if (expression.type !== "ObjectExpression") return undefined;
  const properties = new Map<string, ESTree.Expression>();
  for (const property of expression.properties) {
    if (property.type !== "Property") continue;
    const key =
      property.key.type === "Identifier"
        ? property.key.name
        : property.key.type === "Literal" && typeof property.key.value === "string"
          ? property.key.value
          : undefined;
    if (key !== undefined) properties.set(key, property.value as ESTree.Expression);
  }
  return properties;
};

/** A template computed from data that ends in a percentage, or scales or slides along x. */
const drawnShare = (node: ESTree.Expression | undefined): boolean => {
  if (node?.type !== "TemplateLiteral" || node.expressions.length === 0) return false;
  const text = node.quasis.map((quasi) => quasi.value.raw).join("");
  return text.trim().endsWith("%") || /(?:scaleX|translateX)\(/u.test(text);
};

/**
 * A quantity drawn by hand: a bar's fill sized from data (a width in percent, a scale or a slide
 * along x, on an element with a ground), or a series swatch (a small round element painted from
 * data). Each is the kit's — `Meter`, `ShareBar`, `SeriesSwatch` — so every bar and legend in the
 * product changes in one place.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a bar's fill or a series swatch drawn by hand; draw it with Meter, ShareBar or SeriesSwatch.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    return {
      JSXOpeningElement(node: ESTree.JSXOpeningElement) {
        if (node.name.type !== "JSXIdentifier" || !/^[a-z]/u.test(node.name.name)) return;
        const style = attribute(node, "style");
        const properties = styleProperties(style?.value ?? null);
        if (style === undefined || properties === undefined) return;
        const words = classWords(attribute(node, "className")?.value ?? null);
        const painted = properties.has("backgroundColor");
        const fill =
          (drawnShare(properties.get("width")) || drawnShare(properties.get("transform"))) &&
          (painted || words.some((word) => FILL_INK.test(word)));
        const swatch =
          painted &&
          words.some((word) => SWATCH_SIZE.test(word)) &&
          words.some((word) => SWATCH_CORNER.test(word));
        if (!fill && !swatch) return;
        const fingerprint = normalizeFingerprint(
          `<${node.name.name}> ${context.sourceCode.getText(style)}`,
        );
        const kind = node.type;
        const ledgered = ledger.has({ path, kind, fingerprint });
        if (ledgered && !shouldReportLedgered()) return;
        context.report({
          node,
          message: formatFindingMessage({
            ruleName: RULE_NAME,
            summary: fill
              ? "This bar's fill is drawn by hand: one amount against its limit is a <Meter>, a whole split into parts a <ShareBar>."
              : "This series swatch is drawn by hand: draw it with <SeriesSwatch color>.",
            kind,
            fingerprint,
            ledgered,
          }),
        });
      },
    };
  },
});
