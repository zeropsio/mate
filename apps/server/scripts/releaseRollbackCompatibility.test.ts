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
});
