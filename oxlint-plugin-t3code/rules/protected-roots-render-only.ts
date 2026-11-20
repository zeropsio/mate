// @effect-diagnostics nodeBuiltinImport:off -- Oxlint follows the protected roots' value imports synchronously.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { defineRule } from "@oxlint/plugins";
import { formatFindingMessage, loadExceptionLedger, shouldReportLedgered } from "../exceptions.ts";
import {
  collectDynamicImportArguments,
  collectImportStatements,
  IMPORT_ASSIGNMENT_PATTERN,
  isPlainStringLiteral,
} from "../zoneSource.ts";
import { PROTECTED_ROOTS } from "./no-infinite-motion.ts";

const RULE_NAME = "protected-roots-render-only";
const ledger = loadExceptionLedger(RULE_NAME);

interface ExportBinding {
  readonly exported: string;
  readonly source: string;
  readonly typeOnly: boolean;
}

function collectExportBindings(clause: string): ReadonlyArray<ExportBinding> {
  const trimmed = clause.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return [];
  }
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((binding) => binding.trim())
    .filter((binding) => binding.length > 0)
    .map((binding) => {
      const typeOnly = binding.startsWith("type ");
      const valueBinding = typeOnly ? binding.slice("type ".length).trim() : binding;
      const [source, exported = source] = valueBinding.split(/\s+as\s+/u);
      return { exported: exported!, source: source!, typeOnly };
    });
}

function requestedRuntimeExports(clause: string): ReadonlySet<string> | undefined {
  const trimmed = clause.trim();
  if (trimmed === "" || trimmed.startsWith("*")) {
    return undefined;
  }

  const requested = new Set<string>();
  const braceStart = trimmed.indexOf("{");
  if (braceStart === -1) {
    requested.add("default");
  } else {
    if (trimmed.slice(0, braceStart).replace(/,$/u, "").trim() !== "") {
      requested.add("default");
    }
    const braceEnd = trimmed.lastIndexOf("}");
    for (const binding of collectExportBindings(trimmed.slice(braceStart, braceEnd + 1))) {
      if (!binding.typeOnly) {
        requested.add(binding.source);
      }
    }
  }
  return requested.size === 0 ? undefined : requested;
}

function requestedReexportSources(
  clause: string,
  requestedExports: ReadonlySet<string>,
): ReadonlySet<string> {
  const requestedSources = new Set<string>();
  for (const binding of collectExportBindings(clause)) {
    if (!binding.typeOnly && requestedExports.has(binding.exported)) {
      requestedSources.add(binding.source);
    }
  }
  return requestedSources;
}

const FORBIDDEN_PROTECTED_MODULES = new Map<string, string>([
  ["apps/web/src/zerops/commands.ts", "reviewed Zerops RPC command atoms"],
  ["apps/web/src/state/zeropsCommands.ts", "application Zerops command atoms"],
  ["apps/web/src/state/use-atom-command.ts", "write-only atom command runner"],
  ["apps/web/src/zerops/useAgentLogin.ts", "starts a server-side agent login"],
  ["apps/web/src/zerops/useAgentLoginCancel.ts", "cancels a server-side agent login"],
  ["apps/web/src/zerops/ZeropsSessionProvider.tsx", "mutates the Zerops platform session"],
  [
    "apps/web/src/zerops/matePress.ts",
    "mints a Mate's key, imports its container, closes its project off and registers it",
  ],
  [
    "apps/web/src/components/zerops/ZeropsProjectsPage.tsx",
    "creates projects and restarts services",
  ],
]);

const FORBIDDEN_PROTECTED_PACKAGE_SPECIFIERS = new Map<string, string>([
  ["@t3tools/client-runtime/zerops", "the Zerops platform REST client can mutate projects"],
]);

const FORBIDDEN_PROTECTED_BINDING_NAMES = new Map<string, string>([
  ["createEnvironmentRpcCommand", "constructs an environment RPC command"],
  ["runAtomCommand", "runs an atom command"],
  ["useAtomCommand", "runs an atom command from React"],
  ["ZeropsApiClient", "the Zerops platform REST client can mutate projects"],
]);

