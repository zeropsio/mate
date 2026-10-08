import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { LandingRefusal } from "./classifyLandingRefusal.ts";
import * as CrewIntegration from "./CrewIntegration.ts";
import * as CrewStore from "./CrewStore.ts";
import * as CrewWorkspace from "./CrewWorkspace.ts";
import {
  crewGitLayer,
  git,
  gitExit,
  read,
  TEST_HOST,
  withCrewService,
  write,
} from "./testing/crewGitFixture.ts";

const BACKEND = { crew: "game", handle: "backend", host: TEST_HOST } as const;

type CrewGit = Layer.Success<ReturnType<typeof crewGitLayer>>;

const withCrew = <A, E>(body: (root: string) => Effect.Effect<A, E, CrewGit>) =>
  withCrewService(body, (root) => crewGitLayer(root));

/** A lane with one committed turn that changes `path`. */
const laneWork = (root: string, path: string, content: string) =>
  Effect.gen(function* () {
    const workspace = yield* CrewWorkspace.CrewWorkspace;
    yield* workspace.create(BACKEND);
    write(`${root}/.crew/backend`, path, content);
    return yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
  });

/** The person commits `path` on the integration branch. */
const personCommits = (root: string, path: string, content: string) => {
  write(root, path, content);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", `person edits ${path}`]);
  return git(root, ["rev-parse", "HEAD"]);
};

