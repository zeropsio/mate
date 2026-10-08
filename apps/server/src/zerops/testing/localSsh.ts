// @effect-diagnostics nodeBuiltinImport:off
/**
 * The network, faked for tests that run a Zerops remote command stack.
 *
 * An `ssh` spawn becomes `/bin/sh -c <remote command>` on this machine, so a
 * temporary repository stands in for a dev service's `remotePath` while
 * everything above the spawn - argv, identity guard, quoting, stream
 * collection - is production code. `env` is what the far side's login shell
 * would carry: pass `projectId` and `serviceId` so `identityGuard` passes, or
 * a `PATH` that supplies a tool the remote has and this machine lacks. GNU
 * `timeout`, which every remote has and macOS lacks, is always this file's
 * own, so a test's check runs alike on every machine.
 *
 * @module localSsh
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../../processRunner.ts";

/**
 * `timeout [-k grace] seconds command…` as GNU coreutils runs it (exit 124 when
 * it stops the command).
 */
const TIMEOUT_SHIM = `#!/bin/sh
[ "$1" = "-k" ] && shift 2
seconds=$1
shift
exec perl -e '
  my $seconds = shift;
  my $pid = fork // die "fork: $!";
  if ($pid == 0) { exec @ARGV or exit 127 }
  $SIG{ALRM} = sub { kill "TERM", $pid; waitpid $pid, 0; exit 124 };
  alarm $seconds;
  waitpid $pid, 0;
  exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
' "$seconds" "$@"
`;

let shimmedPath: string | undefined;

/**
 * A `PATH` whose `timeout` is this shim, on every machine alike: a host's own
 * (GNU coreutils on Linux, none on macOS) never decides how a test's check runs.
 */
const pathWithTimeout = (): string => {
  if (shimmedPath !== undefined) return shimmedPath;
  const bin = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-local-ssh-bin-"));
  NodeFS.writeFileSync(NodePath.join(bin, "timeout"), TIMEOUT_SHIM, { mode: 0o755 });
  process.once("exit", () => NodeFS.rmSync(bin, { recursive: true, force: true }));
  return (shimmedPath = `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`);
};

/**
 * How long the far side's processes may take to stop when their session is ended, before they are
 * killed. A real service keeps running what a dropped ssh started, but there the repository outlives
 * the session; here a test removes it once its session ends, so nothing of the session may outlive
 * it: the spawner kills the whole group and waits until it is gone.
 */
const FAR_SIDE_STOP_GRACE = "1 second";

/** Runs what ssh was asked to run on the far side, here instead. */
export const localSshSpawner = (
  inner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  env?: Readonly<Record<string, string>>,
): ChildProcessSpawner.ChildProcessSpawner["Service"] =>
  ChildProcessSpawner.make((command) => {
    if (command._tag !== "StandardCommand" || command.command !== "ssh") {
      return inner.spawn(command);
    }
    const remote = command.args.at(-1) ?? "";
    const path = pathWithTimeout();
    const remoteEnv = { PATH: path, ...env };
    return inner.spawn(
      ChildProcess.make("/bin/sh", ["-c", remote], {
        ...command.options,
        forceKillAfter: FAR_SIDE_STOP_GRACE,
        ...(remoteEnv === undefined
          ? {}
          : { env: { ...command.options.env, ...remoteEnv }, extendEnv: true }),
      }),
    );
  });

/** A `ProcessRunner` whose `ssh` runs locally; the platform spawner comes from the caller. */
export const localSshProcessRunnerLayer = (env?: Readonly<Record<string, string>>) =>
  Layer.effect(
    ProcessRunner.ProcessRunner,
    Effect.gen(function* () {
      const platform = yield* ChildProcessSpawner.ChildProcessSpawner;
      return yield* ProcessRunner.make().pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          localSshSpawner(platform, env),
        ),
      );
    }),
  );