// Mirrors apps/server/src/auth/RpcAuthorization.ts:94–107. Mutability is
// authored there and is never inferred from a `subscribe` prefix or verb.
const PROTECTED_WS_READ_METHODS = new Set([
  "zeropsLifecycleGet",
  "subscribeZeropsLifecycle",
  "subscribeZeropsAgentAuth",
  "subscribeZeropsBrowserStream",
]);
const PROTECTED_WS_ALLOWED_COMMAND_METHODS = new Set([
  "zeropsAgentLoginStart",
  "zeropsAgentLoginCancel",
  "zeropsAgentLoginSubmitCode",
]);

const SHARED_RUNTIME_READ_SCOPE_METHODS = new Map<string, ReadonlySet<string>>([
  // The shared atom runtime installs this reporter. The server authors these methods as AuthOrchestrationReadScope in RpcAuthorization.ts:52,92,93.
  [
    "apps/web/src/lib/backgroundActivityReporter.ts",
    new Set(["subscribeResourceTelemetry", "subscribeVcsStatus", "serverReportClientActivity"]),
  ],
]);

const LATENCY_CLASSIFICATION_ONLY_OPERATE_METHODS = new Map<string, ReadonlySet<string>>([
  // These operate-scope tokens appear only as latency-classification Set members at requestLatencyState.ts:33–35, never as calls.
  [
    "apps/web/src/rpc/requestLatencyState.ts",
    new Set(["serverUpdateProvider", "serverRefreshProviders", "serverUpdateServer"]),
  ],
]);

