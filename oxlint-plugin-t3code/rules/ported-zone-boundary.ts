// @effect-diagnostics nodeBuiltinImport:off -- Oxlint resolves module paths synchronously.
import * as NodePath from "node:path";
import { defineRule, type ESTree } from "@oxlint/plugins";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "../..");
const SPI_DIR = "apps/server/src/spi";
const PROVIDER_DIR = "apps/server/src/provider";

// SPI wraps provider drivers. A driver can reach these profiles and tools because
// their relative imports stay within this same set.
const SPI_INBOUND_FILES: ReadonlySet<string> = new Set([
  `${SPI_DIR}/threadToolPolicy.ts`,
  `${SPI_DIR}/claudeThreadProfile.ts`,
  `${SPI_DIR}/codexThreadProfile.ts`,
  `${SPI_DIR}/acpThreadProfile.ts`,
  `${SPI_DIR}/threadToolsMcp.ts`,
  `${SPI_DIR}/openCodeThreadProfile.ts`,
  `${SPI_DIR}/mcpControl.ts`,
  `${SPI_DIR}/mcpToolTitle.ts`,
  `${SPI_DIR}/responseUsage.ts`,
]);

// TextGeneration resolves its ProviderInstanceId to a live instance through this service tag.
const ALLOWED_PROVIDER_IMPORT_FILES: ReadonlySet<string> = new Set([
  "apps/server/src/provider/Services/ProviderInstanceRegistry.ts",
]);
const KNOWN_OWNED_PRODUCT_PROVIDER_VIOLATIONS: ReadonlySet<string> = new Set();

const isProviderService = (name: ESTree.ModuleExportName | null): boolean =>
  name !== null && (name.type === "Identifier" ? name.name : name.value) === "ProviderService";

export default defineRule({
  meta: {
    type: "problem",
    docs: { description: "Enforce the ported provider zone and the server's SPI boundary." },
  },
  create(context) {
    const file = NodePath.relative(REPO_ROOT, context.filename).replaceAll("\\", "/");
    if (!/\.tsx?$/u.test(file) || /\/(?:node_modules|dist|dist-electron)\//u.test(file)) return {};

    const driver = file.startsWith(`${PROVIDER_DIR}/`);
    const ported =
      driver ||
      file.startsWith("packages/effect-codex-app-server/") ||
      file.startsWith("packages/effect-acp/") ||
      /^packages\/contracts\/src\/provider[^/]*\.ts$/u.test(file);
    const inbound = SPI_INBOUND_FILES.has(file);
    const owned = file.startsWith("apps/server/src/zerops/");
    const consumer =
      file.startsWith("apps/server/src/textGeneration/") ||
      file.startsWith("apps/server/src/usage/");
    if (!ported && !inbound && !owned && !consumer) return {};

    const directory = NodePath.dirname(context.filename);
    function check(source: ESTree.Node | null, bindsProviderService = false) {
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      const specifier = source.value;
      const report = (message: string) =>
        context.report({ node: source, message: `${file}: ${message} (${specifier}).` });
      if (ported && /zerops/iu.test(specifier)) {
        report("The ported zone must stay Zerops-free");
      }
      const relative = specifier.startsWith(".");
      const target = NodePath.relative(
        REPO_ROOT,
        NodePath.resolve(directory, specifier),
      ).replaceAll("\\", "/");
      if (
        relative &&
        (inbound || (driver && target.startsWith(`${SPI_DIR}/`))) &&
        !SPI_INBOUND_FILES.has(target)
      ) {
        report(
          "Provider drivers may reach only the inbound SPI files, whose relative imports must stay within that set",
        );
      }
      const providerPath = specifier.includes("/provider/");
      if (
        owned &&
        (providerPath || bindsProviderService) &&
        !KNOWN_OWNED_PRODUCT_PROVIDER_VIOLATIONS.has(file)
      ) {
        report("Zerops product code must reach provider internals through SPI");
      }
      if (consumer && providerPath && !ALLOWED_PROVIDER_IMPORT_FILES.has(target)) {
        report(
          "Text generation and usage may reach provider internals only through SPI or the listed service tag",
        );
      }
    }

    return {
      Program(node) {
        if (owned && context.sourceCode.text.includes("payload.data")) {
          context.report({
            node,
            message: `${file}: Read event.toolCall through SPI instead of payload.data.`,
          });
        }
      },
      ImportDeclaration(node) {
        check(
          node.source,
          node.specifiers.some(
            (binding) =>
              isProviderService(binding.local) ||
              (binding.type === "ImportSpecifier" && isProviderService(binding.imported)),
          ),
        );
      },
      ExportNamedDeclaration(node) {
        if (!node.source) return;
        check(
          node.source,
          node.specifiers.some(
            (binding) => isProviderService(binding.local) || isProviderService(binding.exported),
          ),
        );
      },
      ExportAllDeclaration: (node) => check(node.source, isProviderService(node.exported)),
      ImportExpression: (node) => check(node.source),
      TSImportType: (node) => check(node.source),
    };
  },
});
