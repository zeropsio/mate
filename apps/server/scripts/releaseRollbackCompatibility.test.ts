import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  READ_BACK_CONTRACTS,
  type RollbackEvidence,
  RUNTIME_DECLARATION,
  RUNTIME_DEPENDENCIES,
  UPDATE_PROTOCOL,
  contractFingerprints,
  rollbackBlocker,
  rollbackCompatibility,
  readRollbackCompatibility,
} from "./releaseRollbackCompatibility.ts";

/** `packages/shared` hq* modules, nested directories included: HQ wire schemas versioned by HQ. */
const HQ_WIRE_MODULES = "packages/shared/src/hq";

const previousPackage = JSON.stringify({
  name: "zerops-mate",
  version: "0.15.0",
  dependencies: { effect: "4.0.1" },
});

const lock = (options: {
  readonly runtime: string;
  readonly dev: string;
  readonly bundled?: string;
  readonly web?: string;
}) => `
lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      vitest:
        specifier: ^1
        version: ${options.dev}
  apps/server:
    dependencies:
      effect:
        specifier: 4.0.1
        version: 4.0.1
    devDependencies:
      '@t3tools/shared':
        specifier: workspace:*
        version: link:../../packages/shared
      '@t3tools/web':
        specifier: workspace:*
        version: link:../web
      vitest:
        specifier: ^1
        version: ${options.dev}
  apps/web:
    dependencies:
      '@t3tools/shared':
        specifier: workspace:*
        version: link:../../packages/shared
      react:
        specifier: ^19
        version: ${options.web ?? "19.0.0"}
  packages/shared:
    dependencies:
      jose:
        specifier: ^6
        version: ${options.bundled ?? "6.0.0"}
snapshots:
  jose@6.0.0: {}
  jose@6.0.1: {}
  react@19.0.0: {}
  react@19.0.1: {}
  effect@4.0.1:
    dependencies:
      leaf: ${options.runtime}
  leaf@1.0.0: {}
  leaf@1.0.1: {}
  vitest@1.0.0: {}
  vitest@1.0.1: {}
`;
const baseLock = lock({ runtime: "1.0.0", dev: "1.0.0" });

const SCHEMA_IMPORT = 'import * as Schema from "effect/Schema";\n';
const row = (name: string) => `export const ${name} = Schema.Struct({ id: Schema.String });\n`;

/**
 * A release tree in which every read-back contract root is declared, the stored settings shape
 * reached through a workspace package import.
 */
const baseline: Readonly<Record<string, string>> = (() => {
  const files: Record<string, string> = {
    "apps/server/package.json": previousPackage,
    "apps/server/update-protocol.json": '{"protocol":1}',
    "pnpm-lock.yaml": baseLock,
    "packages/contracts/package.json": JSON.stringify({
      name: "@t3tools/contracts",
      exports: { "./settings": { import: "./src/settings.ts" } },
    }),
    "packages/contracts/src/settings.ts": SCHEMA_IMPORT + row("ServerSettings"),
  };
  for (const { roots } of READ_BACK_CONTRACTS)
    for (const [path, selector] of roots) {
      if (path.endsWith("/")) files[`${path}Rows.ts`] = SCHEMA_IMPORT + row("Rows");
      else
        files[path] =
          (files[path] ?? SCHEMA_IMPORT) +
          (typeof selector === "string"
            ? row("Shape")
            : selector.map((name) => `export const ${name} = 1;\n`).join(""));
    }
  files["apps/server/src/serverSettings.ts"] +=
    'import { ServerSettings } from "@t3tools/contracts/settings";\n' +
    "export const decodeServerSettings = Schema.decodeUnknownEffect(ServerSettings);\n";
  return files;
})();