describe("CrewIntegration", () => {
  it.effect("merges the head into a lane cleanly, or leaves a conflict open as rework", () =>
    withCrew((root) =>
      Effect.gen(function* () {
        const integration = yield* CrewIntegration.CrewIntegration;
        yield* laneWork(root, "README.md", "lane\n");
        const current = yield* integration.mergeIn(BACKEND);
        const cleanHead = personCommits(root, "docs/person.md", "person\n");
        const clean = yield* integration.mergeIn(BACKEND);
        const conflictHead = personCommits(root, "README.md", "person\n");
        const conflict = yield* integration.mergeIn(BACKEND);
        assert.deepStrictEqual(
          {
            current: current._tag,
            clean:
              clean._tag === "merged"
                ? { head: clean.head, tip: git(root, ["rev-parse", "crew/backend"]) === clean.tip }
                : clean,
            conflict,
          },
          {
            current: "current",
            clean: { head: cleanHead, tip: true },
            conflict: { _tag: "conflict", head: conflictHead, paths: ["README.md"] },
          },
        );
      }),
    ),
  );

  const TASK = { ...BACKEND, assignment: "a-1", title: "Add the score API" } as const;

  it.effect(
    "lands one squash commit with both trailers, resets the lane to it, and lands it once",
    () =>
      withCrew((root) =>
        Effect.gen(function* () {
          const integration = yield* CrewIntegration.CrewIntegration;
          const store = yield* CrewStore.CrewStore;
          yield* laneWork(root, "src/score.ts", "export const score = 1;\n");
          const head = personCommits(root, "docs/person.md", "person\n");
          yield* integration.mergeIn(BACKEND);
          const landed = yield* integration.land(TASK);
          const again = yield* integration.land(TASK);
          const commit = git(root, ["rev-parse", "HEAD"]);
          assert.deepStrictEqual(
            {
              landed,
              again,
              parent: git(root, ["rev-parse", "HEAD^"]),
              subject: git(root, ["log", "-1", "--format=%s"]),
              trailers: git(root, ["log", "-1", "--format=%(trailers:only,unfold)"]),
              content: git(root, ["show", "HEAD:src/score.ts"]),
              lane: git(root, ["rev-parse", "crew/backend"]),
              anchors: git(root, ["for-each-ref", "refs/t3/crew/landing/"]),
              status: git(root, ["status", "--porcelain"]),
              row: Option.getOrUndefined(yield* store.getLane("game", "backend"))?.lastLanding,
            },
            {
              landed: { _tag: "landed", commit },
              again: { _tag: "already-landed", commit },
              parent: head,
              subject: "Add the score API",
              trailers: "Crew-Lane: backend\nCrew-Assignment: a-1",
              content: "export const score = 1;",
              lane: commit,
              anchors: "",
              status: "",
              row: commit,
            },
          );
        }),
      ),
  );

  const TREES: ReadonlyArray<{
    readonly name: string;
    readonly arrange: (root: string) => void;
    readonly expected: CrewIntegration.LandOutcome["_tag"];
    readonly refusal?: LandingRefusal;
    readonly after: (root: string) => unknown;
    readonly afterExpected: unknown;
  }> = [
    {
      name: "refuses over a tracked path edited in the person's tree and names it",
      arrange: (root) => write(root, "README.md", "the person's edit\n"),
      expected: "refused",
      refusal: { kind: "dirty", action: "wait", paths: ["README.md"] },
      after: (root) => read(root, "README.md"),
      afterExpected: "the person's edit\n",
    },
    {
      name: "refuses over an untracked file in the way and names it",
      arrange: (root) => write(root, "src/score.ts", "the person's own file\n"),
      expected: "refused",
      refusal: { kind: "untracked", action: "wait", paths: ["src/score.ts"] },
      after: (root) => read(root, "src/score.ts"),
      afterExpected: "the person's own file\n",
    },
    {
      name: "lands past an unrelated staged file and leaves it staged",
      arrange: (root) => {
        write(root, "docs/notes.md", "staged by the person\n");
        git(root, ["add", "docs/notes.md"]);
      },
      expected: "landed",
      after: (root) => git(root, ["diff", "--cached", "--name-only"]),
      afterExpected: "docs/notes.md",
    },
  ];

  it.effect.each(Array.from(TREES, (tree) => ({ title: tree.name, tree })))("$title", ({ tree }) =>
    withCrew((root) =>
      Effect.gen(function* () {
        const integration = yield* CrewIntegration.CrewIntegration;
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        yield* workspace.create(BACKEND);
        const lane = `${root}/.crew/backend`;
        write(lane, "README.md", "lane\n");
        write(lane, "src/score.ts", "export const score = 1;\n");
        yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
        tree.arrange(root);
        const outcome = yield* integration.land(TASK);
        assert.deepStrictEqual(
          {
            outcome: outcome._tag === "refused" ? outcome.refusal : outcome._tag,
            after: tree.after(root),
            anchors: git(root, ["for-each-ref", "refs/t3/crew/landing/"]),
          },
          {
            outcome: tree.refusal ?? tree.expected,
            after: tree.afterExpected,
            anchors: "",
          },
        );
      }),
    ),
  );

  it.effect(
    "lands nothing from a lane with nothing of its own: level with your tree, behind it, or back to it",
    () =>
      withCrew((root) =>
        Effect.gen(function* () {
          const integration = yield* CrewIntegration.CrewIntegration;
          const workspace = yield* CrewWorkspace.CrewWorkspace;
          yield* workspace.create(BACKEND);
          const head = git(root, ["rev-parse", "HEAD"]);
          const level = yield* integration.land(TASK);
          personCommits(root, "docs/person.md", "person\n");
          const behind = yield* integration.land(TASK);
          yield* integration.mergeIn(BACKEND);
          write(`${root}/.crew/backend`, "docs/person.md", "undone\n");
          yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 1 });
          write(`${root}/.crew/backend`, "docs/person.md", "person\n");
          yield* workspace.commitTurn(BACKEND, { assignment: "a-1", turn: 2 });
          const undone = yield* integration.land(TASK);
          assert.deepStrictEqual(
            {
              level,
              behind,
              undone,
              landings: git(root, ["rev-list", "--count", `${head}..HEAD`]),
              anchors: git(root, ["for-each-ref", "refs/t3/crew/landing/"]),
            },
            {
              level: { _tag: "nothing" },
              behind: { _tag: "nothing" },
              undone: { _tag: "nothing" },
              landings: "1",
              anchors: "",
            },
          );
        }),
      ),
  );

  it.effect("sends a landing back to merge-in when the head moved after the merge", () =>
    withCrew((root) =>
      Effect.gen(function* () {
        const integration = yield* CrewIntegration.CrewIntegration;
        yield* laneWork(root, "src/score.ts", "export const score = 1;\n");
        yield* integration.mergeIn(BACKEND);
        const moved = personCommits(root, "docs/person.md", "person\n");
        const first = yield* integration.land(TASK);
        const remerged = yield* integration.mergeIn(BACKEND);
        const landed = yield* integration.land(TASK);
        assert.deepStrictEqual(
          {
            first,
            remerged: remerged._tag,
            landed: landed._tag,
            parent: git(root, ["rev-parse", "HEAD^"]),
            person: git(root, ["show", "HEAD:docs/person.md"]),
          },
          {
            first: { _tag: "head-moved", head: moved },
            remerged: "merged",
            landed: "landed",
            parent: moved,
            person: "person",
          },
        );
      }),
    ),
  );

  /** The first two steps of a landing, as a script killed right after them left the repository. */
  const squashAndAnchor = (root: string) => {
    const squash = git(root, [
      "commit-tree",
      "crew/backend^{tree}",
      "-p",
      "HEAD",
      "-m",
      TASK.title,
      "-m",
      `Crew-Lane: backend\nCrew-Assignment: ${TASK.assignment}`,
    ]);
    git(root, ["update-ref", `refs/t3/crew/landing/${TASK.assignment}`, squash]);
    return squash;
  };

  const trailerCount = (root: string) =>
    git(root, [
      "log",
      "--first-parent",
      "--format=%(trailers:key=Crew-Assignment,valueonly)",
      "HEAD",
    ])
      .split("\n")
      .filter((line) => line === TASK.assignment).length;

  it.effect("keeps the anchored squash through a bare git prune", () =>
    withCrew((root) =>
      Effect.gen(function* () {
        yield* laneWork(root, "src/score.ts", "export const score = 1;\n");
        const squash = squashAndAnchor(root);
        git(root, ["prune", "--expire=now"]);
        const anchored = gitExit(root, ["cat-file", "-e", squash]);
        git(root, ["update-ref", "-d", `refs/t3/crew/landing/${TASK.assignment}`]);
        git(root, ["prune", "--expire=now"]);
        assert.deepStrictEqual(
          { anchored, unanchored: gitExit(root, ["cat-file", "-e", squash]) },
          { anchored: 0, unanchored: 1 },
        );
      }),
    ),
  );

  it.effect(
    "lands exactly once after a script killed between the anchor and the fast-forward",
    () =>
      withCrew((root) =>
        Effect.gen(function* () {
          const integration = yield* CrewIntegration.CrewIntegration;
          yield* laneWork(root, "src/score.ts", "export const score = 1;\n");
          squashAndAnchor(root);
          const resolved = yield* integration.landingEvidence(TEST_HOST, TASK.assignment);
          const landed = yield* integration.land(TASK);
          assert.deepStrictEqual(
            { resolved, landed: landed._tag, trailers: trailerCount(root) },
            { resolved: null, landed: "landed", trailers: 1 },
          );
        }),
      ),
  );

  it.effect(
    "lands exactly once after a script killed between the fast-forward and the anchor's removal",
    () =>
      withCrew((root) =>
        Effect.gen(function* () {
          const integration = yield* CrewIntegration.CrewIntegration;
          yield* laneWork(root, "src/score.ts", "export const score = 1;\n");
          const squash = squashAndAnchor(root);
          git(root, ["merge", "--ff-only", "-q", squash]);
          const resolved = yield* integration.landingEvidence(TEST_HOST, TASK.assignment);
          const again = yield* integration.land(TASK);
          assert.deepStrictEqual(
            {
              resolved,
              again,
              trailers: trailerCount(root),
              anchors: git(root, ["for-each-ref", "refs/t3/crew/landing/"]),
            },
            {
              resolved: squash,
              again: { _tag: "already-landed", commit: squash },
              trailers: 1,
              anchors: "",
            },
          );
        }),
      ),
  );

  it.effect.each(
    Array.from([false, true], (fastForwarded) => ({
      title: `inspecting a landing leaves its anchor intact (landed: ${fastForwarded})`,
      fastForwarded,
    })),
  )("$title", ({ fastForwarded }) =>
    withCrew((root) =>
      Effect.gen(function* () {
        const integration = yield* CrewIntegration.CrewIntegration;
        yield* laneWork(root, "src/score.ts", "export const score = 1;\n");
        const squash = squashAndAnchor(root);
        if (fastForwarded) git(root, ["merge", "--ff-only", "-q", squash]);
        const head = git(root, ["rev-parse", "HEAD"]);
        const anchors = git(root, ["for-each-ref", "refs/t3/crew/landing/"]);
        const result = yield* integration.landingEvidence(TEST_HOST, TASK.assignment);
        assert.strictEqual(result, fastForwarded ? squash : null);
        assert.strictEqual(git(root, ["for-each-ref", "refs/t3/crew/landing/"]), anchors);
        assert.strictEqual(git(root, ["rev-parse", "HEAD"]), head);
      }),
    ),
  );

  it.effect("parks a lane whose turn moved a ref nobody explains", () =>
    withCrew((root) =>
      Effect.gen(function* () {
        const integration = yield* CrewIntegration.CrewIntegration;
        const workspace = yield* CrewWorkspace.CrewWorkspace;
        const store = yield* CrewStore.CrewStore;
        const FRONTEND = { ...BACKEND, handle: "frontend" };
        yield* workspace.create(BACKEND);
        yield* workspace.create(FRONTEND);
        yield* integration.snapshotRefs(BACKEND);
        // Explained: the engine's WIP in another lane, an attempt ref it wrote, the person's own work.
        write(root, ".crew/frontend/src/ui.ts", "export {};\n");
        yield* workspace.commitTurn(FRONTEND, { assignment: "a-2", turn: 1 });
        git(root, ["update-ref", "refs/t3/crew/run-1/a-2/1", "HEAD"]);
        personCommits(root, "docs/person.md", "person\n");
        git(root, ["update-ref", "refs/t3/checkpoints/thread-1/turn/1", "HEAD"]);
        // Unexplained: what the backend lane's turn did outside its lane.
        git(root, ["tag", "v1"]);
        git(root, ["branch", "feature/sneaky"]);
        const changes = yield* integration.police(BACKEND, ["refs/t3/crew/run-1/a-2/1"]);
        const head = git(root, ["rev-parse", "HEAD"]);
        assert.deepStrictEqual(
          {
            changes,
            state: Option.getOrUndefined(yield* store.getLane("game", "backend"))?.state,
          },
          {
            changes: [
              { ref: "refs/heads/feature/sneaky", before: null, after: head },
              { ref: "refs/tags/v1", before: null, after: head },
            ],
            state: "parked",
          },
        );
      }),
    ),
  );

  it.effect("names a conflicted file with a non-ASCII name as it is on disk", () =>
    withCrew((root) =>
      Effect.gen(function* () {
        const integration = yield* CrewIntegration.CrewIntegration;
        personCommits(root, "Úkol.md", "base\n");
        yield* laneWork(root, "Úkol.md", "lane\n");
        personCommits(root, "Úkol.md", "person\n");
        const conflict = yield* integration.mergeIn(BACKEND);
        assert.deepStrictEqual(conflict._tag === "conflict" ? conflict.paths : conflict, [
          "Úkol.md",
        ]);
      }),
    ),
  );
});
