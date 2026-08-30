// The zone map (methodology §3): the fork imports two upstream packages
// byte-identically (pinned by imported.lock, scripts/imported-lock.ts) and
// ports the provider drivers behind an adapter SPI. This test machine-checks
// the two import-direction invariants that make those zones meaningful:
// the ported zone must stay Zerops-free, and owned product must reach
// providers only through the (not-yet-built) SPI, never their internals
// directly. No AST — small source scans over import and re-export syntax are
// enough for these checks.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";

const repoRootUrl = new URL("..", import.meta.url);
const repoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(repoRootUrl)),
);

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_DIRECTORY_NAMES = new Set(["node_modules", "dist", "dist-electron"]);
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

function collectTsFiles(
  root: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    if (!(yield* fs.exists(root))) {
      return [];
    }

    const rootStat = yield* fs.stat(root);
    if (rootStat.type === "File") {
      return TS_EXTENSIONS.has(path.extname(root)) ? [root] : [];
    }

    const entries = yield* fs.readDirectory(root);
    const files: Array<string> = [];
    for (const entry of entries) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry)) {
        continue;
      }
      const entryPath = path.join(root, entry);
      const entryStat = yield* fs.stat(entryPath);
      if (entryStat.type === "Directory") {
        files.push(...(yield* collectTsFiles(entryPath)));
      } else if (entryStat.type === "File" && TS_EXTENSIONS.has(path.extname(entry))) {
        files.push(entryPath);
      }
    }
    return files;
  });
}

// packages/contracts/src/provider*.ts names direct children only, not a
// recursive tree.
const collectProviderContractFiles = Effect.fn("collectProviderContractFiles")(function* (
  root: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const contractsSrcDir = path.join(root, "packages/contracts/src");
  const entries = yield* fs.readDirectory(contractsSrcDir);
  return entries
    .filter((name) => /^provider.*\.ts$/.test(name))
    .map((name) => path.join(contractsSrcDir, name));
});

interface ImportStatement {
  readonly clause: string;
  readonly reexport: boolean;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

// `[^;]*?` (not `.*?`) so a multi-line brace clause is captured whole: import
// clauses never contain a semicolon, so this cannot run past the statement.
const STATIC_IMPORT_PATTERN = /import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_PATTERN = /import\s*["']([^"']+)["']/g;
const REEXPORT_PATTERN = /export\s+(type\s+)?(\*|\{[^;]*?\})\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_CALL_PATTERN = /\bimport\s*\(\s*([^)]*?)\s*\)/gs;
const IMPORT_ASSIGNMENT_PATTERN = /\bimport\s+(?:type\s+)?[A-Za-z_$][\w$]*\s*=\s*require\s*\(/g;

function isBracedTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }
  const bindings = trimmed
    .slice(1, -1)
    .split(",")
    .map((binding) => binding.trim())
    .filter((binding) => binding.length > 0);
  return bindings.length > 0 && bindings.every((binding) => /^type\s+/u.test(binding));
}

function isPlainStringLiteral(value: string): boolean {
  if (value.length < 2) {
    return false;
  }
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) {
    return false;
  }
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];
    if (character === "\\") {
      index += 1;
    } else if (character === quote || character === "\n" || character === "\r") {
      return false;
    }
  }
  return true;
}

function collectDynamicImportArguments(source: string): ReadonlyArray<string> {
  return [...source.matchAll(DYNAMIC_IMPORT_CALL_PATTERN)].map((match) => match[1]!.trim());
}

