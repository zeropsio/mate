import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as CrewStore from "./CrewStore.ts";

import * as CrewWorkspace from "./CrewWorkspace.ts";
import { crewGitLayer, git, read, TEST_HOST, withCrewService } from "./testing/crewGitFixture.ts";

const BACKEND: CrewWorkspace.LaneSpec = { crew: "game", handle: "backend", host: TEST_HOST };

type CrewGit = Layer.Success<ReturnType<typeof crewGitLayer>>;

const withLanes = <A, E>(body: (root: string) => Effect.Effect<A, E, CrewGit>) =>
  withCrewService(body, (root) => crewGitLayer(root));

describe("CrewWorkspace", () => {
  it.effect("creates a lane that leaves the person's git status clean", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        const created = yield* workspace.create(BACKEND);
        const head = git(root, ["rev-parse", "HEAD"]);
        assert.deepStrictEqual(
          {
            created,
            status: git(root, ["status", "--porcelain"]),
            branch: git(root, ["rev-parse", "crew/backend"]),
            staged: (git(root, ["add", "-A"]), git(root, ["diff", "--cached", "--name-only"])),
          },
          { created: { _tag: "created", head }, status: "", branch: head, staged: "" },
        );
      }),
    ),
  );

  it.effect(
    "needs the exclude line: without it the person's add -A stages the lane as a gitlink",
    () =>
      withLanes((root) =>
        Effect.sync(() => {
          git(root, ["worktree", "add", "-q", ".crew/backend", "-b", "crew/backend"]);
          git(root, ["add", "-A"]);
          assert.match(
            git(root, ["diff", "--cached", "--raw"]),
            /^:000000 160000 .* A\t\.crew\/backend$/,
          );
        }),
      ),
  );

  it.effect("runs setup in the new lane, records it, and leaves an existing lane alone", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        const store = yield* CrewStore.CrewStore;
        const created = yield* workspace.create({
          ...BACKEND,
          setup: 'printf "%s" "$CREW_PORT" > setup-ran',
          crewPort: 3001,
        });
        const again = yield* workspace.create(BACKEND);
        const head = git(root, ["rev-parse", "HEAD"]);
        assert.deepStrictEqual(
          {
            setup: created._tag === "created" ? created.setup?._tag : undefined,
            ran: read(root, ".crew/backend/setup-ran"),
            again,
            row: Option.getOrUndefined(yield* store.getLane("game", "backend")),
          },
          {
            setup: "passed",
            ran: "3001",
            again: { _tag: "exists", tip: head },
            row: {
              crew: "game",
              lane: "backend",
              host: TEST_HOST,
              branch: "crew/backend",
              dispatchCommit: head,
              recordedTip: head,
              lastLanding: null,
              refSnapshot: null,
              lockfileHash: null,
              frozenSince: null,
              state: "ready",
            },
          },
        );
      }),
    ),
  );
});
