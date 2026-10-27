import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  rollbackCompatibility,
  readRollbackCompatibility,
} from "./releaseRollbackCompatibility.ts";

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
        yield* fs.makeDirectory(path.join(root, "apps/server/src/engine"), { recursive: true });
        yield* fs.makeDirectory(path.join(root, "apps/web"), { recursive: true });
        const serverPackage = path.join(root, "apps/server/package.json");
        yield* fs.writeFileString(serverPackage, previousPackage);
        yield* fs.writeFileString(
          path.join(root, "apps/server/update-protocol.json"),
          '{"protocol":1}',
        );
        yield* fs.writeFileString(path.join(root, "apps/server/src/engine/state.ts"), "old format");
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
        expect(yield* readRollbackCompatibility("v0.15.0", "0.15.1", root)).toEqual({
          rollbackCompatible: true,
          compatibleFrom: "0.15.0",
        });
        yield* fs.writeFileString(path.join(root, "apps/server/src/engine/state.ts"), "new format");
        yield* git(["add", "."]);
        yield* git(["commit", "--quiet", "-m", "persisted format change"]);
        expect(yield* readRollbackCompatibility("v0.15.0", "0.15.1", root)).toEqual({
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
        yield* readRollbackCompatibility("v0.15.1", "0.15.2", root),
        "ASSERTION: sibling releases with unchanged server runtime must retain automatic updates",
      ).toEqual({ rollbackCompatible: true, compatibleFrom: "0.15.1" });
      yield* fs.writeFileString(path.join(root, "apps/server/extra.ts"), "hidden release change");
      yield* git(["add", "."]);
      yield* git(["commit", "--quiet", "--amend", "-m", "chore(release): mate 0.15.2"]);
      expect(yield* readRollbackCompatibility("v0.15.1", "0.15.2", root)).toEqual({
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
        "apps/server/src/engine/domain/events.ts",
        "apps/server/src/provider/Layers/CodexSessionRuntime.ts",
        "apps/server/src/persistence/ProviderSessionRuntimeRepository.ts",
        "apps/server/src/zerops/preferences.ts",
        "apps/server/scripts/cli.ts",
        "packages/contracts/src/engine.ts",
        "packages/shared/src/nativeResume.ts",
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
        "apps/server/src/ws.ts",
        "apps/server/src/git/GitManager.ts",
        "apps/server/src/textGeneration/CodexTextGeneration.ts",
        "apps/server/src/engine/store/EngineStore.test.ts",
        "packages/effect-acp/src/client.ts",
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
  describe("a changed lockfile counts only when the server's runtime dependencies moved", () => {
    const lock = (options: { readonly runtime: string; readonly dev: string }) => `
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
      vitest:
        specifier: ^1
        version: ${options.dev}
snapshots:
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