/** The baseline with `path` changed: a declaration's value or shape, or a new stored row module. */
const changed = (path: string, files = baseline): Record<string, string> => {
  if (path === "pnpm-lock.yaml")
    return { ...files, [path]: lock({ runtime: "1.0.1", dev: "1.0.0" }) };
  const source = files[path];
  if (source === undefined) return { ...files, [path]: SCHEMA_IMPORT + row("Next") };
  const next = source.includes("Schema.String")
    ? source.replace("Schema.String", "Schema.Number")
    : source.replace("= 1;", "= 2;");
  return { ...files, [path]: next };
};

/** The baseline with `path` edited or added as code that declares nothing a contract reaches. */
const touched = (...paths: ReadonlyArray<string>): Record<string, string> => ({
  ...baseline,
  ...Object.fromEntries(
    paths.map((path) => [path, `${baseline[path] ?? ""}export const touched = 2;\n`]),
  ),
});

const fingerprintsOf = (files: Readonly<Record<string, string>>) =>
  contractFingerprints({
    paths: new Set(Object.keys(files)),
    read: (path) => Effect.succeed(files[path]),
  });
/** The step from v0.15.0 with the previous files to 0.15.1 with the current ones. */
const stepBetween = Effect.fnUntraced(function* (
  previousFiles: Readonly<Record<string, string>>,
  currentFiles: Readonly<Record<string, string>>,
) {
  return {
    previousTag: "v0.15.0",
    candidateVersion: "0.15.1",
    ancestor: true,
    previous: yield* fingerprintsOf(previousFiles),
    current: yield* fingerprintsOf(currentFiles),
  } satisfies RollbackEvidence;
});
/** The step from the baseline release to one with these files. */
const step = (files: Readonly<Record<string, string>> = baseline) => stepBetween(baseline, files);
const patched = (patch: (evidence: RollbackEvidence) => RollbackEvidence) =>
  Effect.map(step(), patch);

const writeTree = Effect.fnUntraced(function* (
  root: string,
  files: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const [file, content] of Object.entries(files)) {
    yield* fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true });
    yield* fs.writeFileString(path.join(root, file), content);
  }
});

