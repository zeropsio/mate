import { it } from "@effect/vitest";
import { ThreadId, TurnId, VcsProcessExitError, type CheckpointHistory } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ZeropsRepositorySource, type ZeropsRepository } from "../zerops/ZeropsRepositorySource.ts";
import { ZeropsWorkspaceObserver, workspaceRootId } from "../zerops/ZeropsWorkspaceObserver.ts";
import { CheckpointStore } from "./CheckpointStore.ts";
import * as Journal from "./WorkspaceCaptureJournal.ts";
import * as History from "./WorkspaceHistory.ts";

const threadId = ThreadId.make("thread");
const turnId = TurnId.make("turn");
const repository = (host: string, serviceId = host): ZeropsRepository => ({
  host,
  mountPath: `/var/www/${host}`,
  remotePath: "/var/www",
  identity: { projectId: "project", serviceId },
  rootId: workspaceRootId("project", serviceId, "/var/www"),
});

const harness = Effect.fn("harness")(function* () {
  let repositories = [repository("api"), repository("app")];
  const captures: Array<{ cwd: string; ref: string; oid: string }> = [];
  const comparisons: Array<{ cwd: string; from: string; to: string }> = [];
  const objects = new Set<string>();
  const unavailable = new Set<string>();
  const readErrors = new Map<string, string>();
  const captureErrors = new Map<string, string>();
  let captureBarrier: Deferred.Deferred<void> | undefined;
  const captureEntered = yield* Deferred.make<void>();
  const afterCaptureEntered = yield* Deferred.make<void>();
  const store = CheckpointStore.of({
    isGitRepository: () => Effect.succeed(true),
    captureCheckpoint: () => Effect.die("legacy capture used"),
    captureSnapshot: (input) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(captureEntered, undefined);
        if (input.checkpointRef.endsWith("/after"))
          yield* Deferred.succeed(afterCaptureEntered, undefined);
        if (captureBarrier) yield* Deferred.await(captureBarrier);
        const refused = captureErrors.get(input.cwd);
        if (refused !== undefined) {
          return yield* new VcsProcessExitError({
            operation: "test",
            command: "git",
            cwd: input.cwd,
            exitCode: 1,
            detail: refused,
          });
        }
        const oid = (captures.length + 1).toString(16).padStart(40, "0");
        captures.push({ cwd: input.cwd, ref: input.checkpointRef, oid });
        objects.add(oid);
        return {
          oid,
          representation: "git-normalized" as const,
          policyVersion: "git-v1" as const,
          reused: false,
        };
      }),
    resolveSnapshot: ({ cwd, expectedOid }) =>
      readErrors.has(cwd)
        ? Effect.fail(
            new VcsProcessExitError({
              operation: "test",
              command: "git",
              cwd,
              exitCode: 1,
              detail: readErrors.get(cwd)!,
            }),
          )
        : unavailable.has(cwd)
          ? Effect.fail(
              new VcsProcessExitError({
                operation: "test",
                command: "ssh",
                cwd,
                exitCode: 255,
                detail: "SSH unavailable",
              }),
            )
          : Effect.succeed(expectedOid && objects.has(expectedOid) ? expectedOid : null),
    hasCheckpointRef: ({ cwd, checkpointRef }) =>
      unavailable.has(cwd)
        ? Effect.fail(
            new VcsProcessExitError({
              operation: "test",
              command: "ssh",
              cwd,
              exitCode: 255,
              detail: "SSH unavailable",
            }),
          )
        : Effect.succeed(objects.has(checkpointRef)),
    restoreCheckpoint: () => Effect.die("review must not restore"),
    deleteCheckpointRefs: () => Effect.void,
    diffCheckpoints: ({ cwd, fromCheckpointRef, toCheckpointRef, format }) =>
      Effect.sync(() => {
        comparisons.push({ cwd, from: fromCheckpointRef, to: toCheckpointRef });
        return format === "numstat"
          ? "1\t0\tsrc/main.ts\0"
          : "diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -0,0 +1 @@\n+hello\n";
      }),
  });
  const source = ZeropsRepositorySource.of({
    list: Effect.sync(() => ({ _tag: "available" as const, repositories })),
    refresh: Effect.sync(() => ({ _tag: "available" as const, repositories })),
    known: Effect.sync(() => repositories),
    remember: () => Effect.void,
  });
  const observer = ZeropsWorkspaceObserver.of({
    observe: (repo) =>
      Effect.succeed({
        _tag: "available",
        repository: { ...repo, identity: repo.identity!, rootId: repo.rootId! },
        git: { state: "ready", shallow: false },
        observedAt: "2026-09-07T10:00:00.000Z",
      }),
  });
  const journal = yield* Journal.WorkspaceCaptureJournal;
  let failInsert = false;
  let failTurnLookup = false;
  const faultedJournal = Journal.WorkspaceCaptureJournal.of({
    ...journal,
    getByTurn: (threadId, turnId) =>
      Effect.suspend(() =>
        failTurnLookup
          ? Effect.fail(
              new Journal.CaptureJournalError({ cause: new Error("journal read unavailable") }),
            )
          : journal.getByTurn(threadId, turnId),
      ),
    insert: (run) =>
      Effect.suspend(() =>
        failInsert
          ? Effect.fail(
              new Journal.CaptureJournalError({ cause: new Error("journal write unavailable") }),
            )
          : journal.insert(run),
      ),
  });
  const build = History.make.pipe(
    Effect.provideService(CheckpointStore, store),
    Effect.provideService(ZeropsRepositorySource, source),
    Effect.provideService(ZeropsWorkspaceObserver, observer),
    Effect.provideService(Journal.WorkspaceCaptureJournal, faultedJournal),
  );
  const history = yield* build;
  return {
    history,
    build,
    journal,
    captures,
    comparisons,
    objects,
    unavailable,
    readErrors,
    captureErrors,
    captureEntered,
    afterCaptureEntered,
    failJournalInsert: (value: boolean) => {
      failInsert = value;
    },
    failJournalTurnLookup: (value: boolean) => {
      failTurnLookup = value;
    },
    setRepositories: (value: ZeropsRepository[]) => {
      repositories = value;
    },
    blockCapture: (barrier: Deferred.Deferred<void>) => {
      captureBarrier = barrier;
    },
    prepare: (runId = "request") => history.prepare({ threadId, runId, cwd: "/var/www" }),
    finish: () => history.finish({ threadId, turnId, cwd: "/var/www" }),
  };
});
const testLayer = Journal.layer.pipe(Layer.provide(SqlitePersistenceMemory));

