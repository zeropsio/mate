// @effect-diagnostics nodeBuiltinImport:off -- historical test source and installed dependency links.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";
import { tempDir } from "./tempDir.ts";

export const PRE_EXPAND_SHA = "8bb1dee01f1d4c10c1f991323c0a41233886b787";
export const PRE_EXPAND_ARCHIVE = "apps/hq/test/fixtures/core-8bb1dee01f.tar.gz";
export const PRE_EXPAND_PACKAGES = {
  "@t3tools/hq": "apps/hq",
  "@t3tools/contracts": "packages/contracts",
  "@t3tools/shared": "packages/shared",
  "@t3tools/hq-git": "packages/hq-git",
} as const;
const decodeManifest = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
);
const repoRoot = NodePath.resolve(import.meta.dirname, "../../../..");

// Unmodified `git archive --format=tar.gz <SHA> package.json tsconfig.base.json vite.config.ts
// scripts apps/hq packages/shared packages/contracts packages/hq-git`. Committed bytes make this
// fixture independent of git history, promisor remotes and network access in shallow CI checkouts.
const ARCHIVE_DIGEST = "b220da78d8a1ef462da6919c86ed6e5f493b140956cdb9857698d6f6bdfc1e04";

export const makePreExpandCore = (installedRoot = repoRoot) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;
    const fixtureRoot = yield* tempDir("hq-pre-expand-");
    const archive = NodePath.join(installedRoot, PRE_EXPAND_ARCHIVE);
    assert.strictEqual(
      NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(archive)).digest("hex"),
      ARCHIVE_DIGEST,
    );
    assert.strictEqual(
      yield* spawner.exitCode(ChildProcess.make("tar", ["-xf", archive, "-C", fixtureRoot])),
      0,
    );

    const link = (target: string, destination: string) => {
      NodeFS.mkdirSync(NodePath.dirname(destination), { recursive: true });
      NodeFS.symlinkSync(target, destination);
    };
    link(
      NodePath.join(installedRoot, "node_modules/vite-plus"),
      NodePath.join(fixtureRoot, "node_modules/vite-plus"),
    );
    for (const directory of Object.values(PRE_EXPAND_PACKAGES)) {
      const manifest = decodeManifest(
        NodeFS.readFileSync(NodePath.join(fixtureRoot, directory, "package.json"), "utf8"),
      );
      for (const [name, version] of Object.entries({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      })) {
        const historical = PRE_EXPAND_PACKAGES[name as keyof typeof PRE_EXPAND_PACKAGES];
        if (version.startsWith("workspace:")) {
          assert.isDefined(historical, `Missing archived workspace dependency ${name}`);
        }
        // Only external packages share the installed runtime. In particular every Effect import
        // reaches the same instance as the host test; workspace imports stay inside the archive.
        const target = historical
          ? NodePath.join(fixtureRoot, historical)
          : NodePath.join(installedRoot, directory, "node_modules", name);
        assert.isTrue(NodeFS.existsSync(target), `Missing installed dependency ${name}`);
        link(target, NodePath.join(fixtureRoot, directory, "node_modules", name));
      }
    }
    const oldModule = yield* Effect.promise(
      () =>
        import(
          /* @vite-ignore */ NodePath.join(fixtureRoot, "apps/hq/test/harness/runningCore.ts")
        ) as Promise<typeof import("./runningCore.ts")>,
    );
    const oldNavigation = yield* Effect.promise(
      () =>
        import(
          /* @vite-ignore */ NodePath.join(fixtureRoot, "apps/hq/src/environmentNavigation.ts")
        ) as Promise<typeof import("../../src/environmentNavigation.ts")>,
    );
    const oldMigrations = yield* Effect.promise(
      () =>
        import(
          /* @vite-ignore */ NodePath.join(fixtureRoot, "apps/hq/src/migrationFiles.ts")
        ) as Promise<typeof import("../../src/migrationFiles.ts")>,
    );
    assert.notInclude(
      oldMigrations.treeMigrations().map((file) => file.name),
      "0052_environment_identity.sql",
    );
    return { ...oldModule, oldNavigation, oldMigrations, fixtureRoot };
  });

export const preExpandCore = makePreExpandCore();
