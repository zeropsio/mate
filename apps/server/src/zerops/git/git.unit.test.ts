import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../../processRunner.ts";
import {
  makeZeropsGitSpawner,
  mapRemotePathsToMount,
  rewriteGitSpawn,
} from "../ZeropsGitSpawner.ts";
import * as ZeropsGitRemoteProbe from "../ZeropsGitRemoteProbe.ts";
import {
  ZeropsRepositorySource,
  type ZeropsRepositories,
  type ZeropsRepository,
} from "../ZeropsRepositorySource.ts";
import { shellQuote, SSH_PINNED_OPTIONS, withRepository } from "../ZeropsWorkspaceAccess.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const kanban: ZeropsRepository = {
  host: "kanbandev",
  mountPath: "/var/www/kanbandev",
  remotePath: "/var/www",
};
const api: ZeropsRepository = {
  host: "apidev",
  mountPath: "/var/www/apidev",
  remotePath: "/var/www",
};
const repositories = [kanban, api];

const rewrite = (
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {},
) => rewriteGitSpawn({ command: "git", args, options }, repositories);

/** The remote side of an invocation: the single string ssh hands the shell. */
const remoteOf = (
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {},
) => {
  const invocation = rewrite(args, options);
  assert.isDefined(invocation);
  return invocation.remoteCommand;
};

const available = (list: ReadonlyArray<ZeropsRepository>): Effect.Effect<ZeropsRepositories> =>
  Effect.succeed({ _tag: "available", repositories: list });

interface SpawnRecord {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

/** An in-process platform spawner: it records every spawn, its environment and the in-flight peak. */
const makeInnerSpawner = (options?: {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly hold?: Deferred.Deferred<void>;
}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<SpawnRecord>>([]);
    const envs = yield* Ref.make<
      ReadonlyArray<{
        readonly env: Record<string, string | undefined> | undefined;
        readonly extendEnv: boolean | undefined;
      }>
    >([]);
    const inFlight = yield* Ref.make(0);
    const peak = yield* Ref.make(0);
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        yield* Ref.update(calls, (previous) => [
          ...previous,
          command._tag === "StandardCommand"
            ? { command: command.command, args: command.args.map(String) }
            : { command: "piped", args: [] },
        ]);
        if (command._tag === "StandardCommand") {
          yield* Ref.update(envs, (previous) => [
            ...previous,
            {
              env:
                command.options.env === undefined
                  ? undefined
                  : Object.fromEntries(
                      Object.entries(command.options.env).map(([key, value]) => [
                        key,
                        Redacted.isRedacted(value) ? Redacted.value(value) : value,
                      ]),
                    ),
              extendEnv: command.options.extendEnv,
            },
          ]);
        }
        const current = yield* Ref.updateAndGet(inFlight, (n) => n + 1);
        yield* Ref.update(peak, (n) => Math.max(n, current));
        yield* Effect.addFinalizer(() => Ref.update(inFlight, (n) => n - 1));
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: (options?.hold === undefined ? Effect.void : Deferred.await(options.hold)).pipe(
            Effect.as(ChildProcessSpawner.ExitCode(options?.exitCode ?? 0)),
          ),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.make(encoder.encode(options?.stdout ?? "")),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        });
      }),
    );
    return { spawner, calls, envs, peak } as const;
  });

/** The checkout every probe names, as the mount of one dev service. */
const probeRepositorySource = Layer.mock(ZeropsRepositorySource)({
  list: Effect.succeed({
    _tag: "available",
    repositories: [{ host: "appdev", mountPath: "/var/www/appdev", remotePath: "/var/www" }],
  }),
});

