import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  BLOCKING_PATHS,
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
const evidence = {
  previousTag: "v0.15.0",
  candidateVersion: "0.15.1",
  ancestor: true,
  previousProtocol: 1,
  currentProtocol: 1,
  previousPackage,
  currentPackage: previousPackage.replace("0.15.0", "0.15.1"),
  changedPaths: ["apps/web/src/components/RunChat.tsx", "apps/server/package.json"],
};

describe("a release may update automatically only inside its proved rollback range", () => {
  it.effect(
    "reads the last stable ancestor and permits a UI release until persisted server behavior changes",
    () =>
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
        yield* fs.makeDirectory(path.join(root, "apps/server/src/engine/domain"), {
          recursive: true,
        });
        yield* fs.makeDirectory(path.join(root, "apps/web"), { recursive: true });
        const serverPackage = path.join(root, "apps/server/package.json");
        yield* fs.writeFileString(serverPackage, previousPackage);
        yield* fs.writeFileString(
          path.join(root, "apps/server/update-protocol.json"),
          '{"protocol":1}',
        );
        yield* fs.writeFileString(
          path.join(root, "apps/server/src/engine/domain/state.ts"),
          "old format",
        );
        yield* git(["init", "--quiet"]);
        yield* git(["config", "user.name", "Mate release gate test"]);
        yield* git(["config", "user.email", "mate-release-test@example.invalid"]);
        yield* git(["add", "."]);
        yield* git(["commit", "--quiet", "-m", "updater baseline"]);
        yield* git(["tag", "v0.15.0"]);
        yield* fs.writeFileString(serverPackage, evidence.currentPackage);
        yield* fs.writeFileString(path.join(root, "apps/web/copy.ts"), "new copy");
        yield* git(["add", "."]);
        yield* git(["commit", "--quiet", "-m", "UI release"]);
        expect(yield* readRollbackCompatibility(["v0.15.0"], "0.15.1", root)).toEqual({
          rollbackCompatible: true,
          compatibleFrom: "0.15.0",
        });
        yield* fs.writeFileString(
          path.join(root, "apps/server/src/engine/domain/state.ts"),
          "new format",
        );
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
      for (const file of files) {
        yield* fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true });
        yield* fs.writeFileString(path.join(root, file), previousPackage);
      }
      yield* fs.writeFileString(
        path.join(root, "apps/server/update-protocol.json"),
        '{"protocol":1}',
      );
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
      yield* fs.writeFileString(path.join(root, "apps/web/copy.ts"), "new copy");
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
        const release = Effect.fnUntraced(function* (version: string, file: string, tag: boolean) {
          yield* fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true });
          yield* fs.writeFileString(path.join(root, file), version);
          yield* fs.writeFileString(
            path.join(root, "apps/server/package.json"),
            previousPackage.replace("0.15.0", version),
          );
          yield* git(["add", "."]);
          yield* git(["commit", "--quiet", "-m", `release ${version}`]);
          if (tag) yield* git(["tag", `v${version}`]);
        });
        yield* fs.makeDirectory(path.join(root, "apps/server"), { recursive: true });
        yield* fs.writeFileString(
          path.join(root, "apps/server/update-protocol.json"),
          '{"protocol":1}',
        );
        yield* git(["init", "--quiet"]);
        yield* git(["config", "user.name", "Mate release gate test"]);
        yield* git(["config", "user.email", "mate-release-test@example.invalid"]);
        yield* release("0.15.0", "apps/web/copy.ts", true);
        yield* release("0.15.1", "apps/server/src/persistence/Migrations/064_Next.ts", true);
        yield* release("0.15.2", "apps/web/copy.ts", true);
        yield* release("0.15.3", "apps/server/src/zerops/ZeropsHqLink.ts", true);
        yield* release("0.15.4", "apps/web/copy.ts", false);
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
        yield* release("0.15.4", "apps/server/src/serverSettings.ts", false);
        expect(yield* readRollbackCompatibility(published, "0.15.4", root)).toEqual({
          rollbackCompatible: false,
        });
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
  it("allows a UI change with the same updater, storage, events and native resume code", () => {
    expect(rollbackCompatibility(evidence)).toEqual({
      rollbackCompatible: true,
      compatibleFrom: "0.15.0",
    });
  });
  it.each(
    Array.from(
      [
        ["old Mate without the updater", { previousProtocol: undefined }],
        ["unknown updater protocol", { previousProtocol: 2 }],
        ["another release lineage", { ancestor: false }],
        ["no previous stable release", { previousTag: "" }],
        ["a prerelease previous version", { previousTag: "v0.15.0-beta.1" }],
        ["a candidate older than last-good", { candidateVersion: "0.14.0" }],
        [
          "changed runtime dependencies",
          { currentPackage: previousPackage.replace("4.0.1", "4.0.2") },
        ],
        ["unreadable old runtime declaration", { previousPackage: "broken" }],
      ] as const,
      ([name, patch]) => ({ title: `requires confirmation for ${name}`, patch }),
    ),
  )("$title", ({ patch }) => {
    expect(rollbackCompatibility({ ...evidence, ...patch })).toEqual({
      rollbackCompatible: false,
    });
  });
  it.each(
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
  )("$title", ({ changedPath }) => {
    expect(rollbackCompatibility({ ...evidence, changedPaths: [changedPath] })).toEqual({
      rollbackCompatible: false,
    });
  });
  it.each(
    Array.from(
      [
        "apps/server/src/git/GitManager.ts",
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
  )("$title", ({ changedPath }) => {
    expect(rollbackCompatibility({ ...evidence, changedPaths: [changedPath] })).toEqual({
      rollbackCompatible: true,
      compatibleFrom: "0.15.0",
    });
  });
  it.each(
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
        "apps/server/src/cli/config.ts",
        "apps/server/src/ws.ts",
        "apps/server/src/server.ts",
        "apps/server/src/serverRuntimeStartup.ts",
        "apps/server/src/spi/ProviderUpdateSafety.ts",
      ],
      (changedPath) => ({
        title: `requires confirmation when ${changedPath} adds a migration, a stored schema or a seam change`,
        changedPath,
      }),
    ),
  )("$title", ({ changedPath }) => {
    expect(rollbackCompatibility({ ...evidence, changedPaths: [changedPath] })).toEqual({
      rollbackCompatible: false,
    });
  });
  it.each(
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
  )("$title", ({ changedPath }) => {
    expect(rollbackCompatibility({ ...evidence, changedPaths: [changedPath] })).toEqual({
      rollbackCompatible: true,
      compatibleFrom: "0.15.0",
    });
  });
  it("names every blocking path of a manual release, up to twenty, and counts the rest", () => {
    const blocking = Array.from(
      { length: 25 },
      (_, index) => `apps/server/src/persistence/Migrations/${100 + index}_Next.ts`,
    );
    const blocker = rollbackBlocker({
      ...evidence,
      changedPaths: ["AGENTS.md", ...blocking, "apps/web/src/main.tsx", "packages/new-pkg/a.ts"],
    });
    for (const path of blocking.slice(0, 20)) expect(blocker).toContain(path);
    expect(blocker).not.toContain("120_Next.ts");
    expect(blocker).toContain("and 5 more");
    expect(blocker).not.toContain("AGENTS.md");
    expect(blocker).not.toContain("apps/web/");
    expect(blocker).not.toContain("packages/new-pkg/");
  });
  it.each([
    "scripts/lib/cli-external-packages.ts",
    "scripts/lib/resolve-catalog.ts",
    "scripts/lib/public-config.ts",
  ])(
    "requires confirmation when %s, which shapes the released artifact, changes",
    (changedPath) => {
      expect(rollbackBlocker({ ...evidence, changedPaths: [changedPath] })).toContain(changedPath);
      expect(
        rollbackCompatibility({ ...evidence, changedPaths: ["scripts/gate-changed.ts"] }),
      ).toEqual({ rollbackCompatible: true, compatibleFrom: "0.15.0" });
    },
  );
  it.each([
    "apps/server/src/persistence/Layers/NewRepository.ts",
    "apps/server/src/engine/store/Migrations/0099_Next.ts",
    "apps/server/src/persistence/Migrations/064_Next.ts",
    "apps/server/src/update/NewFence.ts",
  ])("requires confirmation for %s, a path the rule has never seen", (changedPath) => {
    expect(rollbackBlocker({ ...evidence, changedPaths: [changedPath] })).toContain(changedPath);
  });
  it.each([
    "apps/server/src/newdir/Store.ts",
    "apps/server/src/newTopLevelStore.ts",
    "packages/new-pkg/src/index.ts",
    ".github/workflows/release.yml",
    "packages/effect-acp/src/client.ts",
    "apps/server/src/provider/acp/AcpSessionRuntime.ts",
    "apps/server/src/engine/domain/decide.ts",
    "apps/server/src/zerops/crew/engine/decide.ts",
  ])("allows a release that changes %s, which no earlier release reads back", (changedPath) => {
    expect(rollbackCompatibility({ ...evidence, changedPaths: [changedPath] })).toEqual({
      rollbackCompatible: true,
      compatibleFrom: "0.15.0",
    });
  });
  it.each([
    "apps/server/scripts/cli.ts",
    "apps/server/scripts/releaseRollbackCompatibility.ts",
    "apps/server/scripts/releaseManifestAsset.ts",
  ])("a release script, %s, never makes a release manual", (changedPath) => {
    expect(rollbackCompatibility({ ...evidence, changedPaths: [changedPath] })).toEqual({
      rollbackCompatible: true,
      compatibleFrom: "0.15.0",
    });
  });
  it("updates automatically from v0.16.9 to v0.16.10, which changed HQ link and role modules", () => {
    expect(
      rollbackCompatibility({
        ...evidence,
        changedPaths: [
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
        ],
      }),
    ).toEqual({ rollbackCompatible: true, compatibleFrom: "0.15.0" });
  });
  it.effect("every blocklisted path names a file or directory in the repository", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.resolve(import.meta.dirname, "../../..");
      const missing: Array<string> = [];
      for (const [blocked] of BLOCKING_PATHS)
        if (!(yield* fs.exists(path.join(root, blocked)))) missing.push(blocked);
      expect(missing).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  it.each([
    ["the update protocol changed", { currentProtocol: 2 }],
    ["the runtime declaration changed", { previousPackage: "broken" }],
    ["not an ancestor", { ancestor: false }],
  ] as const)("names the cause when %s", (cause, patch) => {
    expect(rollbackBlocker({ ...evidence, ...patch }), cause).toBeTruthy();
  });
  describe("a changed lockfile counts only when the server's runtime dependencies moved", () => {
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
    const base = lock({ runtime: "1.0.0", dev: "1.0.0" });
    const changedLock = (current: string | undefined) => ({
      ...evidence,
      changedPaths: ["pnpm-lock.yaml"],
      ...(current === undefined ? {} : { lockfiles: { previous: base, current } }),
    });
    it("allows a dev-only lockfile change", () => {
      expect(rollbackCompatibility(changedLock(lock({ runtime: "1.0.0", dev: "1.0.1" })))).toEqual({
        rollbackCompatible: true,
        compatibleFrom: "0.15.0",
      });
    });
    it("requires confirmation when a transitive runtime dependency changes", () => {
      expect(rollbackCompatibility(changedLock(lock({ runtime: "1.0.1", dev: "1.0.0" })))).toEqual({
        rollbackCompatible: false,
      });
    });
    it("requires confirmation when a dependency of a bundled workspace package changes", () => {
      expect(
        rollbackCompatibility(
          changedLock(lock({ runtime: "1.0.0", dev: "1.0.0", bundled: "6.0.1" })),
        ),
      ).toEqual({ rollbackCompatible: false });
    });
    it("allows a lockfile change that moves only the web client's dependencies", () => {
      expect(
        rollbackCompatibility(changedLock(lock({ runtime: "1.0.0", dev: "1.0.0", web: "19.0.1" }))),
      ).toEqual({ rollbackCompatible: true, compatibleFrom: "0.15.0" });
    });
    it("names a moved lockfile beside the other blocking paths", () => {
      const blocker = rollbackBlocker({
        ...changedLock(lock({ runtime: "1.0.1", dev: "1.0.0" })),
        changedPaths: ["apps/server/src/persistence/Migrations.ts", "pnpm-lock.yaml"],
      });
      expect(blocker).toContain("apps/server/src/persistence/Migrations.ts");
      expect(blocker).toContain("pnpm-lock.yaml");
    });
    it("requires confirmation when the lockfile cannot be read", () => {
      expect(rollbackCompatibility(changedLock("not: [a lockfile"))).toEqual({
        rollbackCompatible: false,
      });
      expect(rollbackCompatibility(changedLock(undefined))).toEqual({
        rollbackCompatible: false,
      });
    });
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

  it.each([
    "packages/shared/src/hqStream.ts",
    "packages/shared/src/hqGitBrowse/tree.ts",
    "packages/shared/src/hqStore/nested/index.ts",
  ])("the hq guard checks %s, a path the hq allowlist entry admits", (file) => {
    expect(rollbackCompatibility({ ...evidence, changedPaths: [file] })).toEqual({
      rollbackCompatible: true,
      compatibleFrom: "0.15.0",
    });
    expect(hqOffenders([{ file, imports: ["../persistence/Store.ts"] }])).toEqual([
      `${file} imports ../persistence/Store.ts`,
    ]);
  });

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
