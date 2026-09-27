import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as CrewApp from "./CrewApp.ts";
import * as CrewWorkspace from "./CrewWorkspace.ts";
import {
  alive,
  crewGitLayer,
  exists,
  read,
  remoteEnvWithSetsid,
  TEST_HOST,
  waitUntil,
  withCrewService,
} from "./testing/crewGitFixture.ts";

const LANE = { host: TEST_HOST, handle: "backend" } as const;

/** Writes the port it was given, starts a child, and waits - like a dev server. */
const DEV_SERVER =
  'printf "%s" "$CREW_PORT" > port.txt; sleep 30 & printf "%s" "$!" > child.pid; echo listening; wait';

describe("CrewApp", () => {
  it.effect("runs a crewmate's app in its lane, finds it running, and stops its whole group", () =>
    withCrewService(
      (root) =>
        Effect.gen(function* () {
          const workspace = yield* CrewWorkspace.CrewWorkspace;
          const app = yield* CrewApp.CrewApp;
          yield* workspace.create({ crew: "game", ...LANE });
          const before = yield* app.status(LANE);
          const started = yield* app.run({ ...LANE, command: DEV_SERVER, port: 3001 });
          const lane = `${root}/.crew/backend`;
          waitUntil(() => exists(lane, "child.pid") && read(root, ".crew/backend.run.log") !== "");
          const again = yield* app.run({ ...LANE, command: DEV_SERVER, port: 3001 });
          const running = yield* app.status(LANE);
          const pid = started.state === "running" ? started.pid : -1;
          const child = Number(read(lane, "child.pid"));
          const stopped = yield* app.stop(LANE);
          waitUntil(() => !alive(pid) && !alive(child));
          assert.deepStrictEqual(
            {
              before,
              again,
              running,
              port: read(lane, "port.txt"),
              log: read(root, ".crew/backend.run.log"),
              stopped,
              after: yield* app.status(LANE),
              gone: [alive(pid), alive(child)],
            },
            {
              before: { state: "stopped" },
              again: { state: "running", pid },
              running: { state: "running", pid },
              port: "3001",
              log: "listening\n",
              stopped: { state: "stopped" },
              after: { state: "stopped" },
              gone: [false, false],
            },
          );
        }),
      (root) => crewGitLayer(root, { remoteEnv: remoteEnvWithSetsid() }),
    ),
  );
});
