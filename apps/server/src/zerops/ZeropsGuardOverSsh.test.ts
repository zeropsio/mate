// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { captureBaselineAcrossTargets } from "./ZeropsCheckpointTargets.ts";
import { makeZeropsGitSpawner } from "./ZeropsGitSpawner.ts";
import { localSshSpawner } from "./testing/localSsh.ts";
import type { ZeropsRepositories } from "./ZeropsRepositorySource.ts";

/**
 * The guard proved sound against a local git and against a fake process, yet
 * it did not refuse a 19 308-file repository live on z3-eval, where git runs
 * over SSH. The difference is the one thing neither test covered: the whole
 * stack with the Zerops spawner in it.
 *
 * This runs exactly that stack. The only thing faked is the network: an inner
 * spawner that recognises the `ssh` the rewriter produced and executes its
 * remote command string locally through `/bin/sh`. Everything above it - the
 * rewrite, the argv, the handle, the stream collection and the truncation the
 * guard reads - is production code.
 */
const makeRepositoryWithUntrackedFiles = (fileCount: number) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-guard-over-ssh-"));
  const real = NodeFS.realpathSync(dir);
  NodeChildProcess.execFileSync("git", ["init", "-q"], { cwd: real });
  const nested = NodePath.join(real, "node_modules", "a-package-with-a-longish-name", "dist");
  NodeFS.mkdirSync(nested, { recursive: true });
  for (let index = 0; index < fileCount; index += 1) {
    NodeFS.writeFileSync(
      NodePath.join(nested, `some-generated-module-file-${index}.js`),
      "module.exports = 1;\n",
    );
  }
  return real;
};

const guardLayer = (repositories: ZeropsRepositories) =>
  Layer.effect(
    VcsProcess.VcsProcess,
    Effect.gen(function* () {
      const platform = yield* ChildProcessSpawner.ChildProcessSpawner;
      const spawner = makeZeropsGitSpawner({
        enabled: true,
        repositories: Effect.succeed(repositories),
        inner: localSshSpawner(platform),
      });
      const runner = yield* ProcessRunner.make().pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      return yield* VcsProcess.make.pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, runner),
      );
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(NodeServices.layer)("the untracked guard with git going over the Zerops spawner", (it) => {
  it.effect("refuses a repository whose untracked set overflows, exactly as it does locally", () =>
    Effect.gen(function* () {
      const repositoryPath = makeRepositoryWithUntrackedFiles(6_000);
      const repositories: ZeropsRepositories = {
        _tag: "available",
        repositories: [
          { host: "devservice", mountPath: repositoryPath, remotePath: repositoryPath },
        ],
      };
      const captured: Array<string> = [];
      const store = {
        hasCheckpointRef: () => Effect.succeed(false),
        captureCheckpoint: (input: { readonly cwd: string }) =>
          Effect.sync(() => {
            captured.push(input.cwd);
          }),
      } as never;

      const result = yield* Effect.gen(function* () {
        const vcsProcess = yield* VcsProcess.VcsProcess;
        return yield* captureBaselineAcrossTargets(
          { store, vcsProcess },
          {
            targets: [{ cwd: repositoryPath, prefix: "" }],
            checkpointRef: "refs/t3/x/turn/0" as never,
          },
        );
      }).pipe(Effect.provide(guardLayer(repositories)));

      NodeFS.rmSync(repositoryPath, { recursive: true, force: true });
      assert.deepStrictEqual(captured, []);
      assert.strictEqual(result.skipped.length, 1);
    }),
  );
});