describe("a release may update automatically only inside its proved rollback range", () => {
  it.effect(
    "reads the last stable ancestor and permits a UI release until persisted server behavior changes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped();
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const git = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
          expect(
            yield* spawner.exitCode(
              ChildProcess.make("git", args, { cwd: root, stdout: "ignore", stderr: "ignore" }),
            ),
          ).toBe(0);
        });
        yield* writeTree(root, baseline);
        yield* git(["init", "--quiet"]);
        yield* git(["config", "user.name", "Mate release gate test"]);
        yield* git(["config", "user.email", "mate-release-test@example.invalid"]);
        yield* git(["add", "."]);
        yield* git(["commit", "--quiet", "-m", "updater baseline"]);
        yield* git(["tag", "v0.15.0"]);
        yield* writeTree(root, {
          "apps/server/package.json": previousPackage.replace("0.15.0", "0.15.1"),
          "apps/web/copy.ts": "new copy",
        });
        yield* git(["add", "."]);
        yield* git(["commit", "--quiet", "-m", "UI release"]);
        expect(yield* readRollbackCompatibility(["v0.15.0"], "0.15.1", root)).toEqual({
          rollbackCompatible: true,
          compatibleFrom: "0.15.0",
        });
        const state = "apps/server/src/engine/domain/state.ts";
        yield* writeTree(root, { [state]: changed(state)[state]! });
        yield* git(["add", "."]);
        yield* git(["commit", "--quiet", "-m", "persisted format change"]);
        expect(yield* readRollbackCompatibility(["v0.15.0"], "0.15.1", root)).toEqual({
          rollbackCompatible: false,
        });
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
  it.effect("sibling version-only releases prove ancestry through their main source commits", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const git = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
        expect(
          yield* spawner.exitCode(
            ChildProcess.make("git", args, { cwd: root, stdout: "ignore", stderr: "ignore" }),
          ),
        ).toBe(0);
      });
      const files = [
        "apps/server/package.json",
        "apps/desktop/package.json",
        "apps/web/package.json",
      ];
      yield* writeTree(root, baseline);
      for (const file of files) yield* writeTree(root, { [file]: previousPackage });
      yield* git(["init", "--quiet", "--initial-branch=main"]);
      yield* git(["config", "user.name", "Release source test"]);
      yield* git(["config", "user.email", "release@example.invalid"]);
      yield* git(["add", "."]);
      yield* git(["commit", "--quiet", "-m", "source baseline"]);
      yield* git(["checkout", "--quiet", "--detach"]);
      for (const file of files)
        yield* fs.writeFileString(
          path.join(root, file),
          previousPackage.replace("0.15.0", "0.15.1"),
        );
      yield* git(["add", "."]);
      yield* git(["commit", "--quiet", "-m", "chore(release): mate 0.15.1"]);
      yield* git(["tag", "v0.15.1"]);
      yield* git(["checkout", "--quiet", "main"]);
      yield* writeTree(root, { "apps/web/copy.ts": "new copy" });
      yield* git(["add", "."]);
      yield* git(["commit", "--quiet", "-m", "UI change"]);
      yield* git(["checkout", "--quiet", "--detach"]);
      for (const file of files)
        yield* fs.writeFileString(
          path.join(root, file),
          previousPackage.replace("0.15.0", "0.15.2"),
        );
      yield* git(["add", "."]);
      yield* git(["commit", "--quiet", "-m", "chore(release): mate 0.15.2"]);
      expect(
        yield* readRollbackCompatibility(["v0.15.1"], "0.15.2", root),
        "ASSERTION: sibling releases with unchanged server runtime must retain automatic updates",
      ).toEqual({ rollbackCompatible: true, compatibleFrom: "0.15.1" });
      yield* fs.writeFileString(path.join(root, "apps/server/extra.ts"), "hidden release change");
      yield* git(["add", "."]);
      yield* git(["commit", "--quiet", "--amend", "-m", "chore(release): mate 0.15.2"]);
      expect(yield* readRollbackCompatibility(["v0.15.1"], "0.15.2", root)).toEqual({
        rollbackCompatible: false,
      });
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
  it.effect(
    "compatibleFrom reaches back over every compatible published release and stops at the first manual one",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped();
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const git = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
          expect(
            yield* spawner.exitCode(
              ChildProcess.make("git", args, { cwd: root, stdout: "ignore", stderr: "ignore" }),
            ),
          ).toBe(0);
        });
        let files: Record<string, string> = { ...baseline };
        const release = Effect.fnUntraced(function* (
          version: string,
          next: Record<string, string>,
          tag: boolean,
        ) {
          files = {
            ...next,
            "apps/server/package.json": previousPackage.replace("0.15.0", version),
          };
          yield* writeTree(root, files);
          yield* git(["add", "."]);
          yield* git(["commit", "--quiet", "-m", `release ${version}`]);
          if (tag) yield* git(["tag", `v${version}`]);
        });
        yield* git(["init", "--quiet"]);
        yield* git(["config", "user.name", "Mate release gate test"]);
        yield* git(["config", "user.email", "mate-release-test@example.invalid"]);
        const copy = (version: string) => ({ ...files, "apps/web/copy.ts": version });
        yield* release("0.15.0", copy("0.15.0"), true);
        yield* release(
          "0.15.1",
          changed("apps/server/src/persistence/Migrations.ts", {
            ...files,
            "apps/server/src/persistence/Migrations/064_Next.ts": "export default 64;\n",
          }),
          true,
        );
        yield* release("0.15.2", copy("0.15.2"), true);
        yield* release(
          "0.15.3",
          { ...files, "apps/server/src/zerops/ZeropsHqLink.ts": "export const link = 3;\n" },
          true,
        );
        yield* release("0.15.4", copy("0.15.4"), false);
        const published = ["v0.15.3", "v0.15.2", "v0.15.1", "v0.15.0", "v0.15.5", "v0.15.4-beta.1"];
        expect(
          yield* readRollbackCompatibility(published, "0.15.4", root),
          "ASSERTION: a Mate on 0.15.1 or later updates automatically; 0.15.0 → 0.15.1 was manual",
        ).toEqual({ rollbackCompatible: true, compatibleFrom: "0.15.1" });
        expect(
          yield* readRollbackCompatibility(["v0.15.3", "v0.15.1", "v0.15.0"], "0.15.4", root),
          "an unpublished release is no step of the walk",
        ).toEqual({ rollbackCompatible: true, compatibleFrom: "0.15.1" });
        expect(yield* readRollbackCompatibility([], "0.15.4", root)).toEqual({
          rollbackCompatible: false,
        });
        yield* release("0.15.4", changed("apps/server/src/serverSettings.ts", files), false);
        expect(yield* readRollbackCompatibility(published, "0.15.4", root)).toEqual({
          rollbackCompatible: false,
        });
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
  it.effect(
    "allows a UI change with the same updater, storage, events and native resume code",
    () =>
      Effect.gen(function* () {
        expect(
          rollbackCompatibility(yield* step(touched("apps/web/src/components/RunChat.tsx"))),
        ).toEqual({ rollbackCompatible: true, compatibleFrom: "0.15.0" });
      }),
  );
  it.effect.each(
    Array.from(
      [
        [
          "old Mate without the updater",
          patched((e) => ({ ...e, previous: { ...e.previous, [UPDATE_PROTOCOL]: undefined } })),
        ],
        [
          "unknown updater protocol",
          patched((e) => ({ ...e, previous: { ...e.previous, [UPDATE_PROTOCOL]: "2" } })),
        ],
        ["another release lineage", patched((e) => ({ ...e, ancestor: false }))],
        ["no previous stable release", patched((e) => ({ ...e, previousTag: "" }))],
        [
          "a prerelease previous version",
          patched((e) => ({ ...e, previousTag: "v0.15.0-beta.1" })),
        ],
        [
          "a candidate older than last-good",
          patched((e) => ({ ...e, candidateVersion: "0.14.0" })),
        ],
        [
          "changed runtime dependencies",
          step({
            ...baseline,
            "apps/server/package.json": previousPackage.replace("4.0.1", "4.0.2"),
          }),
        ],
        [
          "unreadable old runtime declaration",
          stepBetween({ ...baseline, "apps/server/package.json": "broken" }, baseline),
        ],
      ] as const,
      ([name, evidence]) => ({ title: `requires confirmation for ${name}`, evidence }),
    ),
  )("$title", ({ evidence }) =>
    Effect.gen(function* () {
      expect(rollbackCompatibility(yield* evidence)).toEqual({ rollbackCompatible: false });
    }),
  );
  it.effect.each(
    Array.from(
      [
        "apps/server/src/engine/store/migrations.ts",
        "apps/server/src/engine/domain/command.ts",
        "apps/server/src/provider/Layers/CodexSessionRuntime.ts",
        "apps/server/src/persistence/ProviderSessionRuntimeRepository.ts",
        "apps/server/src/auth/ServerSecretStore.ts",
        "packages/contracts/src/engine.ts",
        "apps/server/src/update/NativeResume.ts",
        "pnpm-lock.yaml",
      ],
      (changedPath) => ({
        title: `requires confirmation when ${changedPath} changes the server's rollback surface`,
        changedPath,
      }),
    ),
  )("$title", ({ changedPath }) =>
    Effect.gen(function* () {
      expect(rollbackCompatibility(yield* step(changed(changedPath)))).toEqual({
        rollbackCompatible: false,
      });
    }),
  );
  it.effect.each(
    Array.from(
      [
        "apps/server/src/git/GitManager.ts",
        "apps/server/src/ws.ts",
        "apps/server/src/textGeneration/CodexTextGeneration.ts",
        "apps/server/src/engine/store/EngineStore.test.ts",
        "apps/hq/src/main.ts",
        "packages/hq-git/src/index.ts",
        "packages/shared/src/hqStream.ts",
        "package.json",
        "pnpm-workspace.yaml",
      ],
      (changedPath) => ({
        title: `allows a release that changes ${changedPath} and no stored or seam state`,
        changedPath,
      }),
    ),
  )("$title", ({ changedPath }) =>
    Effect.gen(function* () {
      expect(rollbackCompatibility(yield* step(touched(changedPath)))).toEqual({
        rollbackCompatible: true,
        compatibleFrom: "0.15.0",
      });
    }),
  );
  it.effect.each(
    Array.from(
      [
        "apps/server/src/persistence/Migrations/064_Next.ts",
        "apps/server/src/persistence/Migrations.ts",
        "apps/server/src/engine/store/Migrations/0014_Next.ts",
        "packages/contracts/src/settings.ts",
        "packages/contracts/src/orchestration.ts",
        "apps/server/src/serverSettings.ts",
        "apps/server/src/zerops/ZeropsGitCredentialFile.ts",
        "apps/server/src/environment/ServerEnvironment.ts",
      ],
      (changedPath) => ({
        title: `requires confirmation when ${changedPath} adds a migration, a stored schema or a seam change`,
        changedPath,
      }),
    ),
  )("$title", ({ changedPath }) =>
    Effect.gen(function* () {
      // A new migration runs once its track's registry lists it.
      const registry = changedPath.includes("/engine/")
        ? "apps/server/src/engine/store/migrations.ts"
        : "apps/server/src/persistence/Migrations.ts";
      const files = changedPath.includes("/Migrations/")
        ? changed(registry, { ...baseline, [changedPath]: "export default 1;\n" })
        : changed(changedPath);
      expect(rollbackCompatibility(yield* step(files))).toEqual({ rollbackCompatible: false });
    }),
  );
  it.effect.each(
    Array.from(
      [
        "AGENTS.md",
        "CLAUDE.md",
        "README.md",
        "CONTRIBUTING.md",
        "MERGE.md",
        "docs/internals/zerops/fork.md",
        "infra/relay/README.md",
        ".claude/agents/scout.md",
      ],
      (changedPath) => ({
        title: `allows a release that changes ${changedPath}, a repository document outside the Mate artifact`,
        changedPath,
      }),
    ),
  )("$title", ({ changedPath }) =>
    Effect.gen(function* () {
      expect(rollbackCompatibility(yield* step(touched(changedPath)))).toEqual({
        rollbackCompatible: true,
        compatibleFrom: "0.15.0",
      });
    }),
  );
  it.effect.each([
    "scripts/lib/cli-external-packages.ts",
    "scripts/lib/resolve-catalog.ts",
    "scripts/lib/public-config.ts",
  ])("requires confirmation when %s, which shapes the released artifact, changes", (changedPath) =>
    Effect.gen(function* () {
      expect(rollbackBlocker(yield* step(changed(changedPath)))).toContain("the artifact's build");
      expect(rollbackCompatibility(yield* step(touched("scripts/gate-changed.ts")))).toEqual({
        rollbackCompatible: true,
        compatibleFrom: "0.15.0",
      });
    }),
  );
  it.effect.each([
    "apps/server/src/newdir/Store.ts",
    "apps/server/src/newTopLevelStore.ts",
    "packages/new-pkg/src/index.ts",
    ".github/workflows/release.yml",
    "packages/effect-acp/src/client.ts",
    "apps/server/src/provider/acp/AcpSessionRuntime.ts",
    "apps/server/src/engine/domain/decide.ts",
    "apps/server/src/zerops/crew/engine/decide.ts",
  ])("allows a release that changes %s, which no earlier release reads back", (changedPath) =>
    Effect.gen(function* () {
      expect(rollbackCompatibility(yield* step(touched(changedPath)))).toEqual({
        rollbackCompatible: true,
        compatibleFrom: "0.15.0",
      });
    }),
  );
  it.effect.each([
    "apps/server/scripts/cli.ts",
    "apps/server/scripts/releaseRollbackCompatibility.ts",
    "apps/server/scripts/releaseManifestAsset.ts",
  ])("a release script, %s, never makes a release manual", (changedPath) =>
    Effect.gen(function* () {
      expect(rollbackCompatibility(yield* step(touched(changedPath)))).toEqual({
        rollbackCompatible: true,
        compatibleFrom: "0.15.0",
      });
    }),
  );
  it.effect(
    "updates automatically from v0.16.9 to v0.16.10, which changed HQ link and role modules",
    () =>
      Effect.gen(function* () {
        const evidence = yield* step(
          touched(
            "apps/server/scripts/releaseRollbackCompatibility.ts",
            "apps/server/src/zerops/ZeropsHqLink.ts",
            "packages/shared/src/zeropsPermissions.ts",
            "packages/shared/src/zeropsRoles.ts",
            "packages/shared/src/hqStream.ts",
            "apps/hq/src/main.ts",
            "packages/hq-git/src/index.ts",
            "packages/client-runtime/src/zerops/api.ts",
            "apps/web/src/components/ChatView.tsx",
            "scripts/gate-changed.ts",
            "zerops.yml",
          ),
        );
        expect(rollbackCompatibility(evidence)).toEqual({
          rollbackCompatible: true,
          compatibleFrom: "0.15.0",
        });
      }),
  );
  it.effect.each([
    [
      "the update protocol changed",
      patched((e) => ({ ...e, current: { ...e.current, [UPDATE_PROTOCOL]: "2" } })),
    ],
    [
      "the runtime declaration changed",
      stepBetween({ ...baseline, "apps/server/package.json": "broken" }, baseline),
    ],
    ["not an ancestor", patched((e) => ({ ...e, ancestor: false }))],
  ] as const)("names the cause when %s", ([cause, evidence]) =>
    Effect.gen(function* () {
      expect(rollbackBlocker(yield* evidence), cause).toBeTruthy();
    }),
  );
  describe("a changed lockfile counts only when the server's runtime dependencies moved", () => {
    const changedLock = (current: string | undefined) => {
      const { "pnpm-lock.yaml": _lock, ...rest } = baseline;
      return step(current === undefined ? rest : { ...rest, "pnpm-lock.yaml": current });
    };
    it.effect("allows a dev-only lockfile change", () =>
      Effect.gen(function* () {
        expect(
          rollbackCompatibility(yield* changedLock(lock({ runtime: "1.0.0", dev: "1.0.1" }))),
        ).toEqual({ rollbackCompatible: true, compatibleFrom: "0.15.0" });
      }),
    );
    it.effect("requires confirmation when a transitive runtime dependency changes", () =>
      Effect.gen(function* () {
        expect(
          rollbackCompatibility(yield* changedLock(lock({ runtime: "1.0.1", dev: "1.0.0" }))),
        ).toEqual({ rollbackCompatible: false });
      }),
    );
    it.effect(
      "requires confirmation when a dependency of a bundled workspace package changes",
      () =>
        Effect.gen(function* () {
          expect(
            rollbackCompatibility(
              yield* changedLock(lock({ runtime: "1.0.0", dev: "1.0.0", bundled: "6.0.1" })),
            ),
          ).toEqual({ rollbackCompatible: false });
        }),
    );
    it.effect("allows a lockfile change that moves only the web client's dependencies", () =>
      Effect.gen(function* () {
        expect(
          rollbackCompatibility(
            yield* changedLock(lock({ runtime: "1.0.0", dev: "1.0.0", web: "19.0.1" })),
          ),
        ).toEqual({ rollbackCompatible: true, compatibleFrom: "0.15.0" });
      }),
    );
    it.effect("names a moved lockfile beside the other blocking paths", () =>
      Effect.gen(function* () {
        const blocker = rollbackBlocker(
          yield* step(
            changed("pnpm-lock.yaml", changed("apps/server/src/persistence/Migrations.ts")),
          ),
        );
        expect(blocker).toContain("SQL migrations");
        expect(blocker).toContain(RUNTIME_DEPENDENCIES);
      }),
    );
    it.effect("requires confirmation when the lockfile cannot be read", () =>
      Effect.gen(function* () {
        expect(rollbackCompatibility(yield* changedLock("not: [a lockfile"))).toEqual({
          rollbackCompatible: false,
        });
        expect(rollbackCompatibility(yield* changedLock(undefined))).toEqual({
          rollbackCompatible: false,
        });
      }),
    );
  });
});

