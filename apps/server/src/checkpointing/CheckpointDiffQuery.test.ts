import {
  CheckpointRef,
  ProjectId,
  ThreadId,
  TurnId,
  type CheckpointHistory,
} from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ZeropsRepositorySource } from "../zerops/ZeropsRepositorySource.ts";
import { checkpointRefForThreadTurn } from "./Utils.ts";
import * as CheckpointDiffQuery from "./CheckpointDiffQuery.ts";
import * as CheckpointStore from "./CheckpointStore.ts";
import { CheckpointThreadNotFoundError } from "./Errors.ts";
import { WorkspaceHistory } from "./WorkspaceHistory.ts";

function makeThreadCheckpointContext(input: {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
}): ProjectionSnapshotQuery.ProjectionThreadCheckpointContext {
  return {
    threadId: input.threadId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
    worktreePath: input.worktreePath,
    checkpoints: [
      {
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: input.checkpointTurnCount,
        checkpointRef: input.checkpointRef,
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

describe("CheckpointDiffQuery.layer", () => {
  it.effect("uses the narrow full-thread context lookup for all-turns diffs", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-full-thread");
      const threadId = ThreadId.make("thread-full-thread");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 4);
      let getThreadCheckpointContextCalls = 0;
      let getFullThreadDiffContextCalls = 0;
      const diffCheckpointsCalls: Array<{
        readonly fromCheckpointRef: CheckpointRef;
        readonly toCheckpointRef: CheckpointRef;
        readonly cwd: string;
        readonly ignoreWhitespace: boolean;
      }> = [];

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        captureSnapshot: () => Effect.die("unused"),
        resolveSnapshot: () => Effect.die("unused"),
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd, ignoreWhitespace }) =>
          Effect.sync(() => {
            diffCheckpointsCalls.push({
              fromCheckpointRef,
              toCheckpointRef,
              cwd,
              ignoreWhitespace,
            });
            return "full thread diff patch";
          }),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () =>
              Effect.sync(() => {
                getThreadCheckpointContextCalls += 1;
                return Option.none();
              }),
            getFullThreadDiffContext: () =>
              Effect.sync(() => {
                getFullThreadDiffContextCalls += 1;
                return Option.some({
                  threadId,
                  projectId,
                  workspaceRoot: "/tmp/workspace",
                  worktreePath: "/tmp/worktree",
                  latestCheckpointTurnCount: 4,
                  toCheckpointRef,
                });
              }),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getFullThreadDiff({
          threadId,
          toTurnCount: 4,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer));

      expect(getThreadCheckpointContextCalls).toBe(0);
      expect(getFullThreadDiffContextCalls).toBe(1);
      expect(diffCheckpointsCalls).toEqual([
        {
          cwd: "/tmp/worktree",
          fromCheckpointRef: checkpointRefForThreadTurn(threadId, 0),
          toCheckpointRef,
          ignoreWhitespace: true,
        },
      ]);
      expect(result).toEqual({
        threadId,
        fromTurnCount: 0,
        toTurnCount: 4,
        diff: "full thread diff patch",
      });
    }),
  );

  it.effect("computes diffs using canonical turn-0 checkpoint refs", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-1");
      const threadId = ThreadId.make("thread-1");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      const diffCheckpointsCalls: Array<{
        readonly fromCheckpointRef: CheckpointRef;
        readonly toCheckpointRef: CheckpointRef;
        readonly cwd: string;
        readonly ignoreWhitespace: boolean;
      }> = [];

      const threadCheckpointContext = makeThreadCheckpointContext({
        projectId,
        threadId,
        workspaceRoot: "/tmp/workspace",
        worktreePath: null,
        checkpointTurnCount: 1,
        checkpointRef: toCheckpointRef,
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        captureSnapshot: () => Effect.die("unused"),
        resolveSnapshot: () => Effect.die("unused"),
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd, ignoreWhitespace }) =>
          Effect.sync(() => {
            diffCheckpointsCalls.push({
              fromCheckpointRef,
              toCheckpointRef,
              cwd,
              ignoreWhitespace,
            });
            return "diff patch";
          }),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
            getFullThreadDiffContext: () => Effect.die("unused"),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer));

      const expectedFromRef = checkpointRefForThreadTurn(threadId, 0);
      expect(diffCheckpointsCalls).toEqual([
        {
          cwd: "/tmp/workspace",
          fromCheckpointRef: expectedFromRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        },
      ]);
      expect(result).toEqual({
        threadId,
        fromTurnCount: 0,
        toTurnCount: 1,
        diff: "diff patch",
      });
    }),
  );

  it.effect("fans out Zerops turn and full-thread diffs across mounted repositories", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-zerops-fan-out");
      const threadId = ThreadId.make("thread-zerops-fan-out");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      const calls: Array<{
        readonly cwd: string;
        readonly fromCheckpointRef: CheckpointRef;
        readonly toCheckpointRef: CheckpointRef;
        readonly ignoreWhitespace: boolean;
      }> = [];
      const patchFor = (path: string) =>
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+one\n`;
      const threadCheckpointContext = makeThreadCheckpointContext({
        projectId,
        threadId,
        workspaceRoot: "/var/www",
        worktreePath: null,
        checkpointTurnCount: 1,
        checkpointRef: toCheckpointRef,
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        captureSnapshot: () => Effect.die("unused"),
        resolveSnapshot: () => Effect.die("unused"),
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ cwd, fromCheckpointRef, toCheckpointRef, ignoreWhitespace }) =>
          Effect.sync(() => {
            calls.push({ cwd, fromCheckpointRef, toCheckpointRef, ignoreWhitespace });
            return cwd.endsWith("kanbandev") ? patchFor("src/board.ts") : patchFor("main.go");
          }),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
            getFullThreadDiffContext: () =>
              Effect.succeed(
                Option.some({
                  threadId,
                  projectId,
                  workspaceRoot: "/var/www",
                  worktreePath: null,
                  latestCheckpointTurnCount: 1,
                  toCheckpointRef,
                }),
              ),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(
            ZeropsRepositorySource,
            ZeropsRepositorySource.of({
              known: Effect.succeed([]),
              remember: () => Effect.void,
              list: Effect.succeed({
                _tag: "available",
                repositories: [
                  {
                    host: "kanbandev",
                    mountPath: "/var/www/kanbandev",
                    remotePath: "/var/www",
                  },
                  {
                    host: "apidev",
                    mountPath: "/var/www/apidev",
                    remotePath: "/var/www",
                  },
                ],
              }),
              refresh: Effect.die("CheckpointDiffQuery must use the cached repository list"),
            }),
          ),
        ),
      );

      const [turn, fullThread] = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* Effect.all([
          query.getTurnDiff({
            threadId,
            fromTurnCount: 0,
            toTurnCount: 1,
            ignoreWhitespace: false,
          }),
          query.getFullThreadDiff({
            threadId,
            toTurnCount: 1,
            ignoreWhitespace: false,
          }),
        ]);
      }).pipe(Effect.provide(layer));

      const expectedDiff = [
        "diff --git a/kanbandev/src/board.ts b/kanbandev/src/board.ts",
        "--- a/kanbandev/src/board.ts",
        "+++ b/kanbandev/src/board.ts",
        "@@ -0,0 +1 @@",
        "+one",
        "diff --git a/apidev/main.go b/apidev/main.go",
        "--- a/apidev/main.go",
        "+++ b/apidev/main.go",
        "@@ -0,0 +1 @@",
        "+one",
        "",
      ].join("\n");
      expect(turn.diff).toBe(expectedDiff);
      expect(fullThread.diff).toBe(expectedDiff);
      expect(calls.map((call) => call.cwd).toSorted()).toEqual([
        "/var/www/apidev",
        "/var/www/apidev",
        "/var/www/kanbandev",
        "/var/www/kanbandev",
      ]);
      expect(calls.every((call) => call.ignoreWhitespace === false)).toBe(true);
      expect(
        calls.every((call) => call.fromCheckpointRef === checkpointRefForThreadTurn(threadId, 0)),
      ).toBe(true);
      expect(calls.every((call) => call.toCheckpointRef === toCheckpointRef)).toBe(true);
    }),
  );

  it.effect("defaults to hide whitespace changes", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-default-whitespace");
      const threadId = ThreadId.make("thread-default-whitespace");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      const diffCheckpointsCalls: Array<{ readonly ignoreWhitespace: boolean }> = [];

      const threadCheckpointContext = makeThreadCheckpointContext({
        projectId,
        threadId,
        workspaceRoot: "/tmp/workspace",
        worktreePath: null,
        checkpointTurnCount: 1,
        checkpointRef: toCheckpointRef,
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        captureSnapshot: () => Effect.die("unused"),
        resolveSnapshot: () => Effect.die("unused"),
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: ({ ignoreWhitespace }) =>
          Effect.sync(() => {
            diffCheckpointsCalls.push({ ignoreWhitespace });
            return "diff patch";
          }),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
            getFullThreadDiffContext: () => Effect.die("unused"),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer));

      expect(diffCheckpointsCalls).toEqual([{ ignoreWhitespace: true }]);
    }),
  );

  it.effect("does not preflight checkpoint refs before diffing", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-no-preflight");
      const threadId = ThreadId.make("thread-no-preflight");
      const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
      let hasCheckpointRefCallCount = 0;

      const threadCheckpointContext = makeThreadCheckpointContext({
        projectId,
        threadId,
        workspaceRoot: "/tmp/workspace",
        worktreePath: null,
        checkpointTurnCount: 1,
        checkpointRef: toCheckpointRef,
      });

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        captureSnapshot: () => Effect.die("unused"),
        resolveSnapshot: () => Effect.die("unused"),
        hasCheckpointRef: () =>
          Effect.sync(() => {
            hasCheckpointRefCallCount += 1;
            return true;
          }),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: () => Effect.succeed("diff patch"),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
            getFullThreadDiffContext: () => Effect.die("unused"),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
          ignoreWhitespace: true,
        });
      }).pipe(Effect.provide(layer));

      expect(hasCheckpointRefCallCount).toBe(0);
    }),
  );

  it.effect("fails when the thread is missing from the snapshot", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-missing");

      const checkpointStore: CheckpointStore.CheckpointStore["Service"] = {
        isGitRepository: () => Effect.succeed(true),
        captureCheckpoint: () => Effect.void,
        captureSnapshot: () => Effect.die("unused"),
        resolveSnapshot: () => Effect.die("unused"),
        hasCheckpointRef: () => Effect.succeed(true),
        restoreCheckpoint: () => Effect.succeed(true),
        diffCheckpoints: () => Effect.succeed(""),
        deleteCheckpointRefs: () => Effect.void,
      };

      const layer = CheckpointDiffQuery.layer.pipe(
        Layer.provideMerge(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
            getUserInputActivity: () => Effect.die("unused"),
            getCommandReadModel: () =>
              Effect.die("CheckpointDiffQuery should not request the command read model"),
            getSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
            getShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request the orchestration shell snapshot"),
            getArchivedShellSnapshot: () =>
              Effect.die("CheckpointDiffQuery should not request archived shell snapshots"),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getEventReplayStats: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.none()),
            getFullThreadDiffContext: () => Effect.succeed(Option.none()),
            getThreadRuntimeContext: () => Effect.die("unused"),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: () => Effect.succeed(Option.none()),
            getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
            searchThreads: () => Effect.succeed({ matches: [] }),
          }),
        ),
      );

      const error = yield* Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer), Effect.flip);

      expect(error).toBeInstanceOf(CheckpointThreadNotFoundError);
      expect(error).toMatchObject({
        operation: "CheckpointDiffQuery.getTurnDiff",
        threadId,
      });
      expect(error.message).toBe(
        "Checkpoint invariant violation in CheckpointDiffQuery.getTurnDiff: Thread 'thread-missing' not found.",
      );
    }),
  );
});

function makeHistoryQueryHarness(
  workspaceRoot = "/var/www",
  options: { history?: boolean; service?: boolean } = {},
) {
  const threadId = ThreadId.make("historical-thread");
  const root = {
    rootId: "zerops:project:original-service:/var/www",
    label: "Original service",
    projectId: "project",
    serviceId: "original-service",
    host: "original",
    mountPath: "/var/www/original",
    remotePath: "/var/www",
    pathPrefix: "original/",
  };
  const histories = [1, 2].map((turnCount): CheckpointHistory => ({
    runId: `run-${turnCount}`,
    coverage: "complete",
    semantics: "observed-workspace",
    representation: "git-normalized",
    policyVersion: "git-v1",
    roots: [
      {
        root,
        before: {
          status: "captured",
          oid: String(turnCount * 2 - 1).repeat(40),
          ref: CheckpointRef.make(`refs/t3/checkpoints/run-${turnCount}/before`),
          startedAt: "2026-09-07T10:00:00.000Z",
          completedAt: "2026-09-07T10:00:01.000Z",
        },
        after: {
          status: "captured",
          oid: String(turnCount * 2).repeat(40),
          ref: CheckpointRef.make(`refs/t3/checkpoints/run-${turnCount}/after`),
          startedAt: "2026-09-07T10:01:00.000Z",
          completedAt: "2026-09-07T10:01:01.000Z",
        },
        files: [],
      },
    ],
  }));
  const context: ProjectionSnapshotQuery.ProjectionThreadCheckpointContext = {
    threadId,
    projectId: ProjectId.make("historical-project"),
    workspaceRoot,
    worktreePath: null,
    checkpoints: histories.map((history, index) => ({
      turnId: TurnId.make(`turn-${index + 1}`),
      checkpointTurnCount: index + 1,
      checkpointRef: checkpointRefForThreadTurn(threadId, index + 1),
      status: "ready",
      files: [],
      assistantMessageId: null,
      completedAt: "2026-09-07T10:01:01.000Z",
      ...(options.history === false ? {} : { history }),
    })),
  };
  const reads: Array<{
    history: CheckpointHistory;
    options: { ignoreWhitespace: boolean; rootId?: string };
  }> = [];
  const historyService = WorkspaceHistory.of({
    prepare: () => Effect.die("review must not capture a new baseline"),
    markDispatched: () => Effect.die("unused"),
    bindTurn: () => Effect.die("unused"),
    finish: () => Effect.die("review must not capture a new endpoint"),
    release: () => Effect.die("unused"),
    cleanup: () => Effect.die("unused"),
    read: (history, options) =>
      Effect.sync(() => {
        reads.push({ history, options });
        return {
          diff: "historical source patch",
          coverage: "complete" as const,
          roots: [
            {
              rootId: root.rootId,
              label: root.label,
              pathPrefix: root.pathPrefix,
              status: "available" as const,
            },
          ],
        };
      }),
  });
  const store = CheckpointStore.CheckpointStore.of({
    isGitRepository: () => Effect.die("must not inspect the current workspace"),
    captureCheckpoint: () => Effect.die("unused"),
    captureSnapshot: () => Effect.die("unused"),
    resolveSnapshot: () => Effect.die("history reader owns snapshot resolution"),
    hasCheckpointRef: () => Effect.die("must not inspect legacy refs"),
    restoreCheckpoint: () => Effect.die("unused"),
    diffCheckpoints: () => Effect.die("must use the recorded manifest"),
    deleteCheckpointRefs: () => Effect.die("unused"),
  });
  const projection = ProjectionSnapshotQuery.ProjectionSnapshotQuery.of({
    getUserInputActivity: () => Effect.die("unused"),
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.die("unused"),
    getCounts: () => Effect.die("unused"),
    getEventReplayStats: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
    getProjectShellById: () => Effect.die("unused"),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.succeed(Option.some(context)),
    getFullThreadDiffContext: () => Effect.die("the narrow legacy context has no manifest"),
    getThreadRuntimeContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () => Effect.die("unused"),
    getThreadDetailSnapshot: () => Effect.die("unused"),
    searchThreads: () => Effect.die("unused"),
  });
  const source = ZeropsRepositorySource.of({
    list: Effect.die("historical membership must not come from current mounts"),
    refresh: Effect.die("historical review must not refresh current mounts"),
    known: Effect.die("historical membership must come from the manifest"),
    remember: () => Effect.die("unused"),
  });
  const layer = CheckpointDiffQuery.layer.pipe(
    Layer.provide(Layer.succeed(CheckpointStore.CheckpointStore, store)),
    Layer.provide(Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, projection)),
    Layer.provide(
      options.service === false ? Layer.empty : Layer.succeed(WorkspaceHistory, historyService),
    ),
    Layer.provide(Layer.succeed(ZeropsRepositorySource, source)),
  );
  return { threadId, root, histories, reads, layer };
}

describe("CheckpointDiffQuery recorded workspace history", () => {
  for (const missing of ["history", "service"] as const) {
    it.effect(`refuses legacy fallback when the requested run has no ${missing}`, () =>
      Effect.gen(function* () {
        const harness = makeHistoryQueryHarness("/var/www", { [missing]: false });
        const results = yield* Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
          const input = {
            threadId: harness.threadId,
            toTurnCount: 2,
            runId: "run-2",
            rootId: harness.root.rootId,
          };
          return yield* Effect.all([
            query.getTurnDiff({ ...input, fromTurnCount: 1 }),
            query.getFullThreadDiff(input),
          ]);
        }).pipe(Effect.provide(harness.layer));

        expect(harness.reads).toEqual([]);
        for (const result of results)
          expect(result).toMatchObject({
            diff: "",
            coverage: "unknown",
            roots: [{ rootId: harness.root.rootId, status: "identity-unresolved" }],
          });
      }),
    );
  }

  for (const turnCount of [1, 2]) {
    it.effect(`uses turn ${turnCount}'s own before and after manifest`, () =>
      Effect.gen(function* () {
        const harness = makeHistoryQueryHarness();
        const history = harness.histories[turnCount - 1]!;
        const result = yield* Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
          return yield* query.getTurnDiff({
            threadId: harness.threadId,
            fromTurnCount: turnCount - 1,
            toTurnCount: turnCount,
            runId: history.runId,
            rootId: harness.root.rootId,
            ignoreWhitespace: false,
          });
        }).pipe(Effect.provide(harness.layer));

        expect(harness.reads).toEqual([
          { history, options: { rootId: harness.root.rootId, ignoreWhitespace: false } },
        ]);
        expect(result).toEqual({
          threadId: harness.threadId,
          fromTurnCount: turnCount - 1,
          toTurnCount: turnCount,
          diff: "historical source patch",
          coverage: "complete",
          roots: [
            {
              rootId: harness.root.rootId,
              label: harness.root.label,
              pathPrefix: harness.root.pathPrefix,
              status: "available",
            },
          ],
        });
      }),
    );
  }

  for (const kind of ["turn", "full-thread"] as const) {
    it.effect(`does not return a replacement run's patch for a stale ${kind} request`, () =>
      Effect.gen(function* () {
        const harness = makeHistoryQueryHarness();
        const result = yield* Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
          const input = {
            threadId: harness.threadId,
            toTurnCount: 2,
            runId: "replaced-run",
            rootId: harness.root.rootId,
          };
          return yield* kind === "turn"
            ? query.getTurnDiff({ ...input, fromTurnCount: 1 })
            : query.getFullThreadDiff(input);
        }).pipe(Effect.provide(harness.layer));

        expect(harness.reads).toEqual([]);
        expect(result).toMatchObject({
          diff: "",
          coverage: "unknown",
          roots: [{ rootId: harness.root.rootId, status: "identity-unresolved" }],
        });
        expect(result.roots?.[0]?.reason).toContain("Reload the conversation");
      }),
    );
  }

  it.effect(
    "reads historical service identity without a current workspace path or mount lookup",
    () =>
      Effect.gen(function* () {
        const harness = makeHistoryQueryHarness("");
        const result = yield* Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery.CheckpointDiffQuery;
          return yield* query.getTurnDiff({
            threadId: harness.threadId,
            fromTurnCount: 1,
            toTurnCount: 2,
            runId: "run-2",
            rootId: harness.root.rootId,
          });
        }).pipe(Effect.provide(harness.layer));

        expect(result.diff).toBe("historical source patch");
        expect(harness.reads).toEqual([
          {
            history: harness.histories[1],
            options: { rootId: harness.root.rootId, ignoreWhitespace: true },
          },
        ]);
        expect(harness.reads[0]?.history.roots[0]?.root).toEqual(harness.root);
      }),
  );
});
