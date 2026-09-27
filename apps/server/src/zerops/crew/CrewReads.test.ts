import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CrewReads from "./CrewReads.ts";
import * as CrewWorkspace from "./CrewWorkspace.ts";
import {
  crewGitLayer,
  git,
  TEST_HOST,
  TEST_IDENTITY,
  withCrewService,
  write,
} from "./testing/crewGitFixture.ts";

const readsLayer = (root: string, remoteEnv?: Readonly<Record<string, string>>) =>
  CrewReads.layer.pipe(
    Layer.provideMerge(crewGitLayer(root, remoteEnv === undefined ? {} : { remoteEnv })),
  );

describe("CrewReads", () => {
  it.effect("reads zerops.yaml, or nothing when the tree has none", () =>
    withCrewService(
      (root) =>
        Effect.gen(function* () {
          const reads = yield* CrewReads.CrewReads;
          const before = yield* reads.zeropsYaml(TEST_HOST);
          write(root, "zerops.yml", "zerops: []\n");
          assert.deepStrictEqual(
            [before, yield* reads.zeropsYaml(TEST_HOST)],
            [undefined, "zerops: []\n"],
          );
        }),
      (root) => readsLayer(root),
    ),
  );

  it.effect.each([
    ["a database URL", { DATABASE_URL: "postgresql://db:5432/app" }, true],
    ["a connection string by value", { API_DB: "mysql://db/app" }, true],
    ["no database", { PORT: "3000" }, false],
  ] as const)("says whether the service's environment reaches %s", ([, env, expected]) =>
    withCrewService(
      () =>
        Effect.gen(function* () {
          const reads = yield* CrewReads.CrewReads;
          assert.strictEqual(yield* reads.reachesDatabase(TEST_HOST), expected);
        }),
      (root) => readsLayer(root, { ...TEST_IDENTITY, ...env }),
    ),
  );

  it.effect(
    "reads a lane against your tree and its uncommitted work, its log, your dirty paths and what a remote holds",
    () =>
      withCrewService(
        (root) =>
          Effect.gen(function* () {
            const reads = yield* CrewReads.CrewReads;
            const workspace = yield* CrewWorkspace.CrewWorkspace;
            yield* workspace.create({ crew: "main", handle: "backend", host: TEST_HOST });
            const start = git(root, ["rev-parse", "HEAD"]);
            const lane = `${root}/.crew/backend`;
            write(lane, "a.ts", "one\ntwo\n");
            git(lane, ["add", "-A"]);
            git(lane, ["commit", "-q", "-m", "wip(t-1): turn 1"]);
            const clean = yield* reads.laneStats(TEST_HOST, "backend");
            write(lane, "draft.ts", "draft\n");
            write(root, "README.md", "edited\n");
            write(root, "new.txt", "new\n");
            git(root, ["update-ref", "refs/remotes/origin/main", start]);
            const log = yield* reads.laneLog(TEST_HOST, "backend", start);
            assert.deepStrictEqual(
              {
                clean: clean.dirty,
                stats: yield* reads.laneStats(TEST_HOST, "backend"),
                integration: yield* reads.integration(TEST_HOST),
                log: log.map((line) => line.replace(/^[0-9a-f]+ /u, "")),
                dirty: yield* reads.dirtyPaths(TEST_HOST),
                delivered: [
                  ...(yield* reads.delivered(TEST_HOST, [start, git(lane, ["rev-parse", "HEAD"])])),
                ],
                diff: (yield* reads.diff(TEST_HOST, "backend", "a.ts")).includes("+one"),
              },
              {
                clean: false,
                stats: {
                  ahead: 1,
                  insertions: 2,
                  deletions: 0,
                  dirty: true,
                  integration: { branch: "main", head: start },
                },
                integration: { branch: "main", head: start },
                log: ["wip(t-1): turn 1"],
                dirty: ["README.md", "new.txt"],
                delivered: [start],
                diff: true,
              },
            );
          }),
        (root) => readsLayer(root),
      ),
  );

  it.effect("finds no dev server when zcp started none", () =>
    withCrewService(
      () =>
        Effect.gen(function* () {
          const reads = yield* CrewReads.CrewReads;
          assert.isUndefined(yield* reads.devServerCommand(TEST_HOST));
        }),
      (root) => readsLayer(root),
    ),
  );
});
