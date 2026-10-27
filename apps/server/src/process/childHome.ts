/**
 * The home every child the server starts resolves its dotfiles in: `ServerConfig.homeDir`.
 * A child that would inherit this process's `HOME` (git, zcp, provider CLIs) gets the Mate's
 * home instead; a child handed a home of its own keeps it. A Mate whose home is this process's
 * own — every container Mate — spawns through the platform spawner untouched.
 *
 * @module childHome
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { ServerConfig } from "../config.ts";

export const makeChildHomeSpawner = (input: {
  readonly homeDir: string;
  /** The home a child inherits from this process. */
  readonly inheritedHome: string | undefined;
  readonly inner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}): ChildProcessSpawner.ChildProcessSpawner["Service"] => {
  const { homeDir, inheritedHome, inner } = input;
  if (homeDir === inheritedHome) return inner;
  const homed = (command: ChildProcess.Command): ChildProcess.Command => {
    if (!ChildProcess.isStandardCommand(command)) return command;
    const { env, extendEnv } = command.options;
    // A full environment without a home starts the child without one, as it asked.
    if (env !== undefined && extendEnv !== true && env.HOME === undefined) return command;
    if (env?.HOME !== undefined && env.HOME !== inheritedHome) return command;
    return ChildProcess.make(command.command, command.args, {
      ...command.options,
      env: { ...env, HOME: homeDir },
      extendEnv: env === undefined ? true : extendEnv,
    });
  };
  return ChildProcessSpawner.make((command) => inner.spawn(homed(command)));
};

export const layer = Layer.effect(
  ChildProcessSpawner.ChildProcessSpawner,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const inner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return makeChildHomeSpawner({
      homeDir: config.homeDir,
      inheritedHome: process.env.HOME,
      inner,
    });
  }),
);
