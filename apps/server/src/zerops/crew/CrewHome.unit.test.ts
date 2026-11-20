import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
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
const withHome = <A, E>(workspace: string, body: Effect.Effect<A, E, CrewHome.CrewHome>) =>
  body.pipe(
    Effect.provide(
      CrewHome.layer.pipe(
        Layer.provide(
          ServerConfig.layer({ cwd: workspace } as ServerConfig.ServerConfig["Service"]),
        ),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

// witness: apps/server/src/zerops/crew/CrewHome.ts | ? "handle-taken" → ? "invalid-definition"
it.effect(
  "CM57: A write that would leave the crew home unparsable, such as a crewmate on a taken handle or one with no job, is refused with its reason and writes nothing",
  () =>
    withHome(
      testTempDir("t3-crew-home-"),
      Effect.gen(function* () {
        const home = yield* CrewHome.CrewHome;
        for (const [yaml, reason] of [
          [
            `${CREW_YAML}  - handle: backend\n    displayName: Other\n    host: appdev\n`,
            "handle-taken",
          ],
          [CREW_YAML, "invalid-definition"],
        ] as const) {
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
          expect(error.reason).toBe(reason);
          expect(yield* home.read).toEqual([]);
        }
      }),
    ),
);

// witness: apps/server/src/zerops/crew/CrewHome.ts | ...(yield* read).filter((file) => !incoming.has(file.path)) → ...(yield* read).filter((file) => incoming.has(file.path))
it.effect("CM58: A write of some crew files keeps the crew's other files", () =>
  withHome(
    testTempDir("t3-crew-home-"),
    Effect.gen(function* () {
      const home = yield* CrewHome.CrewHome;
      yield* home.write([
        { path: "crew.yaml", content: CREW_YAML },
        { path: "brief.md", content: "Build it.\n" },
        { path: "jobs/backend.md", content: "The server.\n" },
      ]);
      const update = yield* Effect.result(
        home.write([{ path: "brief.md", content: "Build it well.\n" }]),
      );
      expect(update._tag).toBe("Success");
      expect(yield* home.read).toEqual([
        { path: "brief.md", content: "Build it well.\n" },
        { path: "crew.yaml", content: CREW_YAML },
        { path: "jobs/backend.md", content: "The server.\n" },
      ]);
    }),
  ),
);
