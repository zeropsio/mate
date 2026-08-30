// The zone map (methodology §3): the fork imports two upstream packages
// byte-identically (pinned by imported.lock, scripts/imported-lock.ts) and
// ports the provider drivers behind an adapter SPI. This test machine-checks
// the two import-direction invariants that make those zones meaningful:
// the ported zone must stay Zerops-free, and owned product must reach
// providers only through the (not-yet-built) SPI, never their internals
// directly. No AST — a regex over `import ... from "..."` / `import(...)`
// is enough for both checks.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";

const repoRootUrl = new URL("..", import.meta.url);
const repoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(repoRootUrl)),
);

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_DIRECTORY_NAMES = new Set(["node_modules", "dist", "dist-electron"]);

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
  readonly specifier: string;
}

// `[^;]*?` (not `.*?`) so a multi-line brace clause is captured whole: import
// clauses never contain a semicolon, so this cannot run past the statement.
const STATIC_IMPORT_PATTERN = /import\s+(?:type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_PATTERN = /import\(\s*["']([^"']+)["']\s*\)/g;

function collectImportStatements(source: string): ReadonlyArray<ImportStatement> {
  const statements: Array<ImportStatement> = [];
  for (const match of source.matchAll(STATIC_IMPORT_PATTERN)) {
    statements.push({ clause: match[1] ?? "", specifier: match[2]! });
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT_PATTERN)) {
    statements.push({ clause: "", specifier: match[1]! });
  }
  return statements;
}

interface ImportViolation {
  readonly file: string;
  readonly specifier: string;
}

it.layer(NodeServices.layer)("z3 zone architecture", (it) => {
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
        const ALLOWED_PROVIDER_IMPORT_FILES: ReadonlyArray<string> = [
          path.join(root, "apps/server/src/provider/Services/ProviderInstanceRegistry.ts"),
        ];

        function isAllowedProviderImport(fromFile: string, specifier: string): boolean {
          if (!specifier.includes("/provider/")) {
            return true;
          }
          const resolved = path.resolve(path.dirname(fromFile), specifier);
          return ALLOWED_PROVIDER_IMPORT_FILES.includes(resolved);
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
});
