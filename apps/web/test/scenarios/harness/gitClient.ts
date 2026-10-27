// @effect-diagnostics nodeBuiltinImport:off -- the tests run the host's git as a Mate's container does.
/**
 * git as a Mate runs it against Core: the host's binary in a temp directory of its own, with no
 * system or global config, no prompt, and a fixed author. Removed with the test's scope.
 *
 * @module test/harness/gitClient
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

export interface GitRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export const gitClient = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-client-"))),
    (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
  );
  const env = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: dir,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    GIT_AUTHOR_NAME: "Ada",
    GIT_AUTHOR_EMAIL: "ada@mate.test",
    GIT_COMMITTER_NAME: "Ada",
    GIT_COMMITTER_EMAIL: "ada@mate.test",
  };
  /** `git <args>` in `cwd` (the client's directory by default); its exit code and output. */
  const run = (args: ReadonlyArray<string>, cwd = dir) =>
    Effect.callback<GitRun>((resume) => {
      NodeChildProcess.execFile(
        "git",
        ["-c", "core.hooksPath=/dev/null", ...args],
        { cwd, env, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) =>
          resume(
            Effect.succeed({
              code: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
              stdout: stdout.trim(),
              stderr,
            }),
          ),
      );
    });
  /** `run`, which must succeed; its output. */
  const checked = (args: ReadonlyArray<string>, cwd = dir) =>
    Effect.flatMap(run(args, cwd), (result) =>
      result.code === 0
        ? Effect.succeed(result.stdout)
        : Effect.die(`git ${args.join(" ")} failed: ${result.stderr}`),
    );
  return { dir, run, checked };
});
