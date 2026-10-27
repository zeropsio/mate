import { defineRule, type ESTree } from "@oxlint/plugins";
import { plugin as shadcn } from "@shadcn/lint";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "./exceptions.ts";

/**
 * Runs one of upstream's `@shadcn/lint` rules as a fork guard: the options upstream configures
 * are baked in, the rule scopes itself by path (the guard driver runs rules on every client
 * root), and each finding goes through the design-system exception ledger, so today's call
 * sites are fingerprinted exceptions rather than a blanket opt-out and a new one fails lint.
 */
export interface ShadcnGuardRuleConfig {
  /** The fork rule's name, which is also its ledger's file name. */
  readonly ruleName: string;
  /** The upstream rule inside `@shadcn/lint`. */
  readonly innerRuleName: keyof typeof shadcn.rules;
  /** Points the rule at a fixture ledger directory in tests. */
  readonly ledgerDirectoryEnv: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly inScope: (normalizedFilename: string) => boolean;
  readonly description: string;
}

const SHADCN_SETTINGS = { shadcn: { ui: "~/components/ui" } };
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

export const WEB_SOURCE_MARKER = "/apps/web/src/";
export const UI_SOURCE_MARKER = "/apps/web/src/components/ui/";

export const normalizeGuardFilename = (filename: string): string =>
  `/${filename.replaceAll("\\", "/")}`;

export const createShadcnGuardRule = (config: ShadcnGuardRuleConfig) => {
  const inner = shadcn.rules[config.innerRuleName];
  const innerMessages: Readonly<Record<string, string>> = inner.meta.messages;
  const ledger = loadExceptionLedger(
    config.ruleName,
    globalThis.process.env[config.ledgerDirectoryEnv],
  );

  return defineRule({
    meta: { type: "problem", docs: { description: config.description } },
    create(context) {
      if (!config.inScope(normalizeGuardFilename(context.filename))) return {};

      const report = (descriptor: InnerDescriptor) => {
        const node = descriptor.node;
        if (node === undefined) return;
        const data = descriptor.data ?? {};
        const summary =
          descriptor.message ??
          (descriptor.messageId === undefined
            ? `${config.innerRuleName} finding`
            : interpolate(innerMessages[descriptor.messageId] ?? descriptor.messageId, data));
        const kind = node.type;
        // The component and the class name the finding, the normalized source pins where it sits.
        const fingerprint = normalizeFingerprint(
          `<${String(data.component ?? "")}> ${String(data.className ?? "")} in ${context.sourceCode.text.slice(node.start, node.end)}`,
        );
        const ledgered = ledger.has({ path: context.filename, kind, fingerprint });
        if (ledgered && !shouldReportLedgered()) return;
        context.report({
          node,
          message: formatFindingMessage({
            ruleName: config.ruleName,
            summary,
            kind,
            fingerprint,
            ledgered,
          }),
        });
      };

      // Exactly the context surface the upstream rules read; oxlint's own context keeps `report`,
      // `options` and `settings` non-configurable, so it cannot be wrapped in place.
      const innerContext = {
        physicalFilename: context.physicalFilename,
        getFilename: () => context.filename,
        cwd: context.cwd,
        sourceCode: context.sourceCode,
        options: [config.options],
        settings: SHADCN_SETTINGS,
        report,
      };
      return inner.create(innerContext);
    },
  });
};