describe("the allowlisted HQ wire modules stay free of stored state", () => {
  const sources = Effect.fnUntraced(function* (dir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../../..");
    const files = yield* fs.readDirectory(path.join(root, dir), { recursive: true });
    return yield* Effect.forEach(
      files.filter((file) => /\.tsx?$/u.test(file) && !/\.test\.tsx?$/u.test(file)),
      (file) =>
        fs.readFileString(path.join(root, dir, file)).pipe(
          Effect.map((text) => ({
            file: `${dir}/${file}`,
            imports: [...text.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]!),
          })),
        ),
      { concurrency: 16 },
    );
  });
  const hqOffenders = (
    files: ReadonlyArray<{ readonly file: string; readonly imports: ReadonlyArray<string> }>,
  ) =>
    files
      .filter(({ file }) => file.startsWith(HQ_WIRE_MODULES))
      .flatMap(({ file, imports }) =>
        imports
          .filter(
            (specifier) =>
              !/^effect(\/|$)/u.test(specifier) &&
              specifier !== "@t3tools/contracts" &&
              !/^\.\.?\/(hq|common|mateLink|zeropsPermissions|log|agentUsage|commit)/u.test(
                specifier,
              ),
          )
          .map((specifier) => `${file} imports ${specifier}`),
      );

  it.effect("an hq module imports only schemas, never a persistence or filesystem module", () =>
    Effect.gen(function* () {
      const shared = yield* sources("packages/shared/src");
      expect(shared.filter(({ file }) => file.startsWith(HQ_WIRE_MODULES)).length).toBeGreaterThan(
        20,
      );
      expect(hqOffenders(shared)).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each([
    "packages/shared/src/hqStream.ts",
    "packages/shared/src/hqGitBrowse/tree.ts",
    "packages/shared/src/hqStore/nested/index.ts",
  ])("the hq guard checks %s, a path the hq allowlist entry admits", (file) =>
    Effect.gen(function* () {
      expect(rollbackCompatibility(yield* step(touched(file)))).toEqual({
        rollbackCompatible: true,
        compatibleFrom: "0.15.0",
      });
      expect(hqOffenders([{ file, imports: ["../persistence/Store.ts"] }])).toEqual([
        `${file} imports ../persistence/Store.ts`,
      ]);
    }),
  );

  it.effect("the server reaches an hq module only from zerops/, which is never allowlisted", () =>
    Effect.gen(function* () {
      const importers = (yield* sources("apps/server/src"))
        .filter(({ imports }) => imports.some((specifier) => /shared\/hq/u.test(specifier)))
        .map(({ file }) => file)
        .filter((file) => !file.startsWith("apps/server/src/zerops/"));
      expect(importers).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("no server, shared or contracts file imports a package the allowlist trusts", () =>
    Effect.gen(function* () {
      const all = (yield* Effect.all([
        sources("apps/server/src"),
        sources("packages/shared/src"),
        sources("packages/contracts/src"),
      ])).flat();
      expect(
        all
          .filter(({ imports }) =>
            imports.some((specifier) => specifier.startsWith("@t3tools/client-runtime")),
          )
          .map(({ file }) => file),
      ).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
