/**
 * The network, faked for tests that run a Zerops remote command stack.
 *
 * An `ssh` spawn becomes `/bin/sh -c <remote command>` on this machine, so a
 * temporary repository stands in for a dev service's `remotePath` while
 * everything above the spawn - argv, identity guard, quoting, stream
 * collection - is production code. `env` is what the far side's login shell
 * would carry: pass `projectId` and `serviceId` so `identityGuard` passes, or
 * a `PATH` that supplies a tool the remote has and this machine lacks.
 *
 * @module localSsh
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as ProcessRunner from "../../processRunner.ts";

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
    return inner.spawn(
      ChildProcess.make("/bin/sh", ["-c", remote], {
        ...command.options,
        ...(env === undefined ? {} : { env: { ...command.options.env, ...env }, extendEnv: true }),
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
