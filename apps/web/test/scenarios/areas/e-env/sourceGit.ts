// @effect-diagnostics nodeBuiltinImport:off -- a disposable Git client talks to the local HQ.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";

export const sourceGit = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "environment-source-"))),
    (path) => Effect.sync(() => NodeFS.rmSync(path, { recursive: true })),
  );
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Ada",
    GIT_AUTHOR_EMAIL: "ada@mate.test",
    GIT_COMMITTER_NAME: "Ada",
    GIT_COMMITTER_EMAIL: "ada@mate.test",
  };
  const run = (args: ReadonlyArray<string>, cwd = dir) =>
    Effect.callback<{ code: number; stdout: string; stderr: string }>((resume) => {
      NodeChildProcess.execFile("git", args, { cwd, env }, (error, stdout) =>
        resume(
          Effect.succeed({
            code: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
            stdout: stdout.trim(),
            stderr: "",
          }),
        ),
      );
    });
  const checked = (args: ReadonlyArray<string>, cwd = dir) =>
    run(args, cwd).pipe(
      Effect.flatMap(({ code, stdout }) =>
        code === 0
          ? Effect.succeed(stdout)
          : Effect.die(new Error("The fixture's Git command failed")),
      ),
    );
  return { dir, run, checked };
});