describe("Workspace history", () => {
  it.effect("why a run's capture broke is held only while its run is", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      h.failJournalInsert(true);
      yield* h.prepare();
      const gaps = yield* h.history.gapsOf(threadId, "request");
      expect(gaps.map((gap) => gap.service)).toEqual(["workspace"]);
      yield* h.history.release(threadId, undefined, "request");
      expect(yield* h.history.gapsOf(threadId, "request")).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("names each service a run's capture could not snapshot, and why", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      h.captureErrors.set("/var/www/api", "Snapshot refused: disk full");
      yield* h.prepare();
      const gaps = yield* h.history.gapsOf(threadId, "request");
      expect(gaps).toHaveLength(1);
      expect(gaps[0]?.service).toBe("api");
      expect(gaps[0]?.reason).toContain("disk full");
      expect(yield* h.history.gapsOf(threadId, "never-prepared")).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  for (const [detail, status, reason] of [
    [
      "fatal: not a git repository",
      "missing-objects",
      "The service no longer contains the Git repository holding these snapshots.",
    ],
    [
      "Snapshot refused: snapshot objects missing",
      "missing-objects",
      "The recorded Git snapshots are no longer present on this service.",
    ],
    [
      "identity mismatch expected project/service",
      "identity-unresolved",
      "The connected service does not match the identity recorded for these snapshots.",
    ],
  ] as const)
    it.effect(`explains ${detail} without leaking raw Git failures into the review`, () =>
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.prepare();
        const completed = yield* h.finish();
        h.readErrors.set("/var/www/api", detail);
        const result = yield* h.history.read(completed, { ignoreWhitespace: false });
        expect(result.roots[0]).toMatchObject({ status, reason });
        expect(result.roots[1]?.status).toBe("available");
        expect(result.coverage).toBe("partial");
      }).pipe(Effect.provide(testLayer)),
    );

  it.effect("a journal read failure cannot prevent terminal cleanup of a bound run", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.prepare();
      h.failJournalTurnLookup(true);
      yield* h.history.bindTurn(threadId, turnId);
      yield* h.finish();
      yield* h.history.release(threadId, turnId);
      h.failJournalTurnLookup(false);
      const next = yield* h
        .prepare("after-journal-recovery")
        .pipe(Effect.timeout("1 second"), Effect.result, Effect.forkChild);
      yield* TestClock.adjust("2 seconds");
      expect(yield* Fiber.join(next)).toMatchObject({ _tag: "Success" });
      expect((yield* h.journal.get(threadId, "after-journal-recovery"))?.phase).toBe("prepared");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "session exit releases dispatched work before turn.started while preserving an unsent preparation",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.prepare();
        yield* h.history.release(threadId, undefined, undefined, true);
        const nextDone = yield* Deferred.make<void>();
        const next = yield* h
          .prepare("next-request")
          .pipe(Effect.andThen(Deferred.succeed(nextDone, undefined)), Effect.forkChild);
        yield* Effect.yieldNow;
        expect(yield* Deferred.isDone(nextDone)).toBe(false);
        yield* h.history.markDispatched(threadId, "request");
        yield* h.history.release(threadId, undefined, undefined, true);
        yield* Fiber.join(next);
        expect(h.captures).toHaveLength(4);
        const completed = yield* h.finish();
        expect(completed.runId).toBe("next-request");
        expect(completed.coverage).toBe("complete");
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "interrupting a queued preparation cannot strand later requests behind its receipt",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.prepare();
        yield* h.history.bindTurn(threadId, turnId);
        const queuedEntered = yield* Deferred.make<void>();
        const queued = yield* Deferred.succeed(queuedEntered, undefined).pipe(
          Effect.andThen(h.prepare("cancelled-queued")),
          Effect.forkChild,
        );
        yield* Deferred.await(queuedEntered);
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(queued);
        yield* h.history.release(threadId, turnId);
        const next = yield* h
          .prepare("next-request")
          .pipe(Effect.timeout("1 second"), Effect.result, Effect.forkChild);
        yield* TestClock.adjust("2 seconds");
        expect(yield* Fiber.join(next)).toMatchObject({ _tag: "Success" });
        expect((yield* h.journal.get(threadId, "next-request"))?.phase).toBe("prepared");
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("duplicate preparation awaits the same durable before receipt", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      const barrier = yield* Deferred.make<void>();
      h.blockCapture(barrier);
      const first = yield* h.prepare().pipe(Effect.forkChild);
      yield* Deferred.await(h.captureEntered);
      const duplicateEntered = yield* Deferred.make<void>();
      const duplicateDone = yield* Deferred.make<void>();
      const duplicate = yield* Deferred.succeed(duplicateEntered, undefined).pipe(
        Effect.andThen(h.prepare()),
        Effect.andThen(Deferred.succeed(duplicateDone, undefined)),
        Effect.forkChild,
      );
      yield* Deferred.await(duplicateEntered);
      yield* Effect.yieldNow;
      expect(yield* Deferred.isDone(duplicateDone)).toBe(false);
      yield* Deferred.succeed(barrier, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(duplicate);
      expect(h.captures).toHaveLength(2);
      expect((yield* h.journal.get(threadId, "request"))?.phase).toBe("prepared");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("same-turn steering joins the running capture without waiting for its end", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.prepare();
      yield* h.history.bindTurn(threadId, turnId);
      yield* h.history.prepare({
        threadId,
        runId: "steer",
        cwd: "/var/www",
        continuationOf: turnId,
      });
      yield* h.history.bindTurn(threadId, turnId);
      expect(h.captures).toHaveLength(2);
      expect(yield* h.journal.get(threadId, "steer")).toBeUndefined();
      yield* h.history.release(threadId, undefined, "steer");
      const completed = yield* h.finish();
      expect(completed.runId).toBe("request");
      expect(completed.coverage).toBe("complete");
      expect(h.captures).toHaveLength(4);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("a steer joins the thread's live run even when no run carries its turn", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.prepare();
      yield* h.history.markDispatched(threadId, "request");
      const steer = yield* h.history
        .prepare({
          threadId,
          runId: "steer",
          cwd: "/var/www",
          continuationOf: TurnId.make("turn-the-run-never-heard-of"),
        })
        .pipe(Effect.timeout("1 second"), Effect.result, Effect.forkChild);
      yield* TestClock.adjust("2 seconds");
      expect(yield* Fiber.join(steer)).toMatchObject({ _tag: "Success" });
      expect(yield* h.journal.get(threadId, "steer")).toBeUndefined();
      expect(h.captures).toHaveLength(2);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "a message sent before the turn it steers began joins that run, and the next one starts clean",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        const first = TurnId.make("turn-first");
        const next = TurnId.make("turn-next");
        let running: TurnId | undefined;
        // A is sent; its turn has not started yet when B arrives.
        yield* h.prepare("a");
        yield* h.history.markDispatched(threadId, "a");
        const b = yield* h.history
          .prepare({
            threadId,
            runId: "b",
            cwd: "/var/www",
            liveTurn: Effect.sync(() => running),
          })
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* h.history.bindTurn(threadId, first);
        running = first;
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(b);
        // B steered A's turn: it is part of A's run, never a run of its own.
        expect(yield* h.journal.get(threadId, "b")).toBeUndefined();
        yield* h.history.finish({ threadId, turnId: first, cwd: "/var/www" });
        yield* h.history.release(threadId, first);
        running = undefined;

        const c = yield* h
          .prepare("c")
          .pipe(Effect.timeout("1 second"), Effect.result, Effect.forkChild);
        yield* TestClock.adjust("2 seconds");
        expect(yield* Fiber.join(c)).toMatchObject({ _tag: "Success" });
        yield* h.history.markDispatched(threadId, "c");
        yield* h.history.bindTurn(threadId, next);
        expect((yield* h.journal.get(threadId, "c"))?.turnId).toBe(next);
        expect((yield* h.journal.get(threadId, "c"))?.history.overlappingRunIds).toBeUndefined();
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect.each(["before", "after"] as const)(
    "a run its message steered into another turn is released when that turn binds (sent %s)",
    (sentWhen) =>
      Effect.gen(function* () {
        const h = yield* harness();
        const first = TurnId.make("turn-first");
        const next = TurnId.make("turn-next");
        // A's setup outlasts B's wait: B starts as its own run, then steers A's turn.
        yield* h.prepare("a");
        yield* h.history.markDispatched(threadId, "a");
        const b = yield* h.prepare("b").pipe(Effect.forkChild);
        yield* TestClock.adjust(History.PREVIOUS_RUN_WAIT);
        yield* Fiber.join(b);
        yield* h.history.markDispatched(threadId, "b");
        yield* h.history.sentTo(threadId, "a", first);
        if (sentWhen === "before") yield* h.history.sentTo(threadId, "b", first);
        yield* h.history.bindTurn(threadId, first);
        if (sentWhen === "after") yield* h.history.sentTo(threadId, "b", first);
        yield* h.history.finish({ threadId, turnId: first, cwd: "/var/www" });
        yield* h.history.release(threadId, first);

        const c = yield* h
          .prepare("c")
          .pipe(Effect.timeout("1 second"), Effect.result, Effect.forkChild);
        yield* TestClock.adjust("2 seconds");
        expect(yield* Fiber.join(c)).toMatchObject({ _tag: "Success" });
        yield* h.history.markDispatched(threadId, "c");
        yield* h.history.bindTurn(threadId, next);
        expect((yield* h.journal.get(threadId, "c"))?.turnId).toBe(next);
        expect((yield* h.journal.get(threadId, "a"))?.turnId).toBe(first);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("a new request waits for a running run only briefly, and says they overlap", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.prepare();
      yield* h.history.bindTurn(threadId, turnId);
      const second = yield* h.prepare("request-2").pipe(Effect.forkChild);
      yield* TestClock.adjust(History.PREVIOUS_RUN_WAIT);
      yield* Fiber.join(second);
      const run = yield* h.journal.get(threadId, "request-2");
      expect(run?.phase).toBe("prepared");
      expect(run?.history.overlappingRunIds).toEqual(["request"]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "a superseded provider turn cannot capture an end for a still-running steered span",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.prepare();
        yield* h.history.bindTurn(threadId, turnId);
        const replacement = TurnId.make("replacement");
        yield* h.history.prepare({
          threadId,
          runId: "steer",
          cwd: "/var/www",
          continuationOf: turnId,
        });
        yield* h.history.bindTurn(threadId, replacement);
        const stale = yield* h.finish();
        expect(h.captures).toHaveLength(2);
        expect(stale.coverage).not.toBe("complete");
        expect((yield* h.journal.get(threadId, "request"))?.turnId).toBe(replacement);
        expect((yield* h.journal.get(threadId, "request"))?.phase).toBe("prepared");
        yield* h.history.release(threadId, turnId);
        const completed = yield* h.history.finish({
          threadId,
          turnId: replacement,
          cwd: "/var/www",
        });
        expect(completed.runId).toBe("request");
        expect(completed.coverage).toBe("complete");
        expect(h.captures).toHaveLength(4);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("session exit releases a failed preparation so a later request can start", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      h.failJournalInsert(true);
      yield* h.prepare();
      expect(h.captures).toHaveLength(0);
      expect(yield* h.journal.get(threadId, "request")).toBeUndefined();
      yield* h.history.release(threadId);
      h.failJournalInsert(false);
      yield* h.prepare("recovered");
      expect((yield* h.journal.get(threadId, "recovered"))?.phase).toBe("prepared");
      expect(h.captures).toHaveLength(2);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "cancelling a run releases its gate without substituting its end for the next before",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.prepare();
        yield* h.history.bindTurn(threadId, turnId);
        const cancelled = yield* h.finish();
        yield* h.history.release(threadId, turnId);
        yield* h.prepare("after-cancel");
        expect(h.captures).toHaveLength(6);
        expect(
          (yield* h.journal.get(threadId, "after-cancel"))?.history.roots[0]?.before,
        ).not.toEqual(cancelled.roots[0]?.after);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "restart during before capture records missing baseline instead of taking a later before",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        const barrier = yield* Deferred.make<void>();
        h.blockCapture(barrier);
        const preparing = yield* h.prepare().pipe(Effect.forkChild);
        yield* Deferred.await(h.captureEntered);
        yield* Fiber.interrupt(preparing);
        expect((yield* h.journal.get(threadId, "request"))?.phase).toBe("preparing");
        yield* Deferred.succeed(barrier, undefined);
        const restarted = yield* h.build;
        yield* restarted.prepare({ threadId, runId: "request", cwd: "/var/www" });
        expect(h.captures).toHaveLength(0);
        const completed = yield* restarted.finish({ threadId, turnId, cwd: "/var/www" });
        expect(completed.coverage).toBe("partial");
        expect(completed.roots.every((root) => root.before.status === "missing-baseline")).toBe(
          true,
        );
        expect(h.captures).toHaveLength(2);
        expect(h.captures.every((capture) => capture.ref.endsWith("/after"))).toBe(true);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("restart during after capture never fabricates a later completed end", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.prepare();
      yield* h.history.bindTurn(threadId, turnId);
      const barrier = yield* Deferred.make<void>();
      h.blockCapture(barrier);
      const ending = yield* h.finish().pipe(Effect.forkChild);
      yield* Deferred.await(h.afterCaptureEntered);
      yield* Fiber.interrupt(ending);
      const interrupted = yield* h.journal.get(threadId, "request");
      expect(interrupted?.phase).toBe("finishing");
      const restarted = yield* h.build;
      const completed = yield* restarted.finish({ threadId, turnId, cwd: "/var/www" });
      expect(h.captures).toHaveLength(2);
      expect(completed.coverage).toBe("partial");
      expect(completed.roots.every((root) => root.after.status === "missing-end")).toBe(true);
      expect((yield* h.journal.get(threadId, "request"))?.phase).toBe("finalized");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "persists before receipts before releasing preparation, and keeps the user's actual start",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        const barrier = yield* Deferred.make<void>();
        h.blockCapture(barrier);
        const prepared = yield* Deferred.make<void>();
        const fiber = yield* h
          .prepare()
          .pipe(Effect.andThen(Deferred.succeed(prepared, undefined)), Effect.forkChild);
        yield* Deferred.await(h.captureEntered);
        expect(yield* Deferred.isDone(prepared)).toBe(false);
        expect((yield* h.journal.get(threadId, "request"))?.phase).toBe("preparing");
        yield* Deferred.succeed(barrier, undefined);
        yield* Fiber.join(fiber);
        const run = yield* h.journal.get(threadId, "request");
        expect(run?.history.roots.every((r) => r.before.status === "captured")).toBe(true);
        expect(run?.phase).toBe("prepared");
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("reads recorded API and app snapshots after another service is attached", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.prepare();
      yield* h.history.bindTurn(threadId, turnId);
      const completed = yield* h.finish();
      h.setRepositories([repository("new-service")]);
      h.comparisons.length = 0;
      const result = yield* h.history.read(completed, { ignoreWhitespace: false });
      expect(result.roots.map((r) => r.label)).toEqual(["api", "app"]);
      expect(h.comparisons.map((c) => c.cwd)).toEqual(["/var/www/api", "/var/www/app"]);
      expect(result.coverage).toBe("complete");
      expect(result.diff).toContain("api/src/main.ts");
      expect(result.diff).toContain("app/src/main.ts");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "retains app detail when API is disconnected and retries instead of caching absence",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.prepare();
        const completed = yield* h.finish();
        h.unavailable.add("/var/www/api");
        const partial = yield* h.history.read(completed, { ignoreWhitespace: false });
        expect(partial.coverage).toBe("partial");
        expect(partial.roots.map((r) => r.status)).toEqual(["unavailable", "available"]);
        expect(partial.diff).toContain("app/src/main.ts");
        h.unavailable.clear();
        expect((yield* h.history.read(completed, { ignoreWhitespace: true })).coverage).toBe(
          "complete",
        );
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("reports lost objects separately from an unreachable service", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.prepare();
      const completed = yield* h.finish();
      h.objects.delete(h.captures[0]!.oid);
      const result = yield* h.history.read(completed, { ignoreWhitespace: false });
      expect(result.roots[0]?.status).toBe("missing-objects");
      expect(result.roots[1]?.status).toBe("available");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("a source first observed during work never acquires a fictional before snapshot", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      h.setRepositories([repository("api")]);
      yield* h.prepare();
      h.setRepositories([repository("api"), repository("app")]);
      const completed = yield* h.finish();
      expect(completed.roots[1]?.before.status).toBe("missing-baseline");
      expect(completed.roots[1]?.after.status).toBe("captured");
      expect(h.captures.filter((c) => c.cwd === "/var/www/app")).toHaveLength(1);
      expect(completed.coverage).toBe("partial");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("same hostname and new service ID keep distinct historical roots", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      h.setRepositories([repository("api", "old")]);
      yield* h.prepare();
      h.setRepositories([repository("api", "new")]);
      const completed = yield* h.finish();
      expect(completed.roots.map((r) => r.root.serviceId)).toEqual(["old", "new"]);
      expect(completed.roots[1]?.before.status).toBe("missing-baseline");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("restart and retry preserve immutable before identities", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.prepare();
      const original = yield* h.journal.get(threadId, "request");
      const restarted = yield* h.build;
      yield* restarted.prepare({ threadId, runId: "request", cwd: "/var/www" });
      expect(h.captures).toHaveLength(2);
      expect((yield* h.journal.get(threadId, "request"))?.history).toEqual(original?.history);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("the next request waits for finalized history to be published", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.prepare();
      yield* h.history.bindTurn(threadId, turnId);
      const secondDone = yield* Deferred.make<void>();
      const second = yield* h
        .prepare("request-2")
        .pipe(Effect.andThen(Deferred.succeed(secondDone, undefined)), Effect.forkChild);
      const completed = yield* h.finish();
      expect(completed.coverage).toBe("complete");
      expect(yield* Deferred.isDone(secondDone)).toBe(false);
      yield* h.history.release(threadId, turnId);
      yield* Fiber.join(second);
      expect(yield* Deferred.isDone(secondDone)).toBe(true);
      expect(h.captures).toHaveLength(6);
      const newRun = yield* h.journal.get(threadId, "request-2");
      expect(newRun?.history.roots[0]?.before).not.toEqual(completed.roots[0]?.after);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("does not recapture a finalized end after retry", () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* h.prepare();
      const completed: CheckpointHistory = yield* h.finish();
      expect(yield* h.finish()).toEqual(completed);
      expect(h.captures).toHaveLength(4);
    }).pipe(Effect.provide(testLayer)),
  );
});
