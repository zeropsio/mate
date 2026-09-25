import { defineRule, type ESTree } from "@oxlint/plugins";
import { plugin as shadcn } from "@shadcn/lint";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

/**
 * `components/ui` exports own their look: app code picks a variant or size instead of restyling
 * one with `className`. This is upstream's `shadcn/no-restyle` (from `@shadcn/lint`) with the
 * options upstream configures, run behind the design-system exception ledger so the call sites
 * that still restyle a ui export — upstream's leftovers and the fork's own surfaces — are
 * fingerprinted exceptions rather than a blanket opt-out, and a new one fails lint.
 */
const RULE_NAME = "no-restyle";
const LEDGER_DIRECTORY_ENV = "T3CODE_NO_RESTYLE_LEDGER_DIRECTORY";
const WEB_SOURCE_MARKER = "/apps/web/src/";
const UI_SOURCE_MARKER = "/apps/web/src/components/ui/";

/**
 * Layout classes (width, flex, margin, position) stay allowed because placement belongs to the
 * parent. Contracts widen that per component where the className is the component's API.
 */
export const NO_RESTYLE_OPTIONS = {
  allow: ["layout"],
  contracts: [] as Array<{ readonly pattern: string; readonly allow: ReadonlyArray<string> }>,
};

const SHADCN_SETTINGS = { shadcn: { ui: "~/components/ui" } };

const inner = shadcn.rules["no-restyle"];
const innerMessages: Readonly<Record<string, string>> = inner.meta.messages;

const ledgerDirectory = globalThis.process.env[LEDGER_DIRECTORY_ENV];
const ledger = loadExceptionLedger(RULE_NAME, ledgerDirectory);

const PLACEHOLDER = /\{\{\s*([\w$]+)\s*\}\}/gu;

const interpolate = (template: string, data: Readonly<Record<string, unknown>>): string =>
  template.replace(PLACEHOLDER, (match, key: string) =>
    Object.hasOwn(data, key) ? String(data[key] ?? "") : match,
  );

interface InnerDescriptor {
  readonly node?: ESTree.Node;
  readonly message?: string;
  readonly messageId?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

const inScope = (filename: string): boolean => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  return normalized.includes(WEB_SOURCE_MARKER) && !normalized.includes(UI_SOURCE_MARKER);
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "components/ui exports own their look: pick a variant or size instead of restyling with className, with fingerprinted exceptions for existing call sites.",
    },
  },
  create(context) {
    if (!inScope(context.filename)) return {};

    const report = (descriptor: InnerDescriptor) => {
      const node = descriptor.node;
      if (node === undefined) return;
      const data = descriptor.data ?? {};
      const summary =
        descriptor.message ??
        (descriptor.messageId === undefined
          ? "components/ui export restyled with className"
          : interpolate(innerMessages[descriptor.messageId] ?? descriptor.messageId, data));
      const kind = node.type;
      // One finding per offending class: the component and the class name the finding, the
      // normalized class string pins where it sits.
      const fingerprint = normalizeFingerprint(
        `<${String(data.component ?? "")}> ${String(data.className ?? "")} in ${context.sourceCode.text.slice(node.start, node.end)}`,
      );
      const ledgered = ledger.has({ path: context.filename, kind, fingerprint });
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

    // Exactly the context surface the upstream rule reads; oxlint's own context keeps `report`,
    // `options` and `settings` non-configurable, so it cannot be wrapped in place.
    const innerContext = {
      physicalFilename: context.physicalFilename,
      getFilename: () => context.filename,
      cwd: context.cwd,
      sourceCode: context.sourceCode,
      options: [NO_RESTYLE_OPTIONS],
      settings: SHADCN_SETTINGS,
      report,
    };
    return inner.create(innerContext);
  },
});
