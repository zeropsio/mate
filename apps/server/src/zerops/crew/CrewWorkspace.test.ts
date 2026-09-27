import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as CrewStore from "./CrewStore.ts";
import * as CrewWorkspace from "./CrewWorkspace.ts";
import {
  crewGitLayer,
  exists,
  git,
  gitExit,
  memberRow,
  read,
  taskRow,
  TEST_HOST,
  withCrewService,
  write,
} from "./testing/crewGitFixture.ts";

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

  it.effect(
    "commits a turn as WIP by the crew and records the tip; a quiet turn commits nothing",
    () =>
      withLanes((root) =>
        Effect.gen(function* () {
          const workspace = yield* CrewWorkspace.CrewWorkspace;
          const store = yield* CrewStore.CrewStore;
          yield* workspace.create(BACKEND);
          write(root, ".crew/backend/src/api.ts", "export const api = 1;\n");
          const first = yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
          const second = yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 2 });
          const tip = git(root, ["rev-parse", "crew/backend"]);
          assert.deepStrictEqual(
            {
              first,
              second,
              subject: git(root, ["log", "-1", "--format=%s by %an", "crew/backend"]),
              recorded: Option.getOrUndefined(yield* store.getLane("game", "backend"))?.recordedTip,
            },
            {
              first: { _tag: "committed", tip },
              second: { _tag: "unchanged", tip },
              subject: "wip(a-1): turn 1 by Zerops Mate Crew",
              recorded: tip,
            },
          );
        }),
      ),
  );

  it.effect(
    "never commits an open merge while a conflicted file has markers; concludes it once they are gone",
    () =>
      withLanes((root) =>
        Effect.gen(function* () {
          const workspace = yield* CrewWorkspace.CrewWorkspace;
          yield* workspace.create(BACKEND);
          write(root, ".crew/backend/README.md", "lane\n");
          yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
          write(root, "README.md", "person\n");
          git(root, ["commit", "-q", "-am", "person"]);
          const laneTip = git(root, ["rev-parse", "crew/backend"]);
          gitExit(`${root}/.crew/backend`, ["merge", "-q", "main"]);
          const conflicted = yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 2 });
          const tipWhileConflicted = git(root, ["rev-parse", "crew/backend"]);
          write(root, ".crew/backend/README.md", "person and lane\n");
          const resolved = yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 3 });
          assert.deepStrictEqual(
            {
              conflicted,
              unchangedWhileConflicted: tipWhileConflicted === laneTip,
              resolved: resolved._tag,
              parents: git(root, ["log", "-1", "--format=%p", "crew/backend"]).split(" ").length,
              merging: exists(root, ".git/worktrees/backend/MERGE_HEAD"),
            },
            {
              conflicted: { _tag: "rework", paths: ["README.md"] },
              unchangedWhileConflicted: true,
              resolved: "committed",
              parents: 2,
              merging: false,
            },
          );
        }),
      ),
  );

  const GUARDS: ReadonlyArray<{
    readonly name: string;
    readonly arrange: (lane: string) => void;
    readonly reason: Exclude<CrewWorkspace.LaneParkReason, "unknown-tip">;
    readonly paths: ReadonlyArray<string>;
  }> = [
    {
      name: "a staged blob over 10 MB",
      arrange: (lane) =>
        write(lane, "assets/map.bin", "x".repeat(CrewWorkspace.DEFAULT_MAX_BLOB_BYTES + 1)),
      reason: "size",
      paths: ["assets/map.bin"],
    },
    {
      name: "an .env file",
      arrange: (lane) => write(lane, "config/.env.local", "SECRET=1\n"),
      reason: "secrets",
      paths: ["config/.env.local"],
    },
    {
      name: "an unignored node_modules",
      arrange: (lane) => write(lane, "node_modules/left-pad/index.js", "module.exports = 1;\n"),
      reason: "dependencies",
      paths: ["node_modules"],
    },
  ];

  for (const guard of GUARDS) {
    it.effect(`parks the lane on ${guard.name}, naming it and staging nothing`, () =>
      withLanes((root) =>
        Effect.gen(function* () {
          const workspace = yield* CrewWorkspace.CrewWorkspace;
          const store = yield* CrewStore.CrewStore;
          yield* workspace.create(BACKEND);
          const lane = `${root}/.crew/backend`;
          write(lane, "src/ok.ts", "export {};\n");
          guard.arrange(lane);
          const outcome = yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
          assert.deepStrictEqual(
            {
              outcome,
              staged: git(lane, ["diff", "--cached", "--name-only"]),
              state: Option.getOrUndefined(yield* store.getLane("game", "backend"))?.state,
            },
            {
              outcome: { _tag: "parked", reason: guard.reason, paths: guard.paths },
              staged: "",
              state: "parked",
            },
          );
        }),
      ),
    );
  }

  it.effect("parks a lane whose tip the engine did not write", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create(BACKEND);
        const lane = `${root}/.crew/backend`;
        write(lane, "src/sneaky.ts", "export {};\n");
        git(lane, ["add", "-A"]);
        git(lane, ["commit", "-q", "-m", "a commit nobody recorded"]);
        const outcome = yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
        assert.deepStrictEqual(outcome, {
          _tag: "parked",
          reason: "unknown-tip",
          tip: git(lane, ["rev-parse", "HEAD"]),
        });
      }),
    ),
  );

  it.effect(
    "keeps an attempt's tip under its ref and resets the lane to where the attempt began",
    () =>
      withLanes((root) =>
        Effect.gen(function* () {
          const workspace = yield* CrewWorkspace.CrewWorkspace;
          const store = yield* CrewStore.CrewStore;
          yield* store.putMember(memberRow("backend"));
          yield* store.putAssignment(taskRow("a-1", 1, "backend"));
          yield* workspace.create(BACKEND);
          const dispatch = git(root, ["rev-parse", "crew/backend"]);
          const lane = `${root}/.crew/backend`;
          const kept: Array<CrewWorkspace.KeepOutcome> = [];
          for (const attempt of [1, 2, 3, 4]) {
            write(lane, "src/attempt.ts", `export const attempt = ${attempt};\n`);
            kept.push(
              yield* workspace.keepAndReset(BACKEND, { run: null, assignment: "a-1", attempt }),
            );
          }
          const refs = git(root, ["for-each-ref", "--format=%(refname)", "refs/t3/crew/"]);
          assert.deepStrictEqual(
            {
              last: kept[3],
              keptContent: git(root, ["show", "refs/t3/crew/manual/a-1/4:src/attempt.ts"]),
              laneTip: git(root, ["rev-parse", "crew/backend"]),
              laneClean: git(lane, ["status", "--porcelain"]),
              attemptFileLeft: exists(lane, "src/attempt.ts"),
              refs: refs.split("\n"),
              recorded: Option.getOrUndefined(yield* store.getLane("game", "backend"))?.recordedTip,
            },
            {
              last: {
                _tag: "kept",
                ref: "refs/t3/crew/manual/a-1/4",
                tip: git(root, ["rev-parse", "refs/t3/crew/manual/a-1/4"]),
              },
              keptContent: "export const attempt = 4;",
              laneTip: dispatch,
              laneClean: "",
              attemptFileLeft: false,
              refs: [
                "refs/t3/crew/manual/a-1/2",
                "refs/t3/crew/manual/a-1/3",
                "refs/t3/crew/manual/a-1/4",
              ],
              recorded: dispatch,
            },
          );
        }),
      ),
  );

  it.effect("keeps nothing from a conflicted merge unless it is aborted first", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create(BACKEND);
        const lane = `${root}/.crew/backend`;
        write(lane, "README.md", "lane\n");
        yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
        const laneTip = git(root, ["rev-parse", "crew/backend"]);
        write(root, "README.md", "person\n");
        git(root, ["commit", "-q", "-am", "person"]);
        gitExit(lane, ["merge", "-q", "main"]);
        const keep = { run: "run-1", assignment: "a-1", attempt: 1 } as const;
        const refused = yield* workspace.keepAndReset(BACKEND, keep);
        const aborted = yield* workspace.keepAndReset(BACKEND, { ...keep, abortMerge: true });
        assert.deepStrictEqual(
          {
            refused,
            aborted: aborted._tag,
            kept: git(root, ["rev-parse", "refs/t3/crew/run-1/a-1/1"]),
          },
          { refused: { _tag: "rework", paths: ["README.md"] }, aborted: "kept", kept: laneTip },
        );
      }),
    ),
  );
});
