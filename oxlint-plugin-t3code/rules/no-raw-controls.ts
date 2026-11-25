import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "no-raw-controls";
const LEDGER_DIRECTORY_ENV = "T3CODE_RAW_CONTROLS_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit draws its controls; its own pages are the kit's. */
const OWNS_ITS_CONTROLS = /^apps\/web\/src\/(?:components\/ui|kit)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

/** What a person presses, follows or types into, and the kit export that draws it. */
const KIT_CONTROL: ReadonlyMap<string, string> = new Map([
  ["button", "Button (InlineButton for a word in a sentence)"],
  ["a", "InlineButton or Button rendered as the anchor (render={<a href=… />})"],
  ["input", "Input"],
  ["textarea", "Textarea"],
  ["select", "Select"],
]);

/** Inputs nobody sees: a file picker the kit opens, a form's hidden value. */
const UNSEEN_INPUT_TYPES = new Set(["file", "hidden"]);

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return OWNS_ITS_CONTROLS.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/**
 * An element handed to a `render` prop (`<Button render={<a href=… />}>`): the holder draws it, the
 * element only names what it renders as. One that carries its own `className` draws itself — a
 * hand-styled press under a trigger (`<TooltipTrigger render={<button className=… />}>`) — and is
 * reported like any other; the trigger renders the kit's Button instead.
 */
const renderedByTheKit = (node: ESTree.JSXOpeningElement): boolean => {
  const container = node.parent?.parent;
  const holder = container?.type === "JSXExpressionContainer" ? container.parent : undefined;
  return (
    holder?.type === "JSXAttribute" &&
    holder.name.type === "JSXIdentifier" &&
    holder.name.name === "render"
  );
};

const attribute = (node: ESTree.JSXOpeningElement, name: string) =>
  node.attributes.find(
    (candidate): candidate is ESTree.JSXAttribute =>
      candidate.type === "JSXAttribute" &&
      candidate.name.type === "JSXIdentifier" &&
      candidate.name.name === name,
  );

/**
 * A press, link or field drawn by hand beside the kit's. Each is the kit's export; one that must
 * stay hand-made names why in the ledger, which only shrinks.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hand-made buttons, links and fields in the web client; draw them with components/ui.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const element = node.name.name;
        const kit = KIT_CONTROL.get(element);
        if (kit === undefined) return;
        const type = attribute(node, "type");
        if (
          element === "input" &&
          type?.value?.type === "Literal" &&
          UNSEEN_INPUT_TYPES.has(String(type.value.value))
        ) {
          return;
        }
        const className = attribute(node, "className");
        if (className === undefined && renderedByTheKit(node)) return;
        const fingerprint = normalizeFingerprint(
          className === undefined
            ? `<${element}>`
            : `<${element}> ${context.sourceCode.getText(className)}`,
        );
        const kind = node.type;
        const ledgered = ledger.has({ path, kind, fingerprint });
        if (ledgered && !shouldReportLedgered()) return;
        context.report({
          node,
          message: formatFindingMessage({
            ruleName: RULE_NAME,
            summary: `A hand-made <${element}>: draw it with the kit's ${kit}.`,
            kind,
            fingerprint,
            ledgered,
          }),
        });
      },
    };
  },
});
