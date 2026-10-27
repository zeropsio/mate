import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makeChildHomeSpawner } from "./childHome.ts";

const PROCESS_HOME = "/home/developer";
const MATE_HOME = "/tmp/scenario-mate/home";

/** The environment the child is started with, as the platform spawner receives it. */
const spawnedWith = (homeDir: string, options: ChildProcess.CommandOptions) =>
  Effect.gen(function* () {
    let seen: ChildProcess.CommandOptions | undefined;
    const spawner = makeChildHomeSpawner({
      homeDir,
      inheritedHome: PROCESS_HOME,
      inner: ChildProcessSpawner.make((command) => {
        if (ChildProcess.isStandardCommand(command)) seen = command.options;
        return Effect.die("spawned");
      }),
    });
    yield* Effect.exit(Effect.scoped(spawner.spawn(ChildProcess.make("git", ["status"], options))));
    return { env: seen?.env, extendEnv: seen?.extendEnv };
  });

describe("childHome", () => {
  it.effect("a child the server starts resolves its home in the Mate's home", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly options: ChildProcess.CommandOptions;
        readonly env: Record<string, string | undefined> | undefined;
        readonly extendEnv: boolean | undefined;
      }> = [
        { options: {}, env: { HOME: MATE_HOME }, extendEnv: true },
        {
          options: { env: { HOME: PROCESS_HOME, PATH: "/bin", GIT_OPTIONAL_LOCKS: "0" } },
          env: { HOME: MATE_HOME, PATH: "/bin", GIT_OPTIONAL_LOCKS: "0" },
          extendEnv: undefined,
        },
        {
          options: { env: { GIT_INDEX_FILE: "/tmp/index" }, extendEnv: true },
          env: { GIT_INDEX_FILE: "/tmp/index", HOME: MATE_HOME },
          extendEnv: true,
        },
        // A home of its own, and a full environment without one, stay as the caller made them.
        {
          options: { env: { HOME: "/tmp/login-home" }, extendEnv: true },
          env: { HOME: "/tmp/login-home" },
          extendEnv: true,
        },
        { options: { env: { PATH: "/bin" } }, env: { PATH: "/bin" }, extendEnv: undefined },
      ];
      for (const { options, env, extendEnv } of cases) {
        expect(yield* spawnedWith(MATE_HOME, options)).toEqual({ env, extendEnv });
      }
    }),
  );

  it.effect("a Mate at home in the server's own home spawns as the platform does", () =>
    Effect.gen(function* () {
      expect(yield* spawnedWith(PROCESS_HOME, {})).toEqual({
        env: undefined,
        extendEnv: undefined,
      });
    }),
  );
});