const probeOutput = (output: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code: number;
}): ProcessRunner.ProcessRunOutput => ({
  stdout: output.stdout ?? "",
  stderr: output.stderr ?? "",
  code: ChildProcessSpawner.ExitCode(output.code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

/** A probe over an in-process `zcp` that answers `answer` and records every argv it was given. */
const runProbe = (
  answer: Effect.Effect<ProcessRunner.ProcessRunOutput, ProcessRunner.ProcessRunError>,
  input: ZeropsGitRemoteProbe.ZeropsGitRemoteProbeInput,
) =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
    const runner = Layer.succeed(ProcessRunner.ProcessRunner, {
      run: (runInput) =>
        Ref.update(seen, (previous) => [...previous, runInput.args]).pipe(Effect.andThen(answer)),
    });
    const result = yield* ZeropsGitRemoteProbe.make({ command: "zcp", baseArgs: [] }).pipe(
      Effect.flatMap((service) => Effect.result(service.probe(input))),
      Effect.provide(Layer.mergeAll(runner, probeRepositorySource)),
    );
    return { result, args: yield* Ref.get(seen) } as const;
  });

/** What a probe answered when it answered; a probe that failed fails the case. */
const answered = <A, E>(result: Result.Result<A, E>): A => {
  if (result._tag !== "Success") return assert.fail("the probe failed");
  return result.success;
};

// witness: apps/server/src/zerops/ZeropsWorkspaceAccess.ts | : `'${token.replaceAll("'", `'\\''`)}'`; → : `'${token}'`;
it("GT1: A token handed to the remote shell keeps its meaning: a shell-safe token goes as it is and any other is single-quoted, a single quote included, so a commit message survives intact", () => {
  assert.strictEqual(shellQuote("/var/www"), "/var/www");
  assert.strictEqual(shellQuote("--porcelain=2"), "--porcelain=2");
  assert.strictEqual(shellQuote("a b"), "'a b'");
  assert.strictEqual(shellQuote(""), "''");
  assert.strictEqual(shellQuote("it's"), "'it'\\''s'");
  assert.strictEqual(shellQuote("$(rm -rf /)"), "'$(rm -rf /)'");
  assert.strictEqual(shellQuote("`id`"), "'`id`'");

  const message = `fix: don't "guess" $HOME; run \`id\``;
  const remote = remoteOf(["-C", "/var/www/kanbandev", "commit-tree", "-m", message, "abc123"]);
  assert.include(remote, `'fix: don'\\''t "guess" $HOME; run \`id\`'`);
  assert.notInclude(remote, `-m ${message}`);
});

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | candidate === repository.mountPath || candidate.startsWith(`${repository.mountPath}/`); → candidate === repository.mountPath || candidate.startsWith(repository.mountPath);
it("GT2: Git at a mount, named by `-C` after configuration flags or by its working directory, runs on that mount's host as `git -C` the same path below the remote root; git outside every mount, at a name that only begins like one or climbing out with `..`, and every command that is not git are left alone", () => {
  assert.strictEqual(
    remoteOf(["-c", "core.fsmonitor=false", "-C", kanban.mountPath, "status"]),
    "git -C /var/www -c core.fsmonitor=false status",
  );
  assert.isUndefined(rewrite(["-C", `${kanban.mountPath}/../elsewhere`, "status"]));

  const byFlag = rewrite(["-C", "/var/www/kanbandev", "status", "--porcelain=2"]);
  assert.isDefined(byFlag);
  assert.strictEqual(byFlag.host, "kanbandev");
  assert.strictEqual(byFlag.remoteCommand, "git -C /var/www status --porcelain=2");

  const byCwd = rewrite(["rev-parse", "HEAD"], { cwd: "/var/www/apidev" });
  assert.isDefined(byCwd);
  assert.strictEqual(byCwd.host, "apidev");
  assert.strictEqual(byCwd.remoteCommand, "git -C /var/www rev-parse HEAD");

  assert.strictEqual(
    remoteOf(["status"], { cwd: "/var/www/kanbandev/packages/app" }),
    "git -C /var/www/packages/app status",
  );

  assert.isUndefined(rewrite(["status"], { cwd: "/home/zerops/somewhere" }));
  assert.isUndefined(rewrite(["-C", "/var/www", "status"]));
  assert.isUndefined(rewrite(["-C", "/var/www/kanbandevil", "status"]));
  assert.isUndefined(rewrite(["status"]));

  for (const command of ["claude", "codex", "gh", "glab", "az", "bash", "node", "zcp"]) {
    assert.isUndefined(
      rewriteGitSpawn(
        { command, args: ["-C", "/var/www/kanbandev", "status"], options: {} },
        repositories,
      ),
    );
  }
});

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | mappedRest.push(`${flag}=${toRemotePath(token.slice(separatorIndex + 1), repository)}`); → mappedRest.push(token);
it("GT3: `--git-dir` and `--work-tree` values are mapped onto the remote root in both spellings, while a workspace path that is a plain argument, as in a commit message, is never rewritten", () => {
  assert.strictEqual(
    remoteOf(["--git-dir", "/var/www/kanbandev/.git", "worktree", "list", "--porcelain"], {
      cwd: "/var/www/kanbandev",
    }),
    "git -C /var/www --git-dir /var/www/.git worktree list --porcelain",
  );
  assert.strictEqual(
    remoteOf(["--work-tree=/var/www/apidev", "status"], { cwd: "/var/www/apidev" }),
    "git -C /var/www --work-tree=/var/www status",
  );

  const remote = remoteOf([
    "-C",
    "/var/www/kanbandev",
    "commit-tree",
    "-m",
    "moved /var/www/kanbandev/src",
    "abc123",
  ]);
  assert.include(remote, "/var/www/kanbandev/src");
});

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | if (!key.startsWith(ENV_ALLOWLIST_PREFIX) && !ENV_ALLOWLIST_EXACT.has(key)) { → if (!key.startsWith(ENV_ALLOWLIST_PREFIX) && ENV_ALLOWLIST_EXACT.has(key)) {
it("GT4: Only `GIT_*` variables other than the trace2 streams, and `LC_ALL`, cross to the remote side, never the server's own environment, and no env prefix is sent when none survives", () => {
  const remote = remoteOf(["status"], {
    cwd: "/var/www/kanbandev",
    env: {
      PATH: "/usr/bin",
      HOME: "/home/zerops",
      ZCP_API_KEY: "secret",
      LC_ALL: "C",
      GIT_AUTHOR_NAME: "Zerops Mate",
    },
  });
  assert.include(remote, "LC_ALL=C");
  // The whole `K=V` token is quoted as one word, which is what `env` reads.
  assert.include(remote, "'GIT_AUTHOR_NAME=Zerops Mate'");
  assert.notInclude(remote, "PATH=");
  assert.notInclude(remote, "HOME=");
  assert.notInclude(remote, "secret");

  const traced = remoteOf(["status"], {
    cwd: "/var/www/kanbandev",
    env: { GIT_TRACE2_EVENT: "/tmp/t3-trace.json", GIT_AUTHOR_NAME: "Zerops Mate" },
  });
  assert.notInclude(traced, "GIT_TRACE2_EVENT");
  assert.include(traced, "GIT_AUTHOR_NAME");

  assert.strictEqual(
    remoteOf(["status"], { cwd: "/var/www/kanbandev", env: { PATH: "/usr/bin" } }),
    "git -C /var/www status",
  );
});

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | `${key}=${PATH_VALUED_ENV.has(key) ? toRemotePath(value, repository) : value}`, → `${key}=${value}`,
it.effect(
  "GT5: No git argv that leaves the server carries a mount path: git inside a mount spawns ssh to that mount's host, its `GIT_INDEX_FILE` mapped onto the host's own disk",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const remote = remoteOf(["add", "-A", "--", "."], {
          cwd: "/var/www/kanbandev",
          env: { GIT_INDEX_FILE: "/var/www/kanbandev/.git/t3-checkpoint-index-uuid" },
        });
        assert.include(remote, "GIT_INDEX_FILE=/var/www/.git/t3-checkpoint-index-uuid");
        assert.notInclude(remote, "/var/www/kanbandev/.git");

        const inner = yield* makeInnerSpawner();
        const spawner = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: inner.spawner,
        });

        yield* spawner.spawn(
          ChildProcess.make("git", ["status", "--porcelain=2"], { cwd: "/var/www/kanbandev" }),
        );
        yield* spawner.spawn(
          ChildProcess.make("git", ["-C", "/var/www/kanbandev", "add", "-A", "--", "."], {
            env: { GIT_INDEX_FILE: "/var/www/kanbandev/.git/t3-index" },
          }),
        );

        const [status, add] = yield* Ref.get(inner.calls);
        assert.strictEqual(status?.command, "ssh");
        assert.strictEqual(status?.args.at(-2), "kanbandev");
        assert.strictEqual(status?.args.at(-1), "git -C /var/www status --porcelain=2");
        assert.strictEqual(add?.command, "ssh");
        assert.notInclude(add?.args.join(" ") ?? "", "/var/www/kanbandev");
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | ...SSH_PINNED_OPTIONS.flatMap((option) => ["-o", option]), → ...SSH_PINNED_OPTIONS.slice(1).flatMap((option) => ["-o", option]),
it("GT6: The ssh invocation pins every connection option rather than inheriting `~/.ssh/config`, and ends with the host and exactly one remote command string", () => {
  const invocation = rewrite(["status"], { cwd: "/var/www/kanbandev" });
  assert.isDefined(invocation);
  assert.strictEqual(invocation.command, "ssh");
  for (const option of SSH_PINNED_OPTIONS) {
    assert.include(invocation.args, option);
  }
  assert.include(invocation.args, "-o");
  assert.include(invocation.args, "ControlPath=/tmp/ssh-mux-%r@%h:%p");
  assert.include(invocation.args, "ControlPersist=600");
  assert.strictEqual(invocation.args.at(-2), "kanbandev");
  assert.strictEqual(invocation.args.at(-1), invocation.remoteCommand);
});

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | return args.includes("--show-toplevel"); → return true;
it.effect(
  "GT7: Only `rev-parse --show-toplevel` and `worktree list` have their stdout mapped back to the mount, at a path position only; every other output passes as git wrote it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        assert.strictEqual(
          rewrite(["-C", "/var/www/kanbandev", "rev-parse", "--show-toplevel"])?.mapsStdoutPaths,
          true,
        );
        assert.strictEqual(
          rewrite(
            ["--git-dir", "/var/www/kanbandev/.git", "worktree", "list", "--porcelain", "-z"],
            {
              cwd: "/var/www/kanbandev",
            },
          )?.mapsStdoutPaths,
          true,
        );
        assert.strictEqual(
          rewrite(["-C", "/var/www/kanbandev", "rev-parse", "--git-common-dir"])?.mapsStdoutPaths,
          false,
        );
        assert.strictEqual(rewrite(["-C", "/var/www/kanbandev", "status"])?.mapsStdoutPaths, false);

        assert.strictEqual(mapRemotePathsToMount("/var/www\n", kanban), "/var/www/kanbandev\n");
        assert.strictEqual(
          mapRemotePathsToMount("worktree /var/www\0HEAD abc\0", kanban),
          "worktree /var/www/kanbandev\0HEAD abc\0",
        );
        assert.strictEqual(
          mapRemotePathsToMount("/var/www/packages/app\n", kanban),
          "/var/www/kanbandev/packages/app\n",
        );
        assert.strictEqual(mapRemotePathsToMount("/var/wwwroot\n", kanban), "/var/wwwroot\n");

        const toplevel = yield* makeInnerSpawner({ stdout: "/var/www\n" });
        const mapped = yield* makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: toplevel.spawner,
        }).spawn(
          ChildProcess.make("git", ["rev-parse", "--show-toplevel"], { cwd: "/var/www/kanbandev" }),
        );
        const mappedChunks = yield* Stream.runCollect(mapped.stdout);
        assert.strictEqual(
          mappedChunks.map((chunk) => decoder.decode(chunk)).join(""),
          "/var/www/kanbandev\n",
        );

        const commonDir = yield* makeInnerSpawner({ stdout: ".git\n" });
        const untouched = yield* makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: commonDir.spawner,
        }).spawn(
          ChildProcess.make("git", ["rev-parse", "--git-common-dir"], {
            cwd: "/var/www/kanbandev",
          }),
        );
        const untouchedChunks = yield* Stream.runCollect(untouched.stdout);
        assert.strictEqual(
          untouchedChunks.map((chunk) => decoder.decode(chunk)).join(""),
          ".git\n",
        );
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | if (command._tag === "PipedCommand" && mentionsRemoteLocation(command)) { → if (command._tag === "PipedCommand" && !mentionsRemoteLocation(command)) {
it.effect("GT8: A pipeline that names a mount is refused before anything runs", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const inner = yield* makeInnerSpawner();
      const spawner = makeZeropsGitSpawner({
        enabled: true,
        repositories: available(repositories),
        inner: inner.spawner,
      });
      const command = ChildProcess.make("git", ["status"], { cwd: kanban.mountPath }).pipe(
        ChildProcess.pipeTo(ChildProcess.make("cat")),
      );

      const outcome = yield* Effect.result(spawner.spawn(command));

      assert.strictEqual(outcome._tag, "Failure");
      assert.deepStrictEqual(yield* Ref.get(inner.calls), []);
    }),
  ),
);

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | ...(scoped ? [scoped] : []), → ...[],
it.effect(
  "GT9: Git run for an unmounted earlier binding goes over ssh guarded by that binding's own service identity, never the current one's",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const inner = yield* makeInnerSpawner();
        const current = { ...kanban, identity: { projectId: "project", serviceId: "new-service" } };
        const historical = {
          ...kanban,
          identity: { projectId: "project", serviceId: "old-service" },
        };
        const spawner = makeZeropsGitSpawner({
          enabled: true,
          repositories: available([]),
          known: Effect.succeed([current]),
          inner: inner.spawner,
        });

        yield* withRepository(
          historical,
          spawner.spawn(ChildProcess.make("git", ["show", "abc"], { cwd: kanban.mountPath })),
        );

        const [call] = yield* Ref.get(inner.calls);
        assert.strictEqual(call?.command, "ssh");
        assert.include(call?.args.at(-1) ?? "", '"${serviceId-}" = old-service');
        assert.notInclude(call?.args.at(-1) ?? "", "new-service");
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | if (!options.enabled) { → if (false) {
it.effect(
  "GT10: Outside a Zerops environment, and for every command that is not git, the spawner hands the command to the platform untouched, and layered in front of the platform spawner it still reaches it",
  () =>
    Effect.gen(function* () {
      const nonGit = yield* makeInnerSpawner();
      yield* Effect.scoped(
        makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: nonGit.spawner,
        }).spawn(ChildProcess.make("claude", ["--print", "hi"], { cwd: "/var/www/kanbandev" })),
      );
      assert.deepStrictEqual(yield* Ref.get(nonGit.calls), [
        { command: "claude", args: ["--print", "hi"] },
      ]);

      const outside = yield* makeInnerSpawner();
      yield* Effect.scoped(
        makeZeropsGitSpawner({
          enabled: false,
          repositories: available(repositories),
          inner: outside.spawner,
        }).spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/kanbandev" })),
      );
      const [untouched] = yield* Ref.get(outside.calls);
      assert.strictEqual(untouched?.command, "git");

      const platformSpawner = yield* makeInnerSpawner();
      const platform = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        platformSpawner.spawner,
      );
      const decorator = Layer.effect(
        ChildProcessSpawner.ChildProcessSpawner,
        Effect.gen(function* () {
          const inner = yield* ChildProcessSpawner.ChildProcessSpawner;
          return makeZeropsGitSpawner({
            enabled: true,
            repositories: available(repositories),
            inner,
          });
        }),
      );
      yield* Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        yield* Effect.scoped(
          spawner.spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/kanbandev" })),
        );
      }).pipe(Effect.provide(decorator.pipe(Layer.provideMerge(platform))));
      const reached = yield* Ref.get(platformSpawner.calls);
      assert.deepStrictEqual(
        reached.map((call) => call.command),
        ["ssh"],
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | (fresh.limitations?.length ?? 0) === 0 && → (fresh.limitations?.length ?? 0) >= 0 &&
it.effect(
  "GT11: Git that names a workspace path while the mount table is unread, an attachment there is unidentified, or its git directory lies in a mount is refused before anything runs",
  () =>
    Effect.gen(function* () {
      const rows: ReadonlyArray<{
        readonly read: ZeropsRepositories;
        readonly command: ChildProcess.Command;
      }> = [
        {
          read: { _tag: "unavailable", reason: "no credentials" },
          command: ChildProcess.make("git", ["status"], { cwd: "/var/www/kanbandev" }),
        },
        {
          read: {
            _tag: "available",
            repositories,
            limitations: ["Some SSHFS attachments could not be identified."],
          },
          command: ChildProcess.make("git", ["status"], { cwd: "/var/www/imgrun" }),
        },
        {
          read: { _tag: "available", repositories },
          command: ChildProcess.make("git", ["status"], {
            cwd: "/tmp/elsewhere",
            env: { GIT_DIR: "/var/www/kanbandev/.git" },
          }),
        },
      ];
      for (const { read, command } of rows) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const inner = yield* makeInnerSpawner();
            const spawner = makeZeropsGitSpawner({
              enabled: true,
              repositories: Effect.succeed(read),
              refresh: Effect.succeed(read),
              inner: inner.spawner,
            });

            const result = yield* Effect.result(spawner.spawn(command));

            assert.strictEqual(result._tag, "Failure");
            assert.deepStrictEqual(yield* Ref.get(inner.calls), []);
          }),
        );
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | const fresh = options.refresh === undefined ? repositories : yield* options.refresh; → const fresh = repositories;
it.effect(
  "GT12: Git at a workspace path no mount holds, in a mount table read afresh for that spawn, runs on this container's own disk below the workspace root as its ceiling, while a path mounted since the last read goes over ssh to its host",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const unmounted = yield* makeInnerSpawner();
        const local = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          refresh: available(repositories),
          inner: unmounted.spawner,
        });
        yield* local.spawn(
          ChildProcess.make("git", ["-C", "/var/www/imgrun", "rev-parse", "--is-inside-work-tree"]),
        );
        yield* local.spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/imgrun" }));
        assert.deepStrictEqual(yield* Ref.get(unmounted.calls), [
          { command: "git", args: ["-C", "/var/www/imgrun", "rev-parse", "--is-inside-work-tree"] },
          { command: "git", args: ["status"] },
        ]);

        const ceiling = yield* makeInnerSpawner();
        const ceilinged = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          refresh: available(repositories),
          inner: ceiling.spawner,
        });
        yield* ceilinged.spawn(
          ChildProcess.make("git", ["-C", "/var/www/imgrun", "status"], {
            env: { GIT_CEILING_DIRECTORIES: "/home/zerops", LC_ALL: "C" },
          }),
        );
        yield* ceilinged.spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/imgrun" }));
        const [first, second] = yield* Ref.get(ceiling.envs);
        assert.includeMembers(first?.env?.GIT_CEILING_DIRECTORIES?.split(":") ?? [], [
          "/var/www",
          "/home/zerops",
        ]);
        assert.strictEqual(first?.env?.LC_ALL, "C");
        assert.include(second?.env?.GIT_CEILING_DIRECTORIES?.split(":") ?? [], "/var/www");
        assert.isTrue(second?.extendEnv, "a command with no environment still inherits PATH");

        const later = yield* makeInnerSpawner();
        const mountedNow = yield* Ref.make(false);
        const imgrun: ZeropsRepository = {
          host: "imgrun",
          mountPath: "/var/www/imgrun",
          remotePath: "/var/www",
        };
        const status = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          refresh: Effect.flatMap(Ref.get(mountedNow), (mounted) =>
            available(mounted ? [...repositories, imgrun] : repositories),
          ),
          inner: later.spawner,
        }).spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/imgrun" }));
        yield* status;
        // The lease mounts its checkout there a moment later.
        yield* Ref.set(mountedNow, true);
        yield* status;
        assert.deepStrictEqual(
          (yield* Ref.get(later.calls)).map((call) => call.command),
          ["git", "ssh"],
        );

        const reread = yield* makeInnerSpawner();
        const newdev: ZeropsRepository = {
          host: "newdev",
          mountPath: "/var/www/newdev",
          remotePath: "/var/www",
        };
        yield* makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          refresh: available([...repositories, newdev]),
          inner: reread.spawner,
        }).spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/newdev" }));
        const [call] = yield* Ref.get(reread.calls);
        assert.strictEqual(call?.command, "ssh");
        assert.strictEqual(call?.args.at(-2), "newdev");
      }),
    ),
);

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | mentioned.every(isPlainPath) && → mentioned.length > 0 &&
it.effect(
  "GT13: Local git never runs against a mount named through `..`, `.`, `//` or a relative git directory",
  () =>
    Effect.gen(function* () {
      const rows: ReadonlyArray<{
        readonly args: ReadonlyArray<string>;
        readonly cwd?: string;
        readonly env?: Record<string, string>;
      }> = [
        { args: ["-C", "/var/www/imgrun/../kanbandev"] },
        { args: ["-C", "../kanbandev", "status"], cwd: "/var/www/imgrun" },
        { args: ["status"], cwd: "/var/www/./kanbandev" },
        { args: ["--git-dir=/var/www//kanbandev/.git", "status"], cwd: "/var/www/imgrun" },
        {
          args: ["status"],
          cwd: "/var/www/imgrun",
          env: { GIT_DIR: "/var/www/imgrun/../kanbandev/.git" },
        },
        { args: ["status"], cwd: "/var/www/imgrun", env: { GIT_DIR: "../kanbandev/.git" } },
      ];
      for (const { args, cwd, env } of rows) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const inner = yield* makeInnerSpawner();
            const spawner = makeZeropsGitSpawner({
              enabled: true,
              repositories: available(repositories),
              refresh: available(repositories),
              inner: inner.spawner,
            });

            yield* Effect.result(
              spawner.spawn(
                ChildProcess.make("git", args, {
                  ...(cwd === undefined ? {} : { cwd }),
                  ...(env === undefined ? {} : { env }),
                }),
              ),
            );

            const local = (yield* Ref.get(inner.calls)).filter((call) => call.command === "git");
            assert.deepStrictEqual(local, []);
          }),
        );
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | code === SSH_TRANSPORT_EXIT_CODE → code === SSH_TRANSPORT_EXIT_CODE + 1
it.effect(
  "GT14: A git failure passes through as its own exit code, while ssh's 255 is logged once as a transport failure naming the host",
  () => {
    const messages: Array<unknown> = [];
    const logger = Logger.make<unknown, void>((options) => {
      messages.push(options.message);
    });
    const namesHost = (message: unknown): boolean =>
      (Array.isArray(message) ? message : [message]).some(
        (part: unknown) =>
          typeof part === "object" && part !== null && "host" in part && part.host === "kanbandev",
      );

    return Effect.scoped(
      Effect.gen(function* () {
        const failing = yield* makeInnerSpawner({ exitCode: 1 });
        const gitFailure = yield* makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: failing.spawner,
        }).spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/kanbandev" }));
        assert.strictEqual(yield* gitFailure.exitCode, 1);

        const unreachable = yield* makeInnerSpawner({ exitCode: 255 });
        const transport = yield* makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: unreachable.spawner,
        }).spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/kanbandev" }));
        assert.strictEqual(yield* transport.exitCode, 255);
        assert.strictEqual(messages.filter(namesHost).length, 1);
      }),
    ).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  },
);

