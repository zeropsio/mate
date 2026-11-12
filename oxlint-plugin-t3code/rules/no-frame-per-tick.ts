import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { getPropertyName, resolveVariable, unwrapExpression } from "../utils.ts";

const RULE_NAME = "no-frame-per-tick";
const LEDGER_DIRECTORY_ENV = "T3CODE_FRAME_PER_TICK_LEDGER_DIRECTORY";
const WEB_SOURCE_MARKER = "/apps/web/src/";
const TEST_FILE_PATTERN = /\.(?:spec|test)\.[^/]+$/u;
/** The one place a plain observer lives: it lets go of its targets while the page stands still. */
const RESTING_OBSERVER = "apps/web/src/lib/restingIntersections.ts";
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);
const CONTENT_VISIBILITY_AUTO_PATTERN = /content-visibility:\s*auto(?![-\w])/iu;

const OBSERVER_SUMMARY =
  "Watch through watchIntersections or watchCrossings (lib/restingIntersections.ts): while a plain IntersectionObserver observes, every animation on the page costs the main thread a frame per tick.";
const LAZY_SUMMARY =
  'Load the picture eagerly, or ask for it once useNearViewport says its box is near: one left waiting on loading="lazy" is an observer of the browser\'s own and costs every animation a main-thread frame per tick.';
const CONTENT_VISIBILITY_SUMMARY =
  "Do not use content-visibility: auto: the browser watches each such box as an observer would, and every animation on the page costs the main thread a frame per tick.";

const ledgerDirectory = globalThis.process.env[LEDGER_DIRECTORY_ENV];
const ledger = loadExceptionLedger(RULE_NAME, ledgerDirectory);

const sourcePath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const markerIndex = normalized.lastIndexOf(WEB_SOURCE_MARKER);
  return markerIndex === -1
    ? undefined
    : `apps/web/src/${normalized.slice(markerIndex + WEB_SOURCE_MARKER.length)}`;
};

const staticStringValue = (node: unknown): string | undefined => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression)) return undefined;
  if (expression.value.type === "JSXExpressionContainer") {
    return staticStringValue(expression.value.expression);
  }
  if (expression.value.type === "Literal" && typeof expression.value.value === "string") {
    return expression.value.value;
  }
  if (expression.value.type === "TemplateLiteral" && expression.value.expressions.length === 0) {
    return expression.value.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
  }
  return undefined;
};

const isAuto = (node: unknown): boolean => staticStringValue(node)?.trim().toLowerCase() === "auto";

const isContentVisibilityName = (name: string | undefined): boolean =>
  name === "contentVisibility" || name === "content-visibility";

/**
 * Guards the three things that make Chrome ask the main thread for a frame on every tick of every
 * animation, the composited ones included, for as long as they wait: a plain IntersectionObserver,
 * a picture left to `loading="lazy"`, and a box with `content-visibility: auto`
 * (`apps/web/src/lib/restingIntersections.ts` holds the measurements). CSS files are scanned for
 * the same declaration by `scripts/check-css-motion.ts`, against this rule's ledger.
 *
 * Literal syntax only: an observer's constructor reached through another name, a `loading` value
 * that arrives through a variable or a prop, and a class or a style composed from parts remain gaps.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Reject what costs the main thread a frame per animation tick while a page is at rest, unless an exact reviewed exception covers it.",
    },
  },
  create(context) {
    const path = sourcePath(context.filename);
    if (path === undefined || TEST_FILE_PATTERN.test(path)) return {};

    const reportedNodes = new WeakSet<ESTree.Node>();
    const report = (node: ESTree.Node, summary: string) => {
      if (reportedNodes.has(node)) return;
      reportedNodes.add(node);
      const kind = node.type;
      const fingerprint = normalizeFingerprint(context.sourceCode.text.slice(node.start, node.end));
      const ledgered = ledger.has({ path, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;

      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    };

    const isGlobalObserver = (node: unknown): boolean => {
      const callee = unwrapExpression(node);
      if (Option.isNone(callee)) return false;
      if (callee.value.type === "Identifier") {
        if (callee.value.name !== "IntersectionObserver") return false;
        const variable = resolveVariable(context, callee.value);
        return (
          variable === undefined || (variable.scope.type === "global" && variable.defs.length === 0)
        );
      }
      if (callee.value.type !== "MemberExpression") return false;
      if (Option.getOrUndefined(getPropertyName(callee.value.property)) !== "IntersectionObserver")
        return false;
      const object = unwrapExpression(callee.value.object);
      return (
        Option.isSome(object) &&
        object.value.type === "Identifier" &&
        GLOBAL_OBJECTS.has(object.value.name)
      );
    };

    const checkText = (node: ESTree.Node, value: string) => {
      if (CONTENT_VISIBILITY_AUTO_PATTERN.test(value)) report(node, CONTENT_VISIBILITY_SUMMARY);
    };

    return {
      NewExpression(node) {
        if (path !== RESTING_OBSERVER && isGlobalObserver(node.callee)) {
          report(node, OBSERVER_SUMMARY);
        }
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "loading") return;
        if (staticStringValue(node.value)?.trim().toLowerCase() === "lazy") {
          report(node, LAZY_SUMMARY);
        }
      },
      Property(node) {
        if (node.computed && node.key.type !== "Literal") return;
        const key = Option.getOrUndefined(getPropertyName(node.key));
        if (isContentVisibilityName(key) && isAuto(node.value)) {
          report(node, CONTENT_VISIBILITY_SUMMARY);
        }
      },
      AssignmentExpression(node) {
        const target = unwrapExpression(node.left);
        if (Option.isNone(target) || target.value.type !== "MemberExpression") return;
        const property = Option.getOrUndefined(getPropertyName(target.value.property));
        if (target.value.computed && target.value.property.type !== "Literal") return;
        if (property === "loading" && staticStringValue(node.right)?.trim() === "lazy") {
          report(node, LAZY_SUMMARY);
        }
        if (isContentVisibilityName(property) && isAuto(node.right)) {
          report(node, CONTENT_VISIBILITY_SUMMARY);
        }
      },
      CallExpression(node) {
        const callee = unwrapExpression(node.callee);
        if (
          Option.isNone(callee) ||
          callee.value.type !== "MemberExpression" ||
          Option.getOrUndefined(getPropertyName(callee.value.property)) !== "setProperty"
        ) {
          return;
        }
        if (
          isContentVisibilityName(staticStringValue(node.arguments[0])) &&
          isAuto(node.arguments[1])
        ) {
          report(node, CONTENT_VISIBILITY_SUMMARY);
        }
      },
      Literal(node) {
        if (typeof node.value === "string") checkText(node, node.value);
      },
      TemplateElement(node) {
        checkText(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
});