function walkProtectedRoot(
  rootDir: string,
  rootFile: string,
  report: (file: string, reason: string) => void,
) {
  const webSrcDir = NodePath.join(rootDir, "apps/web/src");
  const clientRuntimeDir = NodePath.join(rootDir, "packages/client-runtime");
  const clientRuntimeSrcDir = NodePath.join(clientRuntimeDir, "src");
  const clientRuntimePackageJson: unknown = JSON.parse(
    NodeFS.readFileSync(NodePath.join(clientRuntimeDir, "package.json"), "utf8"),
  );
  const packageExports = new Map<string, string>();
  if (
    typeof clientRuntimePackageJson === "object" &&
    clientRuntimePackageJson !== null &&
    "exports" in clientRuntimePackageJson &&
    typeof clientRuntimePackageJson.exports === "object" &&
    clientRuntimePackageJson.exports !== null
  ) {
    for (const [subpath, conditions] of Object.entries(clientRuntimePackageJson.exports)) {
      if (typeof conditions === "string") {
        packageExports.set(subpath, conditions);
        continue;
      }
      if (typeof conditions !== "object" || conditions === null) {
        continue;
      }
      const target =
        "default" in conditions && typeof conditions.default === "string"
          ? conditions.default
          : "import" in conditions && typeof conditions.import === "string"
            ? conditions.import
            : undefined;
      if (target !== undefined) {
        packageExports.set(subpath, target);
      }
    }
  }

  const moduleLabel = (file: string): string =>
    NodePath.relative(rootDir, file).split(NodePath.sep).join("/");
  const scannedFiles = new Set<string>();
  const visitedTraversals = new Set<string>();

  function resolveLocalModule(fromFile: string, specifier: string): string | undefined {
    let unresolved: string;
    if (specifier.startsWith("~/")) {
      unresolved = NodePath.join(webSrcDir, specifier.slice(2));
    } else if (specifier.startsWith(".")) {
      unresolved = NodePath.resolve(NodePath.dirname(fromFile), specifier);
    } else if (specifier.startsWith("@t3tools/client-runtime/")) {
      const target = packageExports.get(`.${specifier.slice("@t3tools/client-runtime".length)}`);
      if (target === undefined) return undefined;
      unresolved = NodePath.resolve(clientRuntimeDir, target);
      const relativeTarget = NodePath.relative(clientRuntimeSrcDir, unresolved);
      if (relativeTarget === ".." || relativeTarget.startsWith(`..${NodePath.sep}`))
        return undefined;
    } else {
      return undefined;
    }
    // A stylesheet or another asset is no module: nothing in it renders or reads.
    if (/\.(css|svg|png|jpe?g|webp|woff2?)$/u.test(unresolved)) {
      return undefined;
    }

    // Match the web resolver: source files precede directory indexes, and
    // `.ts` precedes `.tsx` when an extensionless specifier has both.
    const candidates = /\.tsx?$/u.test(unresolved)
      ? [unresolved]
      : [
          `${unresolved}.ts`,
          `${unresolved}.tsx`,
          NodePath.join(unresolved, "index.ts"),
          NodePath.join(unresolved, "index.tsx"),
        ];
    return candidates.find((candidate) => NodeFS.existsSync(candidate));
  }

  const exportProviderCache = new Map<string, boolean>();
  function moduleProvidesExport(
    file: string,
    exportName: string,
    trail: ReadonlySet<string>,
  ): boolean {
    const cacheKey = `${file}\0${exportName}`;
    const cached = exportProviderCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    if (trail.has(cacheKey)) {
      return false;
    }

    const nextTrail = new Set(trail);
    nextTrail.add(cacheKey);
    const source = NodeFS.readFileSync(file, "utf8");
    const escapedExportName = exportName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (
      new RegExp(
        `\\bexport\\s+(?:async\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${escapedExportName}\\b`,
        "u",
      ).test(source) ||
      (exportName === "default" && /\bexport\s+default\b/u.test(source))
    ) {
      exportProviderCache.set(cacheKey, true);
      return true;
    }

    for (const statement of collectImportStatements(source)) {
      if (!statement.reexport || statement.typeOnly) {
        continue;
      }
      const importedFile = resolveLocalModule(file, statement.specifier);
      if (importedFile === undefined) {
        continue;
      }
      if (statement.clause === "*") {
        if (moduleProvidesExport(importedFile, exportName, nextTrail)) {
          exportProviderCache.set(cacheKey, true);
          return true;
        }
        continue;
      }
      if (
        collectExportBindings(statement.clause).some(
          (binding) => !binding.typeOnly && binding.exported === exportName,
        )
      ) {
        exportProviderCache.set(cacheKey, true);
        return true;
      }
    }

    exportProviderCache.set(cacheKey, false);
    return false;
  }

  function visit(file: string, requestedExports?: ReadonlySet<string>) {
    const traversalKey = `${file}\0${
      requestedExports === undefined ? "*" : [...requestedExports].sort().join(",")
    }`;
    if (visitedTraversals.has(traversalKey)) {
      return;
    }
    visitedTraversals.add(traversalKey);

    const fileLabel = moduleLabel(file);
    const source = NodeFS.readFileSync(file, "utf8");
    if (!scannedFiles.has(file)) {
      scannedFiles.add(file);
      /**
       * The guard applies the forbidden-binding and WS_METHODS checks to every
       * web file and every `packages/client-runtime/src/zerops/**` target.
       * The client-runtime core is trusted infrastructure that protected
       * roots reach only for subscriptions; host-literal, dynamic-import,
       * and import-assignment checks still apply to every core target and
       * relative edge.
       */
      const checksProtectedCommandVocabulary =
        fileLabel.startsWith("apps/web/src/") ||
        fileLabel.startsWith("packages/client-runtime/src/zerops/");
      const forbiddenModuleReason = FORBIDDEN_PROTECTED_MODULES.get(fileLabel);
      if (forbiddenModuleReason !== undefined) {
        report(fileLabel, forbiddenModuleReason);
      }

      if (source.includes("zerops.io")) {
        report(fileLabel, "contains the Zerops API host literal zerops.io");
      }

      for (const argument of collectDynamicImportArguments(source)) {
        if (!isPlainStringLiteral(argument)) {
          report(fileLabel, "dynamic import argument is not a plain string literal");
        }
      }

      const importAssignmentCount = source.match(IMPORT_ASSIGNMENT_PATTERN)?.length ?? 0;
      for (let index = 0; index < importAssignmentCount; index += 1) {
        report(fileLabel, "TypeScript import assignments are not allowed in protected graphs");
      }

      if (checksProtectedCommandVocabulary) {
        for (const [binding, reason] of FORBIDDEN_PROTECTED_BINDING_NAMES) {
          if (new RegExp(`\\b${binding}\\b`, "u").test(source)) {
            report(fileLabel, reason);
          }
        }

        for (const match of source.matchAll(/\bWS_METHODS\.([A-Za-z0-9_]+)/g)) {
          const method = match[1]!;
          if (
            !PROTECTED_WS_READ_METHODS.has(method) &&
            !PROTECTED_WS_ALLOWED_COMMAND_METHODS.has(method) &&
            !SHARED_RUNTIME_READ_SCOPE_METHODS.get(fileLabel)?.has(method) &&
            !LATENCY_CLASSIFICATION_ONLY_OPERATE_METHODS.get(fileLabel)?.has(method)
          ) {
            report(
              fileLabel,
              `WS_METHODS.${method} is not in the reviewed read or allowed-command set`,
            );
          }
        }
      }
    }

    for (const statement of collectImportStatements(source)) {
      const isClientRuntimePackageSpecifier = statement.specifier.startsWith(
        "@t3tools/client-runtime/",
      );
      const importedFile = resolveLocalModule(file, statement.specifier);
      if (isClientRuntimePackageSpecifier && importedFile === undefined) {
        report(fileLabel, "unresolved package subpath");
        continue;
      }
      if (statement.typeOnly) {
        continue;
      }

      const forbiddenPackageReason = FORBIDDEN_PROTECTED_PACKAGE_SPECIFIERS.get(
        statement.specifier,
      );
      if (forbiddenPackageReason !== undefined) {
        report(fileLabel, forbiddenPackageReason);
        continue;
      }

      if (importedFile !== undefined) {
        if (statement.reexport && requestedExports !== undefined) {
          if (statement.clause === "*") {
            const providedExports = new Set<string>();
            for (const exportName of requestedExports) {
              if (moduleProvidesExport(importedFile, exportName, new Set())) {
                providedExports.add(exportName);
              }
            }
            if (providedExports.size > 0) {
              visit(importedFile, providedExports);
            }
          } else {
            const requestedSources = requestedReexportSources(statement.clause, requestedExports);
            if (requestedSources.size > 0) {
              visit(importedFile, requestedSources);
            }
          }
        } else {
          visit(
            importedFile,
            isClientRuntimePackageSpecifier ? requestedRuntimeExports(statement.clause) : undefined,
          );
        }
      }
    }
  }

  visit(rootFile);
}

export default defineRule({
  meta: {
    type: "problem",
    docs: { description: "Protected roots render only through their whole value-import graph." },
  },
  create(context) {
    const filename = NodePath.resolve(context.filename);
    const path = /(?:^|\/)(apps\/web\/src\/.+)$/u.exec(filename.replaceAll("\\", "/"))?.[1];
    if (!path || !PROTECTED_ROOTS.has(path)) return {};
    return {
      Program(node) {
        walkProtectedRoot(filename.slice(0, -path.length), filename, (file, reason) => {
          const kind = "protected-import-graph";
          const fingerprint = `${file} ${reason}`;
          const ledgered = ledger.has({ path, kind, fingerprint });
          if (ledgered && !shouldReportLedgered()) return;
          context.report({
            node,
            message: formatFindingMessage({
              ruleName: RULE_NAME,
              kind,
              fingerprint,
              summary: `${path} reaches ${file}: ${reason}.`,
              ledgered,
            }),
          });
        });
      },
    };
  },
});