// witness: apps/server/src/zerops/ZeropsGitSpawner.ts | const gate = gateFor(invocation.host); → const gate = gateFor("");
it.effect(
  "GT15: At most four git sessions run at once on one host, and one host's sessions never hold back another's",
  () =>
    Effect.gen(function* () {
      const hold = yield* Deferred.make<void>();
      const inner = yield* makeInnerSpawner({ hold });
      const spawner = makeZeropsGitSpawner({
        enabled: true,
        repositories: available(repositories),
        inner: inner.spawner,
      });
      const run = (repository: ZeropsRepository) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(
              ChildProcess.make("git", ["status"], { cwd: repository.mountPath }),
            );
            yield* handle.exitCode;
          }),
        );

      const fibers = yield* Effect.forEach(
        [kanban, kanban, kanban, kanban, kanban, kanban, api, api, api, api],
        (repository) => Effect.forkChild(run(repository)),
      );
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      const started = yield* Ref.get(inner.calls);
      const perHost = (host: string) => started.filter((call) => call.args.includes(host)).length;
      assert.strictEqual(perHost("kanbandev"), 4);
      assert.strictEqual(perHost("apidev"), 4);

      yield* Deferred.succeed(hold, undefined);
      yield* Effect.forEach(fibers, Fiber.join);
      assert.strictEqual((yield* Ref.get(inner.calls)).length, 10);
    }),
);

