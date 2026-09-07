import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { withRepository } from "./ZeropsWorkspaceAccess.ts";
import type { ZeropsRepositories, ZeropsRepository } from "./ZeropsRepositorySource.ts";
import {
  MAX_GIT_SESSIONS_PER_HOST,
  SSH_PINNED_OPTIONS,
  makeZeropsGitSpawner,
  mapRemotePathsToMount,
  rewriteGitSpawn,
  shellQuote,
} from "./ZeropsGitSpawner.ts";

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
const remoteOf = (args: ReadonlyArray<string>, options = {}) => {
  const invocation = rewrite(args, options);
  assert.isDefined(invocation);
  return invocation.remoteCommand;
};

describe("shellQuote", () => {
  it("leaves shell-safe tokens alone and quotes everything else", () => {
    assert.strictEqual(shellQuote("/var/www"), "/var/www");
    assert.strictEqual(shellQuote("--porcelain=2"), "--porcelain=2");
    assert.strictEqual(shellQuote("a b"), "'a b'");
    assert.strictEqual(shellQuote(""), "''");
  });

  it("survives a single quote, which is the only character that ends a quote", () => {
    assert.strictEqual(shellQuote("it's"), "'it'\\''s'");
    assert.strictEqual(shellQuote("$(rm -rf /)"), "'$(rm -rf /)'");
    assert.strictEqual(shellQuote("`id`"), "'`id`'");
  });
});

