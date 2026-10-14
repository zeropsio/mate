import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as CrewApp from "./CrewApp.ts";
import * as CrewWorkspace from "./CrewWorkspace.ts";
import {
  alive,
  crewGitLayer,
  exists,
  read,
  remoteEnvWithSupervisor,
  supervisedApps,
  supervisorCalls,
  supervisorDown,
  TEST_HOST,
  TEST_IDENTITY,
  waitUntil,
  withCrewService,
} from "./testing/crewGitFixture.ts";

const LANE = { host: TEST_HOST, handle: "backend" } as const;

/** Writes the port it was given, starts a child, and waits - like a dev server. */
const DEV_SERVER =
  'printf "%s" "$CREW_PORT" > port.txt; sleep 30 & printf "%s" "$!" > child.pid; echo listening; wait';

const supervised = (root: string) => crewGitLayer(root, { remoteEnv: remoteEnvWithSupervisor() });

describe("CrewApp", () => {
  it.effect("runs a crewmate's app in its lane, finds it running, and stops its whole group", () =>
    withCrewService(
      (root) =>
        Effect.gen(function* () {
          const workspace = yield* CrewWorkspace.CrewWorkspace;
          const app = yield* CrewApp.CrewApp;
          yield* workspace.create({ crew: "game", ...LANE });
          const started = yield* app.run({
            ...LANE,
            command: DEV_SERVER,
            port: 3001,
            env: { MODE: "it's dev" },
          });
          const lane = `${root}/.crew/backend`;
          waitUntil(() => exists(lane, "child.pid"));
          const again = yield* app.run({
            ...LANE,
            command: DEV_SERVER,
            port: 3001,
            env: { MODE: "it's dev" },
          });
          const pid = started.state === "running" ? started.pid : -1;
          const child = Number(read(lane, "child.pid"));
          const entry = supervisedApps(root)["crew-backend"];
          const stopped = yield* app.stop(LANE);
          waitUntil(() => !alive(pid) && !alive(child));
          assert.deepStrictEqual(
            {
              again,
              entry: { cwd: entry?.cwd, port: entry?.port },
              port: read(lane, "port.txt"),
              stopped,
              entries: Object.keys(supervisedApps(root)),
              gone: [alive(pid), alive(child)],
              stoppedAgain: yield* app.stop(LANE),
            },
            {
              again: { state: "running", pid },
              entry: { cwd: ".crew/backend", port: 3001 },
              port: "3001",
              stopped: { state: "stopped" },
              entries: [],
              gone: [false, false],
              stoppedAgain: { state: "stopped" },
            },
          );
        }),
      supervised,
    ),
  );

  it.effect("the supervisor runs the app with its crew port and env, by its crew name", () =>
    withCrewService(
      (root) =>
        Effect.gen(function* () {
          const workspace = yield* CrewWorkspace.CrewWorkspace;
          const app = yield* CrewApp.CrewApp;
          yield* workspace.create({ crew: "game", ...LANE });
          yield* app.run({
            ...LANE,
            command: 'printf "%s %s" "$CREW_PORT" "$MODE" > env.txt; exec sleep 30',
            port: 3002,
            env: { MODE: "it's dev" },
          });
          waitUntil(() => exists(`${root}/.crew/backend`, "env.txt"));
          const [call] = supervisorCalls(root);
          yield* app.stop(LANE);
          assert.deepStrictEqual(
            {
              verb: call?.slice(0, 9),
              env: read(`${root}/.crew/backend`, "env.txt"),
              calls: supervisorCalls(root).map((args) => args.slice(0, 3)),
            },
            {
              verb: [
                "ctl",
                "--json",
                "run",
                "--name",
                "crew-backend",
                "--cwd",
                ".crew/backend",
                "--port",
                "3002",
              ],
              env: "3002 it's dev",
              calls: [
                ["ctl", "--json", "run"],
                ["ctl", "--json", "rm"],
              ],
            },
          );
        }),
      supervised,
    ),
  );

  it.effect("a dev service without the supervisor runs no crew app, and has none to stop", () =>
    Effect.gen(function* () {
      const absent = yield* withCrewService(
        (root) =>
          Effect.gen(function* () {
            const workspace = yield* CrewWorkspace.CrewWorkspace;
            const app = yield* CrewApp.CrewApp;
            yield* workspace.create({ crew: "game", ...LANE });
            return [
              yield* app.run({ ...LANE, command: DEV_SERVER, port: 3001 }),
              yield* app.stop(LANE),
              exists(root, ".crew/backend/port.txt"),
            ];
          }),
        (root) => crewGitLayer(root, { remoteEnv: TEST_IDENTITY }),
      );
      const down = yield* withCrewService(
        (root) =>
          Effect.gen(function* () {
            const workspace = yield* CrewWorkspace.CrewWorkspace;
            const app = yield* CrewApp.CrewApp;
            yield* workspace.create({ crew: "game", ...LANE });
            supervisorDown(root);
            return [
              yield* app.run({ ...LANE, command: DEV_SERVER, port: 3001 }),
              yield* app.stop(LANE),
              exists(root, ".crew/backend/port.txt"),
            ];
          }),
        supervised,
      );
      assert.deepStrictEqual(
        { absent, down },
        {
          absent: [{ state: "no-supervisor" }, { state: "stopped" }, false],
          down: [{ state: "no-supervisor" }, { state: "stopped" }, false],
        },
      );
    }),
  );
});