function collectImportStatements(source: string): ReadonlyArray<ImportStatement> {
  const statements: Array<ImportStatement> = [];
  for (const match of source.matchAll(STATIC_IMPORT_PATTERN)) {
    const clause = match[2] ?? "";
    statements.push({
      clause,
      reexport: false,
      specifier: match[3]!,
      typeOnly: match[1] !== undefined || isBracedTypeOnlyClause(clause),
    });
  }
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT_PATTERN)) {
    statements.push({ clause: "", reexport: false, specifier: match[1]!, typeOnly: false });
  }
  for (const match of source.matchAll(REEXPORT_PATTERN)) {
    const clause = match[2] ?? "";
    statements.push({
      clause,
      reexport: true,
      specifier: match[3]!,
      typeOnly: match[1] !== undefined || isBracedTypeOnlyClause(clause),
    });
  }
  for (const argument of collectDynamicImportArguments(source)) {
    if (isPlainStringLiteral(argument)) {
      statements.push({
        clause: "",
        reexport: false,
        specifier: argument.slice(1, -1),
        typeOnly: false,
      });
    }
  }
  return statements;
}

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

interface ImportViolation {
  readonly file: string;
  readonly specifier: string;
}

interface SourceFile {
  readonly file: string;
  readonly source: string;
}

const UI_IMPORT_PREFIXES = [
  "react",
  "react-dom",
  "react-native",
  "expo",
  "expo-",
  "@effect/atom-react",
] as const;

function collectUiImportViolations(
  files: ReadonlyArray<SourceFile>,
): ReadonlyArray<ImportViolation> {
  const violations: Array<ImportViolation> = [];
  for (const file of files) {
    for (const { specifier } of collectImportStatements(file.source)) {
      if (UI_IMPORT_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
        violations.push({ file: file.file, specifier });
      }
    }
  }
  return violations;
}

// Keep this list identical to t3code/no-infinite-motion's protected roots.
const PROTECTED_ROOTS = [
  "apps/web/src/components/zerops/ZeropsServiceMap.tsx",
  "apps/web/src/components/zerops/ZeropsLifecycleStrip.tsx",
  "apps/web/src/components/zerops/ZeropsToolCard.tsx",
  "apps/web/src/components/zerops/ZeropsQuickActions.tsx",
] as const;

const FORBIDDEN_PROTECTED_MODULES = new Map<string, string>([
  ["apps/web/src/zerops/commands.ts", "reviewed Zerops RPC command atoms"],
  ["apps/web/src/state/zeropsCommands.ts", "application Zerops command atoms"],
  ["apps/web/src/state/use-atom-command.ts", "write-only atom command runner"],
  ["apps/web/src/zerops/useAgentLogin.ts", "starts a server-side agent login"],
  ["apps/web/src/zerops/useAgentLoginCancel.ts", "cancels a server-side agent login"],
  ["apps/web/src/zerops/ZeropsSessionProvider.tsx", "mutates the Zerops platform session"],
  ["apps/web/src/zerops/useZeropsProvisioning.ts", "creates a Zerops project"],
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
  "zeropsTopologyGet",
  "zeropsTopologyRefresh",
  "zeropsLifecycleGet",
  "subscribeZeropsTopology",
  "subscribeZeropsLifecycle",
  "subscribeZeropsAgentAuth",
]);
const PROTECTED_WS_ALLOWED_COMMAND_METHODS = new Set([
  "zeropsAgentLoginStart",
  "zeropsAgentLoginCancel",
]);

const SHARED_RUNTIME_READ_SCOPE_METHODS = new Map<string, ReadonlySet<string>>([
  // The shared atom runtime installs this reporter. The server authors these methods as AuthOrchestrationReadScope in RpcAuthorization.ts:52,92,93.
  [
    "apps/web/src/lib/backgroundActivityReporter.ts",
    new Set(["subscribeResourceTelemetry", "subscribeVcsStatus", "serverReportClientActivity"]),
  ],
]);

const LATENCY_CLASSIFICATION_ONLY_OPERATE_METHODS = new Map<string, ReadonlySet<string>>([
  // These operate-scope tokens appear only as latency-classification Set members at requestLatencyState.ts:31,33–35, never as calls.
  [
    "apps/web/src/rpc/requestLatencyState.ts",
    new Set([
      "previewAutomationConnect",
      "serverUpdateProvider",
      "serverRefreshProviders",
      "serverUpdateServer",
    ]),
  ],
]);

interface ProtectedRootViolation {
  readonly root: string;
  readonly file: string;
  readonly reason: string;
}