const REF = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d\trefs/heads/";

// witness: apps/server/src/zerops/ZeropsGitRemoteProbe.ts | return stdout.split("\n").filter((line) => line.trim().length > 0).length; → return stdout.split("\n").length;
it.effect(
  "GT16: A remote probe reads reachable with the number of branches the remote advertised, an empty repository included, for the remote the caller named or else origin",
  () =>
    Effect.gen(function* () {
      const two = yield* runProbe(
        Effect.succeed(probeOutput({ stdout: `${REF}main\n${REF}feature/invoices\n`, code: 0 })),
        { cwd: "/var/www/appdev" },
      );
      assert.deepStrictEqual(answered(two.result), {
        reachable: true,
        remote: "origin",
        refCount: 2,
        detail: null,
      });
      assert.deepStrictEqual(two.args, [["git", "appdev", "ls-remote", "--heads", "--", "origin"]]);

      const empty = yield* runProbe(Effect.succeed(probeOutput({ stdout: "", code: 0 })), {
        cwd: "/var/www/appdev",
      });
      assert.deepStrictEqual(answered(empty.result), {
        reachable: true,
        remote: "origin",
        refCount: 0,
        detail: null,
      });

      const named = yield* runProbe(Effect.succeed(probeOutput({ stdout: "", code: 0 })), {
        cwd: "/var/www/appdev",
        remote: "upstream",
      });
      assert.strictEqual(answered(named.result).remote, "upstream");
      assert.deepStrictEqual(named.args, [
        ["git", "appdev", "ls-remote", "--heads", "--", "upstream"],
      ]);

      for (const { stdout, expected } of [
        { stdout: "a\tb\nc\td\n", expected: 2 },
        { stdout: "a\tb\n\n\n", expected: 1 },
        { stdout: "", expected: 0 },
      ]) {
        const counted = yield* runProbe(Effect.succeed(probeOutput({ stdout, code: 0 })), {
          cwd: "/var/www/appdev",
        });
        assert.strictEqual(answered(counted.result).refCount, expected);
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsGitRemoteProbe.ts | const remote = lines.find((line) => line.startsWith("remote:")); → const remote = lines.find((line) => line.startsWith("fatal:"));
it.effect(
  "GT17: A remote that refuses is a success that reads unreachable with the server's own `remote:` line, else git's first line, at most 200 characters, while a probe that could not run at all is an error",
  () =>
    Effect.gen(function* () {
      const refused = yield* runProbe(
        Effect.succeed(
          probeOutput({
            stderr: "remote: Repository not found.\nfatal: authentication failed\n",
            code: 128,
          }),
        ),
        { cwd: "/var/www/appdev" },
      );
      assert.strictEqual(answered(refused.result).reachable, false);
      assert.strictEqual(answered(refused.result).detail, "remote: Repository not found.");

      for (const { stderr, expected } of [
        { stderr: "fatal: x\nremote: gone\n", expected: "remote: gone" },
        { stderr: "fatal: x\ny\n", expected: "fatal: x" },
      ]) {
        const read = yield* runProbe(Effect.succeed(probeOutput({ stderr, code: 128 })), {
          cwd: "/var/www/appdev",
        });
        assert.strictEqual(answered(read.result).detail, expected);
      }

      const long = yield* runProbe(
        Effect.succeed(probeOutput({ stderr: `remote: ${"x".repeat(500)}`, code: 128 })),
        { cwd: "/var/www/appdev" },
      );
      assert.strictEqual(answered(long.result).detail?.length, 200);

      const notRun = yield* runProbe(
        Effect.fail(
          new ProcessRunner.ProcessSpawnError({
            command: "zcp",
            argumentCount: 6,
            cause: Object.assign(new Error("spawn zcp ENOENT"), { code: "ENOENT" }),
          }),
        ),
        { cwd: "/var/www/appdev" },
      );
      assert.strictEqual(notRun.result._tag, "Failure");
      if (notRun.result._tag === "Failure") {
        assert.strictEqual(notRun.result.failure._tag, "ZeropsGitRemoteProbeError");
      }
    }),
);
