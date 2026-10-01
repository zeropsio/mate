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
 * `timeout`, which every remote has and macOS lacks, is supplied when missing.
 *
 * @module localSsh
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as ProcessRunner from "../../processRunner.ts";

/**
 * `timeout [-k grace] seconds command…` as GNU coreutils runs it (exit 124 when
 * it stops the command), for a machine without one.
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

let shimmedPath: string | null | undefined;

/** A `PATH` with a `timeout` on it, or `null` when this machine has one. */
const pathWithTimeout = (): string | null => {
  if (shimmedPath !== undefined) return shimmedPath;
  const has = NodeChildProcess.spawnSync("/bin/sh", ["-c", "command -v timeout"]).status === 0;
  if (has) return (shimmedPath = null);
  const bin = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-local-ssh-bin-"));
  NodeFS.writeFileSync(NodePath.join(bin, "timeout"), TIMEOUT_SHIM, { mode: 0o755 });
  process.once("exit", () => NodeFS.rmSync(bin, { recursive: true, force: true }));
  return (shimmedPath = `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`);
};

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
    const remoteEnv = path === null ? env : { PATH: path, ...env };
    return inner.spawn(
      ChildProcess.make("/bin/sh", ["-c", remote], {
        ...command.options,
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
