// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

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

  it.effect("a lane's git works through any path to the tree: its gitdir is relative", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create(BACKEND);
        // The zcp container sees the tree at another path (its sshfs mount).
        const mounted = `${root}-mounted`;
        NodeFS.renameSync(root, mounted);
        const throughMount = gitExit(`${mounted}/.crew/backend`, ["status", "--porcelain"]);
        NodeFS.renameSync(mounted, root);
        assert.deepStrictEqual(
          [read(root, ".crew/backend/.git"), throughMount],
          ["gitdir: ../../.git/worktrees/backend\n", 0],
        );
      }),
    ),
  );

  it.effect("the boot sweep makes an absolute lane gitdir relative", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create(BACKEND);
        write(root, ".crew/backend/.git", `gitdir: ${root}/.git/worktrees/backend\n`);
        yield* workspace.sweep(TEST_HOST);
        assert.strictEqual(
          read(root, ".crew/backend/.git"),
          "gitdir: ../../.git/worktrees/backend\n",
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
              first: { _tag: "committed", tip, saved: ["src/api.ts"] },
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
              conflicted: {
                _tag: "rework",
                paths: ["README.md"],
                reason: "Resolve the conflict markers left in README.md",
              },
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
      name: "an .env under a directory with a non-ASCII name",
      arrange: (lane) => write(lane, "Úkoly/.env", "SECRET=1\n"),
      reason: "secrets",
      paths: ["Úkoly/.env"],
    },
    {
      name: "an unignored node_modules",
      arrange: (lane) => write(lane, "node_modules/left-pad/index.js", "module.exports = 1;\n"),
      reason: "dependencies",
      paths: ["node_modules"],
    },
  ];

  it.effect.each(
    Array.from(GUARDS, (guard) => ({
      title: `parks the lane on ${guard.name}, naming it and staging nothing`,
      guard,
    })),
  )("$title", ({ guard }) =>
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
          {
            refused: {
              _tag: "rework",
              paths: ["README.md"],
              reason: "Resolve the conflict markers left in README.md",
            },
            aborted: "kept",
            kept: laneTip,
          },
        );
      }),
    ),
  );

  it.effect("resets a lane whose tip is its last landing to the current head at dispatch", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        const store = yield* CrewStore.CrewStore;
        yield* workspace.create(BACKEND);
        const landed = git(root, ["rev-parse", "crew/backend"]);
        yield* store.updateLane("game", "backend", (row) => ({ ...row, lastLanding: landed }));
        write(root, "docs/person.md", "the person's own commit\n");
        git(root, ["add", "-A"]);
        git(root, ["commit", "-q", "-m", "person"]);
        const head = git(root, ["rev-parse", "HEAD"]);
        const first = yield* workspace.prepareDispatch(BACKEND);
        const second = yield* workspace.prepareDispatch(BACKEND);
        assert.deepStrictEqual(
          { first, second, lane: git(root, ["rev-parse", "crew/backend"]) },
          {
            first: { _tag: "ready", dispatchCommit: head, reset: true },
            second: { _tag: "ready", dispatchCommit: head, reset: false },
            lane: head,
          },
        );
      }),
    ),
  );

  it.effect("writes nothing into a frozen host's lanes until it is unfrozen", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create(BACKEND);
        write(root, ".crew/backend/src/api.ts", "export {};\n");
        const frozen = yield* workspace.freeze(TEST_HOST);
        const whileFrozen = [
          (yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 }))._tag,
          (yield* workspace.prepareDispatch(BACKEND))._tag,
        ];
        const untouched =
          git(root, ["rev-parse", "crew/backend"]) === git(root, ["rev-parse", "HEAD"]);
        yield* workspace.unfreeze(TEST_HOST);
        const after = yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
        assert.deepStrictEqual(
          { frozen, whileFrozen, untouched, after: after._tag },
          {
            frozen: [{ crew: "game", handle: "backend" }],
            whileFrozen: ["frozen", "frozen"],
            untouched: true,
            after: "committed",
          },
        );
      }),
    ),
  );

  /** A landing as the person's history carries it: a commit with both trailers. */
  const recordLanding = (root: string, assignment: string, number: number) =>
    Effect.gen(function* () {
      const store = yield* CrewStore.CrewStore;
      write(root, `src/task-${number}.ts`, `export const task = ${number};\n`);
      git(root, ["add", "-A"]);
      git(root, [
        "commit",
        "-q",
        "-m",
        `Task ${number}`,
        "-m",
        `Crew-Lane: backend\nCrew-Assignment: ${assignment}`,
      ]);
      yield* store.putAssignment(
        taskRow(assignment, number, "backend", git(root, ["rev-parse", "HEAD"])),
      );
    });

  it.effect("brings lanes back after a self-deploy dropped their directories", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        const store = yield* CrewStore.CrewStore;
        yield* store.putMember(memberRow("backend"));
        yield* workspace.create(BACKEND);
        yield* recordLanding(root, "a-1", 1);
        write(root, ".crew/backend/src/wip.ts", "export {};\n");
        yield* workspace.commitTurn(BACKEND, { assignment: "a-2", turn: 1 });
        const tip = git(root, ["rev-parse", "crew/backend"]);
        yield* workspace.freeze(TEST_HOST);
        NodeFS.rmSync(`${root}/.crew`, { recursive: true, force: true });
        const recovered = yield* workspace.recover(TEST_HOST, [
          { ...BACKEND, setup: "touch setup-ran" },
        ]);
        assert.deepStrictEqual(
          {
            recovered: recovered._tag === "recovered" ? recovered.readded : recovered,
            setup: exists(root, ".crew/backend/setup-ran"),
            wip: read(root, ".crew/backend/src/wip.ts"),
            tip: git(root, ["rev-parse", "crew/backend"]),
            frozen: Option.getOrUndefined(yield* store.getLane("game", "backend"))?.frozenSince,
          },
          { recovered: ["backend"], setup: true, wip: "export {};\n", tip, frozen: null },
        );
      }),
    ),
  );

  it.effect("names what a container replacement lost: a landing and the lane's WIP", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        const store = yield* CrewStore.CrewStore;
        yield* store.putMember(memberRow("backend"));
        yield* workspace.create(BACKEND);
        const deployed = git(root, ["rev-parse", "HEAD"]);
        yield* recordLanding(root, "a-1", 1);
        write(root, ".crew/backend/src/wip.ts", "export {};\n");
        yield* workspace.commitTurn(BACKEND, { assignment: "a-2", turn: 1 });
        yield* workspace.freeze(TEST_HOST);
        // The disk returns to the last deploy: HEAD and the branch move back, the lane is gone.
        git(root, ["reset", "-q", "--hard", deployed]);
        NodeFS.rmSync(`${root}/.crew`, { recursive: true, force: true });
        git(root, ["worktree", "prune"]);
        git(root, ["branch", "-f", "crew/backend", deployed]);
        const recovered = yield* workspace.recover(TEST_HOST, [BACKEND]);
        assert.deepStrictEqual(recovered, {
          _tag: "lost",
          landings: [{ assignment: "a-1", title: "Task 1" }],
          branches: [],
          wip: [
            {
              handle: "backend",
              since: git(root, ["log", "-1", "--format=%cI", deployed]),
            },
          ],
        });
      }),
    ),
  );

  it.effect(
    "the boot sweep never commits a checked lane: tracked edits hold it, untracked files don't",
    () =>
      withLanes((root) =>
        Effect.gen(function* () {
          const workspace = yield* CrewWorkspace.CrewWorkspace;
          yield* workspace.create(BACKEND);
          const tip = git(root, ["rev-parse", "crew/backend"]);
          write(root, ".crew/backend/build.log", "untracked\n");
          const untracked = yield* workspace.sweep(TEST_HOST, new Set(["backend"]));
          write(root, ".crew/backend/README.md", "edited after the check\n");
          const edited = yield* workspace.sweep(TEST_HOST, new Set(["backend"]));
          assert.deepStrictEqual(
            [
              untracked.lanes.map((lane) => [lane.handle, lane._tag]),
              edited.lanes.map((lane) => [lane.handle, lane._tag]),
              git(root, ["rev-parse", "crew/backend"]),
              git(`${root}/.crew/backend`, ["status", "--porcelain"]),
            ],
            [[["backend", "clean"]], [["backend", "held"]], tip, "M README.md\n?? build.log"],
          );
        }),
      ),
  );

  it.effect("sweeps at boot: WIP for a dirty lane, rework left open, a 0-byte ref parks", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        const store = yield* CrewStore.CrewStore;
        const lanes = ["backend", "frontend", "map", "quiet"] as const;
        for (const handle of lanes) yield* workspace.create({ ...BACKEND, handle });
        write(root, ".crew/backend/src/api.ts", "export {};\n");
        write(root, ".crew/frontend/README.md", "lane\n");
        yield* workspace.commitTurn(
          { crew: "game", handle: "frontend" },
          { assignment: "a-2", turn: 1 },
        );
        write(root, "README.md", "person\n");
        git(root, ["commit", "-q", "-am", "person"]);
        gitExit(`${root}/.crew/frontend`, ["merge", "-q", "main"]);
        NodeFS.writeFileSync(`${root}/.git/refs/heads/crew/map`, "");
        const swept = yield* workspace.sweep(TEST_HOST);
        const backend = swept.lanes.find((lane) => lane.handle === "backend");
        assert.deepStrictEqual(
          {
            lanes: swept.lanes.map((lane) => [lane.handle, lane._tag]),
            // What the WIP commit saved, and where: the person is told (`crewBoot`).
            saved: backend?._tag === "committed" ? backend.saved : undefined,
            savedTip: backend?._tag === "committed" ? backend.tip : undefined,
            merging: swept.lanes.find((lane) => lane.handle === "frontend"),
            broken: swept.brokenRefs,
            mapState: Option.getOrUndefined(yield* store.getLane("game", "map"))?.state,
            backendClean: git(`${root}/.crew/backend`, ["status", "--porcelain"]),
          },
          {
            lanes: [
              ["backend", "committed"],
              ["frontend", "merging"],
              ["map", "parked"],
              ["quiet", "clean"],
            ],
            saved: ["src/api.ts"],
            savedTip: git(`${root}/.crew/backend`, ["rev-parse", "HEAD"]),
            merging: { handle: "frontend", _tag: "merging", paths: ["README.md"] },
            broken: ["refs/heads/crew/map"],
            mapState: "parked",
            backendClean: "",
          },
        );
      }),
    ),
  );

  // A save that only deletes is a save too: the person is told what it took.
  it.effect("names a file the boot sweep's commit deleted", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create(BACKEND);
        write(root, ".crew/backend/src/api.ts", "export {};\n");
        yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
        NodeFS.rmSync(`${root}/.crew/backend/src/api.ts`);
        const swept = yield* workspace.sweep(TEST_HOST);
        const backend = swept.lanes.find((lane) => lane.handle === "backend");
        assert.deepStrictEqual(backend?._tag === "committed" ? backend.saved : backend, [
          "src/api.ts",
        ]);
      }),
    ),
  );

  it.effect("removes a clean lane, keeps one with unlanded work until the person discards it", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        const store = yield* CrewStore.CrewStore;
        const FRONTEND = { ...BACKEND, handle: "frontend" };
        yield* workspace.create(BACKEND);
        yield* workspace.create(FRONTEND);
        write(root, ".crew/frontend/src/ui.ts", "export {};\n");
        yield* workspace.commitTurn(FRONTEND, { assignment: "a-2", turn: 1 });
        const clean = yield* workspace.cleanup(BACKEND);
        const unlanded = yield* workspace.cleanup(FRONTEND);
        const discarded = yield* workspace.cleanup(FRONTEND, { discard: true });
        assert.deepStrictEqual(
          {
            clean,
            unlanded,
            discarded,
            branches: git(root, ["for-each-ref", "--format=%(refname)", "refs/heads/crew/"]),
            directories: [exists(root, ".crew/backend"), exists(root, ".crew/frontend")],
            rows: (yield* store.lanes("game")).length,
          },
          {
            clean: { _tag: "removed" },
            unlanded: { _tag: "kept", unlanded: 1, dirty: false },
            discarded: { _tag: "removed" },
            branches: "",
            directories: [false, false],
            rows: 0,
          },
        );
      }),
    ),
  );

  it.effect("finds crew branches no lane owns, with their unlanded commits", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create(BACKEND);
        git(root, ["worktree", "add", "-q", ".crew/map", "-b", "crew/map"]);
        for (const n of [1, 2]) {
          write(root, `.crew/map/src/map-${n}.ts`, "export {};\n");
          git(`${root}/.crew/map`, ["add", "-A"]);
          git(`${root}/.crew/map`, ["commit", "-q", "-m", `map ${n}`]);
        }
        assert.deepStrictEqual(yield* workspace.orphanScan(TEST_HOST), [
          { handle: "map", unlanded: 2 },
        ]);
      }),
    ),
  );

  it.effect("names a conflicted file with a non-ASCII name and commits none of its markers", () =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        write(root, "Úkol.md", "base\n");
        git(root, ["add", "-A"]);
        git(root, ["commit", "-q", "-m", "base"]);
        yield* workspace.create(BACKEND);
        write(root, ".crew/backend/Úkol.md", "lane\n");
        yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
        write(root, "Úkol.md", "person\n");
        git(root, ["commit", "-q", "-am", "person"]);
        gitExit(`${root}/.crew/backend`, ["merge", "-q", "main"]);
        const outcome = yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 2 });
        assert.deepStrictEqual(outcome, {
          _tag: "rework",
          paths: ["Úkol.md"],
          reason: "Resolve the conflict markers left in Úkol.md",
        });
      }),
    ),
  );

  const RESOLUTIONS: ReadonlyArray<{
    readonly name: string;
    readonly resolve: (root: string, lane: string) => void;
    readonly expected: "rework" | "committed";
    /** After the turn: whether README.md is unmerged again. */
    readonly unmergedAfter: boolean;
  }> = [
    {
      name: "a lone ======= left in the conflicted file is a marker",
      resolve: (_root, lane) => write(lane, "README.md", "person\n=======\nlane\n"),
      expected: "rework",
      unmergedAfter: true,
    },
    {
      name: "trailing whitespace in a resolution is not",
      resolve: (_root, lane) => write(lane, "README.md", "person and lane   \n \tindented\n"),
      expected: "committed",
      unmergedAfter: false,
    },
    {
      name: "a marker-like line in a file the merge did not conflict on is not",
      resolve: (_root, lane) => {
        write(lane, "README.md", "person and lane\n");
        write(lane, "docs/merging.md", "A conflict looks like\n<<<<<<< HEAD\n");
      },
      expected: "committed",
      unmergedAfter: false,
    },
    {
      name: "a marker that only appears once staged is caught after add -A and left unmerged",
      resolve: (root, lane) => {
        git(root, ["config", "filter.sneaky.clean", "sed 's/^RESOLVED$/>>>>>>> sneaky/'"]);
        write(root, ".git/info/attributes", "README.md filter=sneaky\n");
        write(lane, "README.md", "RESOLVED\n");
      },
      expected: "rework",
      unmergedAfter: true,
    },
  ];

  it.effect.each(
    Array.from(RESOLUTIONS, (resolution) => ({
      title: `during an open merge, ${resolution.name}`,
      resolution,
    })),
  )("$title", ({ resolution }) =>
    withLanes((root) =>
      Effect.gen(function* () {
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create(BACKEND);
        const lane = `${root}/.crew/backend`;
        write(lane, "README.md", "lane\n");
        yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
        write(root, "README.md", "person\n");
        git(root, ["commit", "-q", "-am", "person"]);
        gitExit(lane, ["merge", "-q", "main"]);
        resolution.resolve(root, lane);
        const outcome = yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 2 });
        assert.deepStrictEqual(
          {
            outcome:
              outcome._tag === "rework"
                ? { tag: outcome._tag, paths: outcome.paths }
                : outcome._tag,
            unmerged: git(lane, ["diff", "--name-only", "--diff-filter=U"]) === "README.md",
          },
          {
            outcome:
              resolution.expected === "rework"
                ? { tag: "rework", paths: ["README.md"] }
                : "committed",
            unmerged: resolution.unmergedAfter,
          },
        );
      }),
    ),
  );
});

it.effect("dispatch refuses to reset a copy that still has preserved dirty work", () =>
  withLanes((root) =>
    Effect.gen(function* () {
      const workspace = yield* CrewWorkspace.CrewWorkspace;
      const store = yield* CrewStore.CrewStore;
      yield* workspace.create(BACKEND);
      const tip = git(root, ["rev-parse", "crew/backend"]);
      yield* store.updateLane("game", "backend", (row) => ({ ...row, lastLanding: tip }));
      write(root, "person.txt", "new landing\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "-m", "person"]);
      write(root, ".crew/backend/README.md", "preserved edit\n");
      const outcome = yield* workspace.prepareDispatch(BACKEND);
      assert.strictEqual(outcome._tag, "dirty");
      assert.strictEqual(git(root, ["rev-parse", "crew/backend"]), tip);
      assert.strictEqual(read(root, ".crew/backend/README.md"), "preserved edit\n");
    }),
  ),
);
