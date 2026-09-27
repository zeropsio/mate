import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as CrewStateRef from "./CrewStateRef.ts";
import * as CrewStore from "./CrewStore.ts";
import { crewGitLayer, git, TEST_HOST, withCrewService } from "./testing/crewGitFixture.ts";

type CrewGit = Layer.Success<ReturnType<typeof crewGitLayer>>;

const withCrew = <A, E>(body: (root: string) => Effect.Effect<A, E, CrewGit>) =>
  withCrewService(body, (root) => crewGitLayer(root));

const DEFINITION: CrewStore.CrewDefinitionRow = {
  crew: "game",
  homeHost: TEST_HOST,
  spec: {},
  briefHash: null,
  briefVersion: 1,
  appliedAt: null,
  appliedBy: null,
  seq: 0,
  flushedSeq: 0,
  state: "applied",
};

const FILES: ReadonlyArray<CrewStateRef.CrewStateFile> = [
  { path: "crew.yaml", content: "name: game\nmembers:\n  - handle: backend\n" },
  { path: "brief.md", content: "# Build the game\n\nÚkol s diakritikou.\n" },
  { path: "memory/backend/notes/api-shape.md", content: "" },
  { path: "board.json", content: '{"tasks":[]}' },
];

const flush = (seq: number, files = FILES) =>
  Effect.gen(function* () {
    const stateRef = yield* CrewStateRef.CrewStateRef;
    return yield* stateRef.flush({ crew: "game", host: TEST_HOST, seq, files });
  });

describe("CrewStateRef", () => {
  it.effect("mirrors the crew state into a parentless commit and reads it back", () =>
    withCrew((root) =>
      Effect.gen(function* () {
        const stateRef = yield* CrewStateRef.CrewStateRef;
        const store = yield* CrewStore.CrewStore;
        yield* store.putDefinition(DEFINITION);
        const written = yield* flush(1);
        const back = yield* stateRef.read("game", TEST_HOST);
        const commit = git(root, ["rev-parse", "refs/t3/crew-state/game"]);
        assert.deepStrictEqual(
          {
            written,
            back: Option.getOrUndefined(back),
            parents: git(root, ["log", "-1", "--format=%p", commit]),
            flushed: Option.getOrUndefined(yield* store.getDefinition("game"))?.flushedSeq,
            status: git(root, ["status", "--porcelain"]),
          },
          {
            written: { _tag: "written", commit },
            back: {
              seq: 1,
              files: [...FILES].sort((a, b) => (a.path < b.path ? -1 : 1)),
            },
            parents: "",
            flushed: 1,
            status: "",
          },
        );
      }),
    ),
  );

  it.effect("keeps the higher seq when flushes race or arrive out of order", () =>
    withCrew((root) =>
      Effect.gen(function* () {
        const stateRef = yield* CrewStateRef.CrewStateRef;
        const store = yield* CrewStore.CrewStore;
        yield* store.putDefinition(DEFINITION);
        const board = (seq: number) => [{ path: "board.json", content: `{"seq":${seq}}` }];
        yield* flush(3, board(3));
        const stale = yield* flush(2, board(2));
        const raced = yield* Effect.forEach([5, 7, 6], (seq) => flush(seq, board(seq)), {
          concurrency: "unbounded",
        });
        const back = Option.getOrUndefined(yield* stateRef.read("game", TEST_HOST));
        assert.deepStrictEqual(
          {
            stale,
            racedWritten: raced.filter((outcome) => outcome._tag === "written").length > 0,
            back,
            refs: git(root, ["for-each-ref", "--format=%(refname)", "refs/t3/crew-state/"]),
          },
          {
            stale: { _tag: "superseded", seq: 3 },
            racedWritten: true,
            back: { seq: 7, files: board(7) },
            refs: "refs/t3/crew-state/game",
          },
        );
      }),
    ),
  );

  it.effect("refuses a path the state tree cannot carry", () =>
    withCrew(() =>
      Effect.gen(function* () {
        const refused = yield* Effect.forEach(
          ["../escape.md", "/abs.md", "seq", "a b.md"],
          (path) =>
            flush(1, [{ path, content: "x" }]).pipe(
              Effect.flip,
              Effect.map((error) => error._tag),
            ),
        );
        assert.deepStrictEqual(refused, Array(4).fill("CrewStatePathError"));
      }),
    ),
  );
});
