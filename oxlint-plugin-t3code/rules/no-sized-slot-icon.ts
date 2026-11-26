import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

const RULE_NAME = "no-sized-slot-icon";
const LEDGER_DIRECTORY_ENV = "T3CODE_NO_SIZED_SLOT_ICON_LEDGER_DIRECTORY";
const SCOPE_MARKER = "/apps/web/src/";
/** The kit sizes its own icons; the design harness stages the app. */
const OWNS_ITS_ICONS = /^apps\/web\/src\/(?:components\/ui|kit|design)\//u;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

/** Kit pieces that size an icon standing directly inside them, by their own size. */
const SIZES_ITS_ICONS = new Set([
  "Badge",
  "Button",
  "InlineButton",
  "MenuCheckboxItem",
  "MenuItem",
  "MenuRadioItem",
  "MenuSubTrigger",
]);

/** A size utility, under any variant. */
const SIZE_CLASS = /^(?:[^:\s]+:)*size-/u;

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return OWNS_ITS_ICONS.test(path) || TEST_FILE_PATTERN.test(path) ? undefined : path;
};

const nameOf = (element: ESTree.JSXOpeningElement): string | undefined =>
  element.name.type === "JSXIdentifier" ? element.name.name : undefined;

const sizedClassName = (element: ESTree.JSXOpeningElement): ESTree.JSXAttribute | undefined => {
  const className = element.attributes.find(
    (candidate): candidate is ESTree.JSXAttribute =>
      candidate.type === "JSXAttribute" &&
      candidate.name.type === "JSXIdentifier" &&
      candidate.name.name === "className",
  );
  if (className?.value?.type !== "Literal" || typeof className.value.value !== "string") {
    return undefined;
  }
  return className.value.value.split(/\s+/u).some((name) => SIZE_CLASS.test(name))
    ? className
    : undefined;
};

/**
 * A lucide icon given a size where a kit piece already sizes it: a `Row`'s lead, or an icon
 * standing directly inside a `Button`, an `InlineButton` (the size of its words), a `Badge` or a
 * menu item. The piece sizes the
 * icon by its own size (one size per slot, `design-system.md`), so an icon there names none.
 * Other icons (a file's type, a product's logo) draw themselves and are not reported.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow sizing a lucide icon where a kit piece already sizes it (a Row's lead, a Button, an InlineButton, a Badge, a menu item).",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    const lucide = new Set<string>();
    const report = (icon: ESTree.JSXOpeningElement, slot: string) => {
      const className = sizedClassName(icon);
      if (className === undefined) return;
      const fingerprint = normalizeFingerprint(
        `<${nameOf(icon)}> in ${slot} ${context.sourceCode.getText(className)}`,
      );
      const kind = icon.type;
      const ledgered = ledger.has({ path, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;
      context.report({
        node: icon,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary: `${slot} sizes this icon: drop its size class.`,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    };
    const lucideIcon = (node: ESTree.Node | null | undefined) =>
      node?.type === "JSXElement" &&
      node.openingElement.name.type === "JSXIdentifier" &&
      lucide.has(node.openingElement.name.name)
        ? node.openingElement
        : undefined;
    return {
      ImportDeclaration(node: ESTree.ImportDeclaration) {
        if (node.source.value !== "lucide-react") return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") lucide.add(specifier.local.name);
        }
      },
      JSXElement(node: ESTree.JSXElement) {
        const name = nameOf(node.openingElement);
        if (name === undefined) return;
        if (name === "Row") {
          const lead = node.openingElement.attributes.find(
            (candidate): candidate is ESTree.JSXAttribute =>
              candidate.type === "JSXAttribute" &&
              candidate.name.type === "JSXIdentifier" &&
              candidate.name.name === "lead",
          );
          if (lead?.value?.type !== "JSXExpressionContainer") return;
          const icon = lucideIcon(lead.value.expression as ESTree.Node);
          if (icon !== undefined) report(icon, "Row's lead");
          return;
        }
        if (!SIZES_ITS_ICONS.has(name)) return;
        for (const child of node.children) {
          const icon = lucideIcon(child as ESTree.Node);
          if (icon !== undefined) report(icon, name);
        }
      },
    };
  },
});