function walkProtectedRoot(
  rootFile: string,
  webSrcDir: string,
): Effect.Effect<
  ReadonlyArray<ProtectedRootViolation>,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const rootDir = path.resolve(webSrcDir, "../../..");
    const clientRuntimeDir = path.join(rootDir, "packages/client-runtime");
    const clientRuntimeSrcDir = path.join(clientRuntimeDir, "src");
    const clientRuntimePackageJson = decodeUnknownJson(
      yield* fs.readFileString(path.join(clientRuntimeDir, "package.json")),
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

    const moduleLabel = (file: string): string => path.relative(rootDir, file);
    const root = moduleLabel(rootFile);
    const scannedFiles = new Set<string>();
    const visitedTraversals = new Set<string>();
    const violations: Array<ProtectedRootViolation> = [];

    const resolveLocalModule = Effect.fn("resolveProtectedLocalModule")(function* (
      fromFile: string,
      specifier: string,
    ) {
      const unresolved = specifier.startsWith("~/")
        ? path.join(webSrcDir, specifier.slice(2))
        : specifier.startsWith(".")
          ? path.resolve(path.dirname(fromFile), specifier)
          : specifier.startsWith("@t3tools/client-runtime/")
            ? (() => {
                const subpath = `.${specifier.slice("@t3tools/client-runtime".length)}`;
                const target = packageExports.get(subpath);
                if (target === undefined) {
                  return undefined;
                }
                const targetPath = path.resolve(clientRuntimeDir, target);
                const relativeTarget = path.relative(clientRuntimeSrcDir, targetPath);
                return relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`)
                  ? undefined
                  : targetPath;
              })()
            : undefined;
      if (unresolved === undefined) {
        return undefined;
      }

      // Match the web resolver: source files precede directory indexes, and
      // `.ts` precedes `.tsx` when an extensionless specifier has both.
      const candidates = TS_EXTENSIONS.has(path.extname(unresolved))
        ? [unresolved]
        : [
            `${unresolved}.ts`,
            `${unresolved}.tsx`,
            path.join(unresolved, "index.ts"),
            path.join(unresolved, "index.tsx"),
          ];
      for (const candidate of candidates) {
        if (yield* fs.exists(candidate)) {
          return candidate;
        }
      }
      return undefined;
    });

    const exportProviderCache = new Map<string, boolean>();
    const moduleProvidesExport: (
      file: string,
      exportName: string,
      trail: ReadonlySet<string>,
    ) => Effect.Effect<boolean, PlatformError, FileSystem.FileSystem | Path.Path> = Effect.fn(
      "protectedModuleProvidesExport",
    )(function* (file: string, exportName: string, trail: ReadonlySet<string>) {
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
      const source = yield* fs.readFileString(file);
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
        const importedFile = yield* resolveLocalModule(file, statement.specifier);
        if (importedFile === undefined) {
          continue;
        }
        if (statement.clause === "*") {
          if (yield* moduleProvidesExport(importedFile, exportName, nextTrail)) {
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
    });

    const visit: (
      file: string,
      requestedExports?: ReadonlySet<string>,
    ) => Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> = Effect.fn(
      "visitProtectedModule",
    )(function* (file: string, requestedExports?: ReadonlySet<string>) {
      const traversalKey = `${file}\0${
        requestedExports === undefined ? "*" : [...requestedExports].sort().join(",")
      }`;
      if (visitedTraversals.has(traversalKey)) {
        return;
      }
      visitedTraversals.add(traversalKey);

      const fileLabel = moduleLabel(file);
      const source = yield* fs.readFileString(file);
      if (!scannedFiles.has(file)) {
        scannedFiles.add(file);
        /**
         * Rule 6 applies the forbidden-binding and WS_METHODS checks to every
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
          violations.push({ root, file: fileLabel, reason: forbiddenModuleReason });
        }

        if (source.includes("zerops.io")) {
          violations.push({
            root,
            file: fileLabel,
            reason: "contains the Zerops API host literal zerops.io",
          });
        }

        for (const argument of collectDynamicImportArguments(source)) {
          if (!isPlainStringLiteral(argument)) {
            violations.push({
              root,
              file: fileLabel,
              reason: "dynamic import argument is not a plain string literal",
            });
          }
        }

        const importAssignmentCount = source.match(IMPORT_ASSIGNMENT_PATTERN)?.length ?? 0;
        for (let index = 0; index < importAssignmentCount; index += 1) {
          violations.push({
            root,
            file: fileLabel,
            reason: "TypeScript import assignments are not allowed in protected graphs",
          });
        }

        if (checksProtectedCommandVocabulary) {
          for (const [binding, reason] of FORBIDDEN_PROTECTED_BINDING_NAMES) {
            if (new RegExp(`\\b${binding}\\b`, "u").test(source)) {
              violations.push({ root, file: fileLabel, reason });
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
              violations.push({
                root,
                file: fileLabel,
                reason: `WS_METHODS.${method} is not in the reviewed read or allowed-command set`,
              });
            }
          }
        }
      }

      for (const statement of collectImportStatements(source)) {
        const isClientRuntimePackageSpecifier = statement.specifier.startsWith(
          "@t3tools/client-runtime/",
        );
        const importedFile = yield* resolveLocalModule(file, statement.specifier);
        if (isClientRuntimePackageSpecifier && importedFile === undefined) {
          violations.push({ root, file: fileLabel, reason: "unresolved package subpath" });
          continue;
        }
        if (statement.typeOnly) {
          continue;
        }

        const forbiddenPackageReason = FORBIDDEN_PROTECTED_PACKAGE_SPECIFIERS.get(
          statement.specifier,
        );
        if (forbiddenPackageReason !== undefined) {
          violations.push({ root, file: fileLabel, reason: forbiddenPackageReason });
          continue;
        }

        if (importedFile !== undefined) {
          if (statement.reexport && requestedExports !== undefined) {
            if (statement.clause === "*") {
              const providedExports = new Set<string>();
              for (const exportName of requestedExports) {
                if (yield* moduleProvidesExport(importedFile, exportName, new Set())) {
                  providedExports.add(exportName);
                }
              }
              if (providedExports.size > 0) {
                yield* visit(importedFile, providedExports);
              }
            } else {
              const requestedSources = requestedReexportSources(statement.clause, requestedExports);
              if (requestedSources.size > 0) {
                yield* visit(importedFile, requestedSources);
              }
            }
          } else {
            yield* visit(
              importedFile,
              isClientRuntimePackageSpecifier
                ? requestedRuntimeExports(statement.clause)
                : undefined,
            );
          }
        }
      }
    });

    yield* visit(rootFile);
    return violations;
  });
}

const makeProtectedRootFixture = Effect.fn("makeProtectedRootFixture")(function* (
  files: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fixtureRoot = yield* fs.makeTempDirectoryScoped({ prefix: "z3-protected-root-" });
  const webSrcDir = path.join(fixtureRoot, "apps/web/src");
  for (const [relativePath, source] of Object.entries(files)) {
    const file = path.join(webSrcDir, relativePath);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, source);
  }
  const packageJson = path.join(fixtureRoot, "packages/client-runtime/package.json");
  if (!(yield* fs.exists(packageJson))) {
    yield* fs.makeDirectory(path.dirname(packageJson), { recursive: true });
    yield* fs.writeFileString(packageJson, encodeUnknownJson({ exports: {} }));
  }
  return {
    rootFile: path.join(webSrcDir, "components/Root.tsx"),
    webSrcDir,
  };
});

it.layer(NodeServices.layer)("z3 zone architecture", (it) => {
  it.effect("collects UI imports from client-runtime Zerops fixtures", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* fs.makeTempDirectoryScoped({ prefix: "z3-ui-imports-" });
      const fixtureFile = path.join(fixtureRoot, "packages/client-runtime/src/zerops/probe.ts");
      yield* fs.makeDirectory(path.dirname(fixtureFile), { recursive: true });
      yield* fs.writeFileString(
        fixtureFile,
        'import { renderToStaticMarkup } from "react-dom/server";\n',
      );

      const files = yield* collectTsFiles(
        path.join(fixtureRoot, "packages/client-runtime/src/zerops"),
      );
      const sources = [];
      for (const file of files) {
        sources.push({
          file: path.relative(fixtureRoot, file),
          source: yield* fs.readFileString(file),
        });
      }

      assert.deepStrictEqual(collectUiImportViolations(sources), [
        {
          file: "packages/client-runtime/src/zerops/probe.ts",
          specifier: "react-dom/server",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("ported zone (imported + provider drivers) imports nothing matching zerops", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* repoRoot;

      const targets = [
        ...(yield* collectTsFiles(path.join(root, "apps/server/src/provider"))),
        ...(yield* collectTsFiles(path.join(root, "packages/effect-codex-app-server"))),
        ...(yield* collectTsFiles(path.join(root, "packages/effect-acp"))),
        ...(yield* collectProviderContractFiles(root)),
      ];
      // A silently empty scan would make this test vacuously pass — assert
      // the zone paths still resolve to real files instead of trusting an
      // empty diff.
      assert.isAbove(targets.length, 0, "the ported-zone scan found no files; did a path move?");

      const violations: Array<ImportViolation> = [];
      for (const file of targets) {
        const source = yield* fs.readFileString(file);
        for (const { specifier } of collectImportStatements(source)) {
          if (/zerops/i.test(specifier)) {
            violations.push({ file: path.relative(root, file), specifier });
          }
        }
      }

      assert.deepStrictEqual(violations, []);
    }),
  );

  it.effect("client-runtime zerops is UI-free and platform-free", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* repoRoot;
      const files = yield* collectTsFiles(path.join(root, "packages/client-runtime/src/zerops"));
      assert.isAbove(
        files.length,
        0,
        "the client-runtime Zerops scan found no files; did the directory move?",
      );

      const sources: Array<SourceFile> = [];
      for (const file of files) {
        sources.push({ file: path.relative(root, file), source: yield* fs.readFileString(file) });
      }

      assert.deepStrictEqual(collectUiImportViolations(sources), []);
    }),
  );

  it.effect(
    "owned product (apps/server/src/zerops) reaches provider internals only at the known pre-SPI violations",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        // Two ways in: a path into the provider directory (`~/provider/` or
        // `../provider/`, at any depth), or binding the `ProviderService`
        // identifier itself (e.g. if it were ever re-exported from
        // elsewhere). A bare text mention — a comment naming
        // `ProviderService.streamEvents` — must NOT trip this: only import
        // clauses are scanned, not prose.
        function importsProviderInternals(statement: ImportStatement): boolean {
          return (
            statement.specifier.includes("/provider/") ||
            /\bProviderService\b/.test(statement.clause)
          );
        }

        // Emptied by the SPI slice (methodology §3.2): the lifecycle/topology
        // feeds now reach providers only through
        // apps/server/src/spi/ProviderRuntimeEventBus.ts, and
        // ZeropsPolicy.test.ts's incidental ProviderRegistry dependency goes
        // through apps/server/src/spi/ProviderRegistryTest.ts. A new
        // violation anywhere in apps/server/src/zerops/** still fails here.
        const KNOWN_OWNED_PRODUCT_PROVIDER_VIOLATIONS: ReadonlyArray<string> = [];

        const zeropsDir = path.join(root, "apps/server/src/zerops");
        const files = yield* collectTsFiles(zeropsDir);
        assert.isAbove(
          files.length,
          0,
          "the owned-product scan found no files; did the zerops dir move?",
        );

        const violations = new Set<string>();
        for (const file of files) {
          const source = yield* fs.readFileString(file);
          if (collectImportStatements(source).some(importsProviderInternals)) {
            violations.add(path.relative(root, file));
          }
        }

        assert.deepStrictEqual([...violations].sort(), KNOWN_OWNED_PRODUCT_PROVIDER_VIOLATIONS);
      }),
  );

  it.effect(
    "textGeneration/ and usage/ reach provider internals only through spi/, never directly",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        // The sole sanctioned service-tag file (methodology §3.2, SPI-5):
        // `ProviderInstanceRegistry` is how `TextGeneration.ts` resolves a
        // `ProviderInstanceId` to its live instance — the same seam
        // `ProviderRuntimeEventBus`/`ProviderRegistryTest` are for
        // `apps/server/src/zerops/**`. Every other provider-internal need
        // (driver home/launch-arg resolution, ACP session surfaces, the
        // OpenCode runtime, the Claude model/effort catalog) is wrapped by
        // an owned, typed capability under `apps/server/src/spi/`. Listed
        // explicitly, no wildcard: a second file needing this exception is
        // a new decision, not an automatic grant.
        const ALLOWED_PROVIDER_IMPORT_FILES: ReadonlySet<string> = new Set([
          path.join(root, "apps/server/src/provider/Services/ProviderInstanceRegistry.ts"),
        ]);

        function isAllowedProviderImport(fromFile: string, specifier: string): boolean {
          if (!specifier.includes("/provider/")) {
            return true;
          }
          const resolved = path.resolve(path.dirname(fromFile), specifier);
          return ALLOWED_PROVIDER_IMPORT_FILES.has(resolved);
        }

        const targets = [
          ...(yield* collectTsFiles(path.join(root, "apps/server/src/textGeneration"))),
          ...(yield* collectTsFiles(path.join(root, "apps/server/src/usage"))),
        ];
        assert.isAbove(
          targets.length,
          0,
          "the textGeneration/usage scan found no files; did a path move?",
        );

        const violations: Array<ImportViolation> = [];
        for (const file of targets) {
          const source = yield* fs.readFileString(file);
          for (const { specifier } of collectImportStatements(source)) {
            if (!isAllowedProviderImport(file, specifier)) {
              violations.push({ file: path.relative(root, file), specifier });
            }
          }
        }

        assert.deepStrictEqual(violations, []);
      }),
  );

  it.effect(
    "owned product (apps/server/src/zerops) never reads payload.data — the SPI's toolCall enrichment is the only reader (SPI-4)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        // A literal text scan, not an import check: the whole point of the
        // SPI-4 boundary (`apps/server/src/spi/toolCall.ts`) is that
        // `payload.data` — a driver's raw, per-provider item shape — is read
        // in exactly ONE owned place. Every consumer under
        // `apps/server/src/zerops/**` reads `event.toolCall` instead
        // (`packages/contracts/src/providerRuntimeSpi.ts`). A hit here means
        // a new call site started shape-dispatching on `payload.data` again.
        const zeropsDir = path.join(root, "apps/server/src/zerops");
        const files = yield* collectTsFiles(zeropsDir);
        assert.isAbove(
          files.length,
          0,
          "the owned-product scan found no files; did the zerops dir move?",
        );

        const violations: Array<string> = [];
        for (const file of files) {
          const source = yield* fs.readFileString(file);
          if (source.includes("payload.data")) {
            violations.push(path.relative(root, file));
          }
        }

        assert.deepStrictEqual(violations, []);
      }),
  );

  it.effect("protected roots render only", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* repoRoot;
      const webSrcDir = path.join(root, "apps/web/src");

      const violations: Array<ProtectedRootViolation> = [];
      for (const protectedRoot of PROTECTED_ROOTS) {
        const rootFile = path.join(root, protectedRoot);
        assert.isTrue(
          yield* fs.exists(rootFile),
          `protected root ${protectedRoot} does not exist; did it move?`,
        );
        violations.push(...(yield* walkProtectedRoot(rootFile, webSrcDir)));
      }

      assert.deepStrictEqual(violations, []);
    }),
  );

  it.effect("protected root walker follows transitive write modules", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": 'import { hook } from "./hook";\nexport const Root = hook;\n',
        "components/hook.ts":
          'import { command } from "../zerops/commands";\nexport const hook = command;\n',
        "zerops/commands.ts": "export const command = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/zerops/commands.ts",
          reason: "reviewed Zerops RPC command atoms",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker accepts reviewed read WS methods", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": [
          "export const subscription = WS_METHODS.subscribeZeropsTopology;",
          "export const refresh = WS_METHODS.zeropsTopologyRefresh;",
        ].join("\n"),
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects unreviewed WS methods", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": "export const write = WS_METHODS.terminalWrite;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "WS_METHODS.terminalWrite is not in the reviewed read or allowed-command set",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker skips type-only edges", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import type { command } from "../zerops/commands";\nexport type Root = typeof command;\n',
        "zerops/commands.ts": "export const command = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker resolves aliases and extensionless relative imports", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { x } from "~/lib/x";\nimport { y } from "../y";\nexport const Root = [x, y];\n',
        "lib/x.ts": 'export const x = "https://api.zerops.io";\n',
        "y.ts": 'export const y = "https://api.zerops.io";\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/lib/x.ts",
          reason: "contains the Zerops API host literal zerops.io",
        },
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/y.ts",
          reason: "contains the Zerops API host literal zerops.io",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects a transitive forbidden package specifier", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": 'import { hook } from "./hook";\nexport const Root = hook;\n',
        "components/hook.ts":
          'import { client } from "@t3tools/client-runtime/zerops";\nexport const hook = client;\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./zerops": {
              default: "./src/zerops/index.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/zerops/index.ts": "export const client = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/hook.ts",
          reason: "the Zerops platform REST client can mutate projects",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "protected root walker follows a value import of a client-runtime subpath and applies the host-literal check there",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeProtectedRootFixture({
          "components/Root.tsx":
            'import { value } from "@t3tools/client-runtime/zerops/probe";\nexport const Root = value;\n',
          "../../../packages/client-runtime/package.json": encodeUnknownJson({
            exports: {
              "./zerops/probe": {
                default: "./src/zerops/probe.ts",
              },
            },
          }),
          "../../../packages/client-runtime/src/zerops/probe.ts":
            'export const value = "https://api.zerops.io";\n',
        });

        const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

        assert.deepStrictEqual(violations, [
          {
            root: "apps/web/src/components/Root.tsx",
            file: "packages/client-runtime/src/zerops/probe.ts",
            reason: "contains the Zerops API host literal zerops.io",
          },
        ]);
      }).pipe(Effect.scoped),
  );

  it.effect("protected root walker does not follow a type-only client-runtime subpath import", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import type { Value } from "@t3tools/client-runtime/zerops/probe";\nexport type Root = Value;\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./zerops/probe": {
              default: "./src/zerops/probe.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/zerops/probe.ts":
          'export type Value = "https://api.zerops.io";\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects an unmapped type-only client-runtime subpath", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import type { Value } from "@t3tools/client-runtime/nope";\nexport type Root = Value;\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "unresolved package subpath",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker vets forbidden bindings in mapped Zerops targets", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { value } from "@t3tools/client-runtime/zerops/probe";\nexport const Root = value;\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./zerops/probe": {
              default: "./src/zerops/probe.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/zerops/probe.ts":
          "export const value = ZeropsApiClient;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "packages/client-runtime/src/zerops/probe.ts",
          reason: "the Zerops platform REST client can mutate projects",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker trusts command vocabulary in mapped runtime core targets", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { environment } from "@t3tools/client-runtime/environment";\nexport const Root = environment;\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./environment": {
              default: "./src/environment.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/environment.ts":
          "export const environment = createEnvironmentRpcCommand;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker applies host and dynamic-import checks in runtime core", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { environment } from "@t3tools/client-runtime/environment";\nexport const Root = environment;\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./environment": {
              default: "./src/environment.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/environment.ts":
          'export { environment } from "./environmentValue.ts";\n',
        "../../../packages/client-runtime/src/environmentValue.ts":
          'export const environment = "https://api.zerops.io";\nexport const lazy = import(`./${part}.ts`);\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "packages/client-runtime/src/environmentValue.ts",
          reason: "contains the Zerops API host literal zerops.io",
        },
        {
          root: "apps/web/src/components/Root.tsx",
          file: "packages/client-runtime/src/environmentValue.ts",
          reason: "dynamic import argument is not a plain string literal",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects every unmapped client-runtime subpath", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { value } from "@t3tools/client-runtime/zeropsX";\nexport const Root = value;\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "unresolved package subpath",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "protected root walker resolves client-runtime subpaths through the package exports map",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeProtectedRootFixture({
          "components/Root.tsx": [
            'import { mapped } from "@t3tools/client-runtime/zerops/mapped";',
            'import { missing } from "@t3tools/client-runtime/zerops/missing";',
            "export const Root = [mapped, missing];",
          ].join("\n"),
          "../../../packages/client-runtime/package.json": encodeUnknownJson({
            exports: {
              "./zerops/mapped": {
                import: "./src/zerops/mapped.ts",
              },
            },
          }),
          "../../../packages/client-runtime/src/zerops/mapped.ts":
            'export const mapped = "safe";\n',
        });

        const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

        assert.deepStrictEqual(violations, [
          {
            root: "apps/web/src/components/Root.tsx",
            file: "apps/web/src/components/Root.tsx",
            reason: "unresolved package subpath",
          },
        ]);
      }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects forbidden namespace property access", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import * as Runtime from "@t3tools/client-runtime/state/runtime";\nexport const Root = Runtime.createEnvironmentRpcCommand(runtime, options);\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./state/runtime": {
              default: "./src/state/runtime.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/state/runtime.ts": "export const safe = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "constructs an environment RPC command",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker follows export-star chains", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { command } from "./barrel";\nexport const Root = command;\n',
        "components/barrel.ts": 'export * from "../zerops/commands";\n',
        "zerops/commands.ts": "export const command = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/zerops/commands.ts",
          reason: "reviewed Zerops RPC command atoms",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker follows named re-export chains", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { renamed } from "./barrel";\nexport const Root = renamed;\n',
        "components/barrel.ts": 'export { command as renamed } from "../zerops/commands";\n',
        "zerops/commands.ts": "export const command = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/zerops/commands.ts",
          reason: "reviewed Zerops RPC command atoms",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker skips type-only re-export chains", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": 'export type { Command } from "../zerops/commands";\n',
        "zerops/commands.ts": "export interface Command { readonly value: string }\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects template-literal dynamic imports", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": "export const Root = import(`../zerops/${moduleName}`);\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "dynamic import argument is not a plain string literal",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker follows quoted dynamic imports", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": 'export const Root = import("../zerops/commands");\n',
        "zerops/commands.ts": "export const command = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/zerops/commands.ts",
          reason: "reviewed Zerops RPC command atoms",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker resolves alias directory indexes", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": 'import { value } from "~/dir";\nexport const Root = value;\n',
        "dir/index.ts": 'export const value = "https://api.zerops.io";\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/dir/index.ts",
          reason: "contains the Zerops API host literal zerops.io",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker scopes WS token exceptions by file", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { tracked } from "../rpc/requestLatencyState";\nimport { invoked } from "../rpc/invoker";\nexport const Root = [tracked, invoked];\n',
        "rpc/requestLatencyState.ts":
          "export const tracked = WS_METHODS.previewAutomationConnect;\n",
        "rpc/invoker.ts": "export const invoked = WS_METHODS.previewAutomationConnect;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/rpc/invoker.ts",
          reason:
            "WS_METHODS.previewAutomationConnect is not in the reviewed read or allowed-command set",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker prefers a TypeScript sibling before TSX", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { value } from "../lib/value";\nexport const Root = value;\n',
        "lib/value.ts": 'export const value = "static";\n',
        "lib/value.tsx": 'export const value = "https://api.zerops.io";\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects import assignments", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import Runtime = require("@t3tools/client-runtime/state/runtime");\nexport const Root = Runtime;\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "TypeScript import assignments are not allowed in protected graphs",
        },
      ]);
    }).pipe(Effect.scoped),
  );
});
