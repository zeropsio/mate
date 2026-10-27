// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  backToTreeCommand,
  backToTreeScript,
  CrewRuntime,
  layer as CrewRuntimeLayer,
  servedFrom,
  showOnDevCommand,
  showOnDevScript,
} from "./CrewRuntime.ts";
import { CrewStore } from "./CrewStore.ts";
import * as CrewWorkspace from "./CrewWorkspace.ts";
import {
  crewGitLayer,
  declareDevServers,
  remoteEnvWithSupervisor,
  stopSupervised,
  supervise,
  TEST_HOST,
  withCrewService,
} from "./testing/crewGitFixture.ts";

const HANDLES = ["backend", "frontend"];

describe("servedFrom", () => {
  it.each([
    ["the tree", "/var/www", { by: "tree" }],
    ["a directory of the tree", "/var/www/web", { by: "tree" }],
    ["a crewmate's copy", "/var/www/.crew/backend", { by: "crewmate", handle: "backend" }],
    [
      "a directory of a copy",
      "/var/www/.crew/frontend/web",
      { by: "crewmate", handle: "frontend" },
    ],
    ["a copy nobody on the crew owns", "/var/www/.crew/ghost", { by: "unknown" }],
    ["the lanes' parent", "/var/www/.crew", { by: "unknown" }],
    ["a deleted copy", "/var/www/.crew/backend (deleted)", { by: "unknown" }],
    ["a sibling that shares the prefix", "/var/www2", { by: "unknown" }],
    ["somewhere else", "/srv/app", { by: "unknown" }],
    ["no running dev server", undefined, { by: "unknown" }],
  ] as const)("%s", (_name, cwd, served) => {
    expect(servedFrom(cwd, "/var/www", HANDLES)).toEqual(served);
  });
});

const WEB = { name: "web", port: 3000, command: "sleep 30" } as const;

/** The service declares `web` and the supervisor runs it from the tree. */
const treeServes = (root: string) => {
  declareDevServers(root, [WEB]);
  supervise(root, "start", "web");
};

/** A claim or release turn's one command, run on the service as the turn would. */
const runOnService = (root: string, body: string) =>
  NodeChildProcess.execFileSync("/bin/sh", ["-c", body], {
    cwd: root,
    env: { ...process.env, ...remoteEnvWithSupervisor() },
    stdio: "ignore",
  });

const withRuntime = <A, E>(
  body: (context: {
    readonly root: string;
  }) => Effect.Effect<A, E, CrewRuntime | CrewStore | CrewWorkspace.CrewWorkspace>,
) =>
  withCrewService(
    (root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create({ crew: "game", host: TEST_HOST, handle: "backend" });
        return yield* body({ root });
      }).pipe(Effect.ensuring(Effect.sync(() => stopSupervised(root)))),
    (root) =>
      CrewRuntimeLayer.pipe(
        Layer.provideMerge(crewGitLayer(root, { remoteEnv: remoteEnvWithSupervisor() })),
      ),
  );

describe("the claim turns' commands", () => {
  it("stop the declared server and run the copy in its place on its port, then give it back", () => {
    expect([
      showOnDevCommand("appdev", "backend", { ...WEB, command: "npm run dev", cwd: "." }),
      backToTreeCommand("appdev", "backend", { ...WEB, command: "npm run dev", cwd: "." }),
      showOnDevScript("backend", { ...WEB, command: "npm run dev", cwd: "apps/web" }),
    ]).toEqual([
      String.raw`ssh appdev 'zcp-devsup ctl --json stop web && zcp-devsup ctl --json run --name show-backend --cwd .crew/backend --port 3000 -- '\''npm run dev'\'''`,
      "ssh appdev 'zcp-devsup ctl --json rm show-backend; zcp-devsup ctl --json start web'",
      "zcp-devsup ctl --json stop web && zcp-devsup ctl --json run --name show-backend --cwd .crew/backend/apps/web --port 3000 -- 'npm run dev'",
    ]);
  });
});

describe("CrewRuntime", () => {
  it.effect("reads what dev serves from its process's working directory", () =>
    withRuntime(({ root }) =>
      Effect.gen(function* () {
        const runtime = yield* CrewRuntime;
        const nothing = (yield* runtime.devServer(TEST_HOST)).served;
        treeServes(root);
        const fromTree = yield* runtime.devServer(TEST_HOST);
        const devServer = fromTree.devServer!;
        runOnService(root, showOnDevScript("backend", devServer));
        const fromLane = (yield* runtime.devServer(TEST_HOST)).served;
        runOnService(root, backToTreeScript("backend", devServer));
        const back = (yield* runtime.devServer(TEST_HOST)).served;
        expect([nothing, fromTree, fromLane, back]).toEqual([
          { by: "unknown" },
          { served: { by: "tree" }, devServer: { ...WEB, cwd: "." } },
          { by: "crewmate", handle: "backend" },
          { by: "tree" },
        ]);
      }),
    ),
  );

  it.effect("finds no dev server when zcp started none", () =>
    withRuntime(() =>
      Effect.gen(function* () {
        const runtime = yield* CrewRuntime;
        expect(yield* runtime.devServer(TEST_HOST)).toEqual({
          served: { by: "unknown" },
          devServer: null,
        });
      }),
    ),
  );
});
