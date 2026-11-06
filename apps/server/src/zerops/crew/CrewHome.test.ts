// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../../config.ts";
import { testTempDir } from "../../testing/testTempDir.ts";
import * as CrewHome from "./CrewHome.ts";

const CREW_YAML = [
  "name: Game team",
  "briefTitle: Space shooter",
  "members:",
  "  - handle: backend",
  "    displayName: Backend",
  "    host: appdev",
  "",
].join("\n");

const workspace = testTempDir("t3-crew-home-");

afterEach(() => {
  for (const file of ["crew.yaml", "brief.md", "jobs/backend.md", "notes.txt"]) {
    NodeFS.rmSync(NodePath.join(workspace, ".mate", "crew", CrewHome.CREW_ID, file), {
      force: true,
    });
  }
});

const withHome = <A, E>(body: (workspace: string) => Effect.Effect<A, E, CrewHome.CrewHome>) =>
  body(workspace).pipe(
    Effect.provide(
      CrewHome.layer.pipe(
        Layer.provide(
          ServerConfig.layer({ cwd: workspace } as ServerConfig.ServerConfig["Service"]),
        ),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

describe("CrewHome", () => {
  it.effect("lives in the workspace under .mate/crew/main", () =>
    withHome((workspace) =>
      Effect.gen(function* () {
        const home = yield* CrewHome.CrewHome;
        assert.strictEqual(home.directory, `${workspace}/.mate/crew/${CrewHome.CREW_ID}`);
        assert.deepStrictEqual(yield* home.read, []);
      }),
    ),
  );

  it.effect("writes the files it is given and reads back every crew file present", () =>
    withHome((workspace) =>
      Effect.gen(function* () {
        const home = yield* CrewHome.CrewHome;
        yield* home.write([
          { path: "crew.yaml", content: CREW_YAML },
          { path: "brief.md", content: "Build it.\n" },
          { path: "jobs/backend.md", content: "The server.\n" },
        ]);
        NodeFS.writeFileSync(NodePath.join(home.directory, "notes.txt"), "not a crew file");
        yield* home.write([{ path: "brief.md", content: "Build it well.\n" }]);
        assert.deepStrictEqual(yield* home.read, [
          { path: "brief.md", content: "Build it well.\n" },
          { path: "crew.yaml", content: CREW_YAML },
          { path: "jobs/backend.md", content: "The server.\n" },
        ]);
        assert.isTrue(NodeFS.existsSync(`${workspace}/.mate/crew/main/jobs/backend.md`));
      }),
    ),
  );

  it.effect.each([
    [
      "a second crewmate on a taken handle",
      `${CREW_YAML}  - handle: backend\n    displayName: Other\n    host: appdev\n`,
      "handle-taken",
    ],
    ["a crewmate with no job", CREW_YAML, "invalid-definition"],
  ] as const)("refuses %s and writes nothing", ([, yaml, reason]) =>
    withHome(() =>
      Effect.gen(function* () {
        const home = yield* CrewHome.CrewHome;
        const files =
          reason === "invalid-definition"
            ? [
                { path: "crew.yaml", content: yaml },
                { path: "brief.md", content: "Build it.\n" },
              ]
            : [
                { path: "crew.yaml", content: yaml },
                { path: "brief.md", content: "Build it.\n" },
                { path: "jobs/backend.md", content: "The server.\n" },
              ];
        const error = yield* Effect.flip(home.write(files));
        assert.strictEqual(error.reason, reason);
        assert.isNotNull(error.detail);
        assert.deepStrictEqual(yield* home.read, []);
      }),
    ),
  );
});