describe("rewriteGitSpawn — what gets rewritten and what does not", () => {
  it("resolves -C after Git configuration flags", () => {
    assert.strictEqual(
      remoteOf(["-c", "core.fsmonitor=false", "-C", kanban.mountPath, "status"]),
      "git -C /var/www -c core.fsmonitor=false status",
    );
    assert.isUndefined(rewrite(["-C", `${kanban.mountPath}/../elsewhere`, "status"]));
  });

  it("leaves every non-git command alone", () => {
    for (const command of ["claude", "codex", "gh", "glab", "az", "bash", "node", "zcp"]) {
      assert.isUndefined(
        rewriteGitSpawn(
          { command, args: ["-C", "/var/www/kanbandev", "status"], options: {} },
          repositories,
        ),
      );
    }
  });

  it("leaves git alone outside every mount", () => {
    assert.isUndefined(rewrite(["status"], { cwd: "/home/zerops/somewhere" }));
    assert.isUndefined(rewrite(["-C", "/var/www", "status"]));
    assert.isUndefined(rewrite(["-C", "/var/www/kanbandevil", "status"]));
    assert.isUndefined(rewrite(["status"]));
  });

  it("resolves the host from the -C form and rewrites -C to the remote path", () => {
    const invocation = rewrite(["-C", "/var/www/kanbandev", "status", "--porcelain=2"]);
    assert.isDefined(invocation);
    assert.strictEqual(invocation.host, "kanbandev");
    assert.strictEqual(invocation.remoteCommand, "git -C /var/www status --porcelain=2");
  });

  it("resolves the host from options.cwd when there is no -C", () => {
    const invocation = rewrite(["rev-parse", "HEAD"], { cwd: "/var/www/apidev" });
    assert.isDefined(invocation);
    assert.strictEqual(invocation.host, "apidev");
    assert.strictEqual(invocation.remoteCommand, "git -C /var/www rev-parse HEAD");
  });

  it("maps a path below the mount root onto the same path below the remote root", () => {
    assert.strictEqual(
      remoteOf(["status"], { cwd: "/var/www/kanbandev/packages/app" }),
      "git -C /var/www/packages/app status",
    );
  });

  it("quotes remote tokens POSIX-safely, so a commit message survives intact", () => {
    const message = `fix: don't "guess" $HOME; run \`id\``;
    const remote = remoteOf(["-C", "/var/www/kanbandev", "commit-tree", "-m", message, "abc123"]);
    assert.include(remote, shellQuote(message));
    assert.notInclude(remote, `-m ${message}`);
  });

  it("never rewrites a /var/www path that is an argument rather than a location", () => {
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

  it("maps --git-dir and --work-tree values, in both spellings", () => {
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
  });
});

describe("rewriteGitSpawn — the environment that crosses the wire", () => {
  it("forwards only GIT_* and LC_ALL, and never the server's own environment", () => {
    const remote = remoteOf(["status"], {
      cwd: "/var/www/kanbandev",
      env: {
        PATH: "/usr/bin",
        HOME: "/home/zerops",
        ZCP_API_KEY: "secret",
        LC_ALL: "C",
        GIT_AUTHOR_NAME: "T3 Code",
      },
    });
    assert.include(remote, "LC_ALL=C");
    // The whole `K=V` token is quoted as one word, which is what `env` reads.
    assert.include(remote, "'GIT_AUTHOR_NAME=T3 Code'");
    assert.notInclude(remote, "PATH=");
    assert.notInclude(remote, "HOME=");
    assert.notInclude(remote, "secret");
  });

  it("strips the trace2 event stream, whose file is local and whose watcher never fires", () => {
    const remote = remoteOf(["status"], {
      cwd: "/var/www/kanbandev",
      env: { GIT_TRACE2_EVENT: "/tmp/t3-trace.json", GIT_AUTHOR_NAME: "T3 Code" },
    });
    assert.notInclude(remote, "GIT_TRACE2_EVENT");
    assert.include(remote, "GIT_AUTHOR_NAME");
  });

  it("maps GIT_INDEX_FILE onto the host's own disk", () => {
    const remote = remoteOf(["add", "-A", "--", "."], {
      cwd: "/var/www/kanbandev",
      env: { GIT_INDEX_FILE: "/var/www/kanbandev/.git/t3-checkpoint-index-uuid" },
    });
    assert.include(remote, "GIT_INDEX_FILE=/var/www/.git/t3-checkpoint-index-uuid");
    assert.notInclude(remote, "/var/www/kanbandev/.git");
  });

  it("emits no env prefix when nothing survives the allowlist", () => {
    assert.strictEqual(
      remoteOf(["status"], { cwd: "/var/www/kanbandev", env: { PATH: "/usr/bin" } }),
      "git -C /var/www status",
    );
  });
});

describe("rewriteGitSpawn — the ssh invocation", () => {
  it("pins every connection option rather than inheriting ~/.ssh/config", () => {
    const invocation = rewrite(["status"], { cwd: "/var/www/kanbandev" });
    assert.isDefined(invocation);
    assert.strictEqual(invocation.command, "ssh");
    for (const option of SSH_PINNED_OPTIONS) {
      assert.include(invocation.args, option);
    }
    assert.include(invocation.args, "-o");
    assert.include(invocation.args, "ControlPath=/tmp/ssh-mux-%r@%h:%p");
    assert.include(invocation.args, "ControlPersist=600");
  });

  it("puts the host last, followed by exactly one remote command string", () => {
    const invocation = rewrite(["status"], { cwd: "/var/www/kanbandev" });
    assert.isDefined(invocation);
    assert.strictEqual(invocation.args.at(-2), "kanbandev");
    assert.strictEqual(invocation.args.at(-1), invocation.remoteCommand);
  });
});

describe("rewriteGitSpawn — which outputs carry a path back", () => {
  it("maps the two argv shapes that return an absolute path", () => {
    assert.strictEqual(
      rewrite(["-C", "/var/www/kanbandev", "rev-parse", "--show-toplevel"])?.mapsStdoutPaths,
      true,
    );
    assert.strictEqual(
      rewrite(["--git-dir", "/var/www/kanbandev/.git", "worktree", "list", "--porcelain", "-z"], {
        cwd: "/var/www/kanbandev",
      })?.mapsStdoutPaths,
      true,
    );
  });

  it("leaves --git-common-dir alone, because git answers it relatively", () => {
    assert.strictEqual(
      rewrite(["-C", "/var/www/kanbandev", "rev-parse", "--git-common-dir"])?.mapsStdoutPaths,
      false,
    );
    assert.strictEqual(rewrite(["-C", "/var/www/kanbandev", "status"])?.mapsStdoutPaths, false);
  });

  it("rewrites a returned path at a path position only", () => {
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
  });
});

interface SpawnRecord {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

const makeInnerSpawner = (options?: {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly hold?: Deferred.Deferred<void>;
}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<SpawnRecord>>([]);
    const inFlight = yield* Ref.make(0);
    const peak = yield* Ref.make(0);
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        assert.strictEqual(command._tag, "StandardCommand");
        if (command._tag !== "StandardCommand") {
          return yield* Effect.die("piped command");
        }
        yield* Ref.update(calls, (previous) => [
          ...previous,
          { command: command.command, args: command.args },
        ]);
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
    return { spawner, calls, peak } as const;
  });

const available = (list: ReadonlyArray<ZeropsRepository>): Effect.Effect<ZeropsRepositories> =>
  Effect.succeed({ _tag: "available", repositories: list });

describe("makeZeropsGitSpawner", () => {
  it.effect("does not let an unsupported pipeline bypass the remote boundary", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const inner = yield* makeInnerSpawner();
        const spawner = makeZeropsGitSpawner({
          enabled: true,
          repositories: Effect.succeed({ _tag: "available", repositories }),
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

  it.effect(
    "routes an unmounted historical binding over SSH and preserves its expected identity",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const inner = yield* makeInnerSpawner();
          const current = {
            ...kanban,
            identity: { projectId: "project", serviceId: "new-service" },
          };
          const historical = {
            ...kanban,
            identity: { projectId: "project", serviceId: "old-service" },
          };
          const spawner = makeZeropsGitSpawner({
            enabled: true,
            repositories: Effect.succeed({ _tag: "available", repositories: [] }),
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

  it("bounds snapshot scripts on the remote side after identity verification", () => {
    const invocation = rewriteGitSpawn(
      {
        command: "git",
        args: ["-c", "alias.mate-snapshot=!echo test", "mate-snapshot"],
        options: { cwd: kanban.mountPath },
      },
      [{ ...kanban, identity: { projectId: "p", serviceId: "s" } }],
    );
    assert.include(invocation?.remoteCommand ?? "", "exit 126; }; exec timeout -k 2 30 git");
  });

  it.effect("hands a non-git command to the inner spawner untouched", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const inner = yield* makeInnerSpawner();
        const spawner = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: inner.spawner,
        });
        const command = ChildProcess.make("claude", ["--print", "hi"], {
          cwd: "/var/www/kanbandev",
        });

        yield* spawner.spawn(command);

        assert.deepStrictEqual(yield* Ref.get(inner.calls), [
          { command: "claude", args: ["--print", "hi"] },
        ]);
      }),
    ),
  );

  it.effect("hands git through untouched when this is not a Zerops environment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const inner = yield* makeInnerSpawner();
        const spawner = makeZeropsGitSpawner({
          enabled: false,
          repositories: available(repositories),
          inner: inner.spawner,
        });

        yield* spawner.spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/kanbandev" }));

        const [call] = yield* Ref.get(inner.calls);
        assert.strictEqual(call?.command, "git");
      }),
    ),
  );

  it.effect(
    "refuses local Git against an unresolved remote path when discovery is unavailable",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const inner = yield* makeInnerSpawner();
          const spawner = makeZeropsGitSpawner({
            enabled: true,
            repositories: Effect.succeed({ _tag: "unavailable", reason: "no credentials" }),
            inner: inner.spawner,
          });

          const result = yield* Effect.result(
            spawner.spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/kanbandev" })),
          );
          assert.strictEqual(result._tag, "Failure");

          assert.deepStrictEqual(yield* Ref.get(inner.calls), []);
        }),
      ),
  );

  it.effect("spawns ssh for a git command inside a mount", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const inner = yield* makeInnerSpawner();
        const spawner = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: inner.spawner,
        });

        yield* spawner.spawn(
          ChildProcess.make("git", ["status", "--porcelain=2"], { cwd: "/var/www/kanbandev" }),
        );

        const [call] = yield* Ref.get(inner.calls);
        assert.strictEqual(call?.command, "ssh");
        assert.strictEqual(call?.args.at(-2), "kanbandev");
        assert.strictEqual(call?.args.at(-1), "git -C /var/www status --porcelain=2");
      }),
    ),
  );

  it.effect("no git argv ever carries a mount path", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const inner = yield* makeInnerSpawner();
        const spawner = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: inner.spawner,
        });

        yield* spawner.spawn(
          ChildProcess.make("git", ["-C", "/var/www/kanbandev", "add", "-A", "--", "."], {
            env: { GIT_INDEX_FILE: "/var/www/kanbandev/.git/t3-index" },
          }),
        );

        const [call] = yield* Ref.get(inner.calls);
        assert.notInclude(call?.args.join(" ") ?? "", "/var/www/kanbandev");
      }),
    ),
  );

  it.effect("maps an absolute path back to the mount on the way out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const inner = yield* makeInnerSpawner({ stdout: "/var/www\n" });
        const spawner = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: inner.spawner,
        });

        const handle = yield* spawner.spawn(
          ChildProcess.make("git", ["rev-parse", "--show-toplevel"], {
            cwd: "/var/www/kanbandev",
          }),
        );
        const chunks = yield* Stream.runCollect(handle.stdout);

        assert.strictEqual(
          chunks.map((chunk) => decoder.decode(chunk)).join(""),
          "/var/www/kanbandev\n",
        );
      }),
    ),
  );

  it.effect("leaves stdout alone for every other argv shape", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const inner = yield* makeInnerSpawner({ stdout: ".git\n" });
        const spawner = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: inner.spawner,
        });

        const handle = yield* spawner.spawn(
          ChildProcess.make("git", ["rev-parse", "--git-common-dir"], {
            cwd: "/var/www/kanbandev",
          }),
        );
        const chunks = yield* Stream.runCollect(handle.stdout);

        assert.strictEqual(chunks.map((chunk) => decoder.decode(chunk)).join(""), ".git\n");
      }),
    ),
  );

  it.effect("passes a git failure through as the git exit code it is", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const inner = yield* makeInnerSpawner({ exitCode: 1 });
        const spawner = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: inner.spawner,
        });

        const handle = yield* spawner.spawn(
          ChildProcess.make("git", ["status"], { cwd: "/var/www/kanbandev" }),
        );

        assert.strictEqual(yield* handle.exitCode, 1);
      }),
    ),
  );

  it.effect("names an ssh transport failure rather than letting it read as a git verdict", () => {
    const messages: Array<unknown> = [];
    const logger = Logger.make<unknown, void>((options) => {
      messages.push(options.message);
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const inner = yield* makeInnerSpawner({ exitCode: 255 });
        const spawner = makeZeropsGitSpawner({
          enabled: true,
          repositories: available(repositories),
          inner: inner.spawner,
        });

        const handle = yield* spawner.spawn(
          ChildProcess.make("git", ["status"], { cwd: "/var/www/kanbandev" }),
        );

        assert.strictEqual(yield* handle.exitCode, 255);
        const transport = messages.filter((message) =>
          JSON.stringify(message ?? "").includes("kanbandev"),
        );
        assert.strictEqual(transport.length, 1);
      }),
    ).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });

  it.effect("caps concurrent sessions per host without capping across hosts", () =>
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
        [
          ...Array.from({ length: MAX_GIT_SESSIONS_PER_HOST + 2 }, () => kanban),
          ...Array.from({ length: MAX_GIT_SESSIONS_PER_HOST }, () => api),
        ],
        (repository) => Effect.forkChild(run(repository)),
      );

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      const started = yield* Ref.get(inner.calls);
      const perHost = (host: string) => started.filter((call) => call.args.includes(host)).length;
      assert.strictEqual(perHost("kanbandev"), MAX_GIT_SESSIONS_PER_HOST);
      assert.strictEqual(perHost("apidev"), MAX_GIT_SESSIONS_PER_HOST);

      yield* Deferred.succeed(hold, undefined);
      yield* Effect.forEach(fibers, Fiber.join);

      assert.strictEqual((yield* Ref.get(inner.calls)).length, MAX_GIT_SESSIONS_PER_HOST * 2 + 2);
    }),
  );
});

describe("the spawner's place in the layer graph", () => {
  it.effect("sits in front of the platform spawner, which it still reaches itself", () =>
    Effect.gen(function* () {
      const consumed = yield* Ref.make<ReadonlyArray<string>>([]);
      const platform = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) =>
          Effect.gen(function* () {
            assert.strictEqual(command._tag, "StandardCommand");
            const record = command._tag === "StandardCommand" ? command.command : "piped";
            yield* Ref.update(consumed, (previous) => [...previous, record]);
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              unref: Effect.succeed(Effect.void),
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
            });
          }),
        ),
      );

      const consumer = Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        yield* Effect.scoped(
          spawner.spawn(ChildProcess.make("git", ["status"], { cwd: "/var/www/kanbandev" })),
        );
        return yield* Ref.get(consumed);
      });

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

      const seen = yield* consumer.pipe(
        Effect.provide(decorator.pipe(Layer.provideMerge(platform))),
      );

      assert.deepStrictEqual(seen, ["ssh"]);
    }),
  );
});
