import * as NodeCrypto from "node:crypto";
import {
  CheckpointRef,
  type CheckpointCaptureSnapshot,
  type CheckpointDiffRootResult,
  type CheckpointHistory,
  type CheckpointHistoryRoot,
  type CheckpointRoot,
  type OrchestrationCheckpointFile,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import { CheckpointStore } from "./CheckpointStore.ts";
import { WorkspaceCaptureJournal, type CaptureRun } from "./WorkspaceCaptureJournal.ts";
import { parseTurnDiffFilesFromNumstat } from "./Diffs.ts";
import { prefixUnifiedPatch } from "../zerops/ZeropsCheckpointTargets.ts";
import { ZeropsRepositorySource, type ZeropsRepository } from "../zerops/ZeropsRepositorySource.ts";
import { ZeropsWorkspaceObserver, withRepository } from "../zerops/ZeropsWorkspaceObserver.ts";

const now = Effect.map(DateTime.now, DateTime.formatIso);
const hash = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const missing = (
  status: Exclude<CheckpointCaptureSnapshot["status"], "captured">,
  reason: string,
): CheckpointCaptureSnapshot => ({ status, reason });
const historyFor = (
  runId: string,
  roots: ReadonlyArray<CheckpointHistoryRoot>,
): CheckpointHistory => ({
  runId,
  roots,
  semantics: "observed-workspace",
  representation: "git-normalized",
  policyVersion: "git-v1",
  coverage:
    roots.length === 0
      ? "unknown"
      : roots.every(
            (r) =>
              r.before.status === "captured" &&
              r.after.status === "captured" &&
              r.files !== undefined,
          )
        ? "complete"
        : "partial",
});
export const workspaceSnapshotRef = (
  threadId: ThreadId,
  runId: string,
  rootId: string,
  side: "before" | "after",
) =>
  CheckpointRef.make(`refs/t3/checkpoints/${threadId}/runs/${hash(runId)}/${hash(rootId)}/${side}`);

export interface WorkspaceDiff {
  readonly diff: string;
  readonly roots: ReadonlyArray<CheckpointDiffRootResult>;
  readonly coverage: "complete" | "partial" | "unknown";
}

export class WorkspaceHistory extends Context.Service<
  WorkspaceHistory,
  {
    readonly prepare: (input: {
      threadId: ThreadId;
      runId: string;
      cwd: string;
      continuationOf?: TurnId;
    }) => Effect.Effect<void>;
    readonly bindTurn: (threadId: ThreadId, turnId: TurnId) => Effect.Effect<void>;
    readonly markDispatched: (threadId: ThreadId, runId: string) => Effect.Effect<void>;
    readonly finish: (input: {
      threadId: ThreadId;
      turnId: TurnId;
      cwd: string;
    }) => Effect.Effect<CheckpointHistory>;
    readonly release: (
      threadId: ThreadId,
      turnId?: TurnId,
      runId?: string,
      launchedOnly?: boolean,
    ) => Effect.Effect<void>;
    readonly read: (
      history: CheckpointHistory,
      options: { ignoreWhitespace: boolean; rootId?: string },
    ) => Effect.Effect<WorkspaceDiff>;
    readonly cleanup: (threadId: ThreadId) => Effect.Effect<void>;
  }
>()("t3/checkpointing/WorkspaceHistory") {}

export const make = Effect.gen(function* () {
  const store = yield* CheckpointStore;
  const journal = yield* WorkspaceCaptureJournal;
  const source = yield* Effect.serviceOption(ZeropsRepositorySource);
  const observer = yield* Effect.serviceOption(ZeropsWorkspaceObserver);
  // Entries are coordination receipts, not the durable record. Restarted work is
  // recovered from the journal and never waits on a dead worker's receipt.
  const active = new Map<
    string,
    {
      threadId: ThreadId;
      runId: string;
      turnId?: TurnId;
      done: Deferred.Deferred<void>;
      prepared: Deferred.Deferred<void>;
      ready: boolean;
      steering?: boolean;
      finishing?: boolean;
      dispatched?: boolean;
    }
  >();
  const captureLock = yield* Semaphore.make(1);
  const key = (threadId: ThreadId, runId: string) => JSON.stringify([threadId, runId]);
  const logFailure = (error: unknown) =>
    Effect.logWarning("Workspace history unavailable", { detail: message(error) });

  const isRemoteRoot = (root: CheckpointRoot) =>
    root.rootId.startsWith("zerops:") ||
    root.host !== undefined ||
    root.mountPath !== undefined ||
    root.projectId !== undefined ||
    root.serviceId !== undefined;
  const repositoryFor = (root: CheckpointRoot): ZeropsRepository | undefined =>
    root.host && root.mountPath && root.projectId && root.serviceId
      ? {
          host: root.host,
          mountPath: root.mountPath,
          remotePath: root.remotePath,
          identity: { projectId: root.projectId, serviceId: root.serviceId },
          rootId: root.rootId,
        }
      : undefined;

  const atRoot = <A, E, R>(root: CheckpointRoot, effect: Effect.Effect<A, E, R>) => {
    const repository = repositoryFor(root);
    return repository ? withRepository(repository, effect) : effect;
  };

  const observe = Effect.fn("WorkspaceHistory.observe")(function* (cwd: string) {
    const repositories = Option.isSome(source)
      ? yield* source.value.refresh
      : ({ _tag: "disabled" } as const);
    if (repositories._tag === "disabled") {
      return [
        {
          root: {
            rootId: `local:${cwd}`,
            label: cwd.split("/").findLast(Boolean) || cwd,
            remotePath: cwd,
            pathPrefix: "",
          },
          problem: undefined,
        },
      ] as const;
    }
    if (repositories._tag === "unavailable") {
      return [
        {
          root: {
            rootId: `unresolved:${cwd}`,
            label: "Workspace",
            remotePath: cwd,
            pathPrefix: "",
          },
          problem: repositories.reason,
        },
      ];
    }
    const candidates = repositories.repositories.filter(
      (r) =>
        r.mountPath === cwd ||
        r.mountPath.startsWith(`${cwd}/`) ||
        cwd.startsWith(`${r.mountPath}/`),
    );
    const observed: Array<{ root: CheckpointRoot; problem: string | undefined }> =
      yield* Effect.forEach(
        candidates.slice(0, 32),
        (repository) =>
          Effect.gen(function* () {
            const base = {
              rootId: `unresolved:${repository.mountPath}`,
              label: repository.host,
              host: repository.host,
              mountPath: repository.mountPath,
              remotePath: repository.remotePath,
              pathPrefix: repository.mountPath.startsWith(`${cwd}/`)
                ? `${repository.mountPath.slice(cwd.length + 1)}/`
                : "",
            };
            if (Option.isNone(observer))
              return { root: base, problem: "Remote identity inspection is unavailable." };
            const observation = yield* observer.value.observe(repository);
            if (observation._tag !== "available")
              return { root: base, problem: observation.reason };
            const verified = observation.repository;
            const root: CheckpointRoot = {
              ...base,
              rootId: verified.rootId,
              projectId: verified.identity.projectId,
              serviceId: verified.identity.serviceId,
            };
            return {
              root,
              problem:
                observation.git.state === "absent"
                  ? "This working directory has no Git repository."
                  : observation.git.state === "unsupported" ||
                      observation.git.state === "unreadable"
                    ? (observation.git.reason ?? "This Git layout is not supported for snapshots.")
                    : undefined,
            };
          }),
        { concurrency: 4 },
      );
    if (candidates.length > 32)
      observed.push({
        root: {
          rootId: `unresolved:root-limit:${cwd}`,
          label: "Additional services",
          remotePath: cwd,
          pathPrefix: "",
        },
        problem: `${candidates.length - 32} services exceed the 32-source capture limit.`,
      });
    for (const reason of repositories.limitations ?? [])
      observed.push({
        root: {
          rootId: `unresolved:mounts:${cwd}`,
          label: "Other attachments",
          remotePath: cwd,
          pathPrefix: "",
        },
        problem: reason,
      });
    return observed;
  });

  const capture = Effect.fn("WorkspaceHistory.capture")(function* (
    root: CheckpointRoot,
    ref: CheckpointRef,
    baselineOid?: string,
  ): Effect.fn.Return<CheckpointCaptureSnapshot> {
    const startedAt = yield* now;
    if (root.rootId.startsWith("unresolved:") || (isRemoteRoot(root) && !repositoryFor(root)))
      return missing("unavailable", "The source identity was not verified.");
    return yield* atRoot(
      root,
      store.captureSnapshot({
        cwd: root.mountPath ?? root.remotePath,
        checkpointRef: ref,
        ...(baselineOid ? { baselineOid } : {}),
      }),
    ).pipe(
      Effect.timeout("40 seconds"),
      Effect.flatMap((snapshot) =>
        Effect.map(now, (completedAt): CheckpointCaptureSnapshot => ({
          status: "captured",
          oid: snapshot.oid,
          ref,
          startedAt,
          completedAt,
        })),
      ),
      Effect.catch((error) => Effect.succeed(missing("refused", message(error)))),
    );
  });

  const prepare: WorkspaceHistory["Service"]["prepare"] = Effect.fn("WorkspaceHistory.prepare")(
    function* (input) {
      const runKey = key(input.threadId, input.runId);
      const continuation =
        input.continuationOf === undefined
          ? undefined
          : [...active.values()].find(
              (r) =>
                r.threadId === input.threadId && r.turnId === input.continuationOf && !r.finishing,
            );
      if (continuation) {
        yield* Deferred.await(continuation.prepared);
        continuation.steering = true;
        return;
      }
      const previous = [...active.values()].filter(
        (r) => r.threadId === input.threadId && r.runId !== input.runId,
      );
      let entry = active.get(runKey);
      if (entry) {
        yield* Deferred.await(entry.prepared);
        return;
      }
      entry = {
        ...input,
        done: yield* Deferred.make<void>(),
        prepared: yield* Deferred.make<void>(),
        ready: false,
      };
      active.set(runKey, entry);
      yield* Effect.gen(function* () {
        yield* Effect.forEach(previous, (r) => Deferred.await(r.done), { discard: true });
        yield* captureLock
          .withPermits(1)(
            Effect.gen(function* () {
              const existing = yield* journal.get(input.threadId, input.runId);
              if (existing) {
                // The request might already have reached the provider before restart.
                // Its persisted before outcome is authoritative; never take another one.
                entry.ready = true;
                return;
              }
              const overlap = [...active.values()]
                .filter((r) => r.threadId !== input.threadId && r.ready)
                .map((r) => r.runId);
              const initial: CaptureRun = {
                ...input,
                turnId: null,
                phase: "preparing",
                history: historyFor(input.runId, []),
              };
              if (!(yield* journal.insert(initial))) return;
              const observations = yield* observe(input.cwd);
              const roots = yield* Effect.forEach(
                observations,
                ({ root, problem }) =>
                  Effect.gen(function* () {
                    const before = problem
                      ? missing("unavailable", problem)
                      : yield* capture(
                          root,
                          workspaceSnapshotRef(input.threadId, input.runId, root.rootId, "before"),
                        );
                    return {
                      root,
                      before,
                      after: missing("missing-end", "Work has not been finalized."),
                    };
                  }),
                { concurrency: 4 },
              );
              yield* journal.save({
                ...initial,
                phase: "prepared",
                history: {
                  ...historyFor(input.runId, roots),
                  ...(overlap.length > 0 ? { overlappingRunIds: overlap } : {}),
                },
              });
              entry.ready = true;
            }),
          )
          .pipe(
            Effect.catch(logFailure),
            Effect.ensuring(
              Effect.gen(function* () {
                entry.ready = true;
                yield* Deferred.succeed(entry.prepared, undefined);
              }),
            ),
          );
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(entry.done, undefined);
            yield* Deferred.succeed(entry.prepared, undefined);
            active.delete(runKey);
          }),
        ),
      );
    },
  );

  const bindTurn: WorkspaceHistory["Service"]["bindTurn"] = Effect.fn("WorkspaceHistory.bindTurn")(
    function* (threadId, turnId) {
      const entry = [...active.values()].find(
        (r) =>
          r.threadId === threadId &&
          r.ready &&
          (r.turnId === turnId || r.turnId === undefined || r.steering === true),
      );
      const bindInMemory = Effect.sync(() => {
        if (entry) {
          entry.turnId = turnId;
          entry.steering = false;
        }
      });
      // Keep terminal-event cleanup usable even while the journal is failing.
      // A known historical turn must still never claim a newly prepared run.
      if (yield* journal.getByTurn(threadId, turnId).pipe(Effect.tapError(() => bindInMemory)))
        return;
      if (!entry) return;
      yield* bindInMemory;
      const run = yield* journal.get(threadId, entry.runId);
      if (!run || run.phase === "finalized") return;
      yield* journal.save({ ...run, turnId });
    },
    Effect.catch(logFailure),
  );

  const markDispatched: WorkspaceHistory["Service"]["markDispatched"] = (threadId, runId) =>
    Effect.sync(() => {
      const entry = active.get(key(threadId, runId));
      if (entry) entry.dispatched = true;
    });

  const summarize = Effect.fn("WorkspaceHistory.summarize")(
    function* (entry: CheckpointHistoryRoot) {
      if (entry.before.status !== "captured" || entry.after.status !== "captured") return undefined;
      const numstat = yield* atRoot(
        entry.root,
        store.diffCheckpoints({
          cwd: entry.root.mountPath ?? entry.root.remotePath,
          fromCheckpointRef: CheckpointRef.make(entry.before.oid),
          toCheckpointRef: CheckpointRef.make(entry.after.oid),
          fallbackFromToHead: false,
          ignoreWhitespace: false,
          format: "numstat",
          maxOutputBytes: 64_000,
        }),
      ).pipe(Effect.timeout("10 seconds"));
      if (numstat.length > 64_000) return undefined;
      const files: ReadonlyArray<OrchestrationCheckpointFile> = parseTurnDiffFilesFromNumstat(
        numstat,
      ).map((f) => ({ ...f, path: `${entry.root.pathPrefix}${f.path}`, kind: "modified" }));
      return files.length <= 200 ? files : undefined;
    },
    Effect.catch(() => Effect.succeed(undefined)),
  );

  const finish: WorkspaceHistory["Service"]["finish"] = Effect.fn("WorkspaceHistory.finish")(
    function* (input) {
      const current = [...active.values()].find(
        (r) => r.threadId === input.threadId && r.ready && r.turnId !== undefined,
      );
      if (current && current.turnId !== input.turnId && !current.steering) {
        const live = yield* journal.get(input.threadId, current.runId);
        return historyFor(
          `superseded:${input.turnId}`,
          (live?.history.roots ?? []).map((r) => ({
            root: r.root,
            before: r.before,
            after: missing(
              "missing-end",
              "This provider turn was superseded during continuous work; it has no separate end snapshot.",
            ),
          })),
        );
      }
      yield* bindTurn(input.threadId, input.turnId);
      const entry = [...active.values()].find(
        (r) => r.threadId === input.threadId && r.turnId === input.turnId,
      );
      if (entry) entry.finishing = true;
      const run = yield* journal.getByTurn(input.threadId, input.turnId);
      if (run?.phase === "finalized") return run.history;
      // A finishing receipt predating this worker may have written only some refs.
      // Never take a later image and call it the old end of the run.
      if (run?.phase === "finishing") {
        const history = { ...run.history, coverage: "partial" as const };
        yield* journal.save({ ...run, phase: "finalized", history });
        return history;
      }
      const runId = run?.runId ?? `unobserved:${input.turnId}`;
      const prior = run?.history.roots ?? [];
      const initial: CaptureRun = run ?? {
        threadId: input.threadId,
        runId,
        turnId: input.turnId,
        phase: "preparing",
        history: historyFor(runId, []),
      };
      if (!run) yield* journal.insert(initial);
      yield* journal.save({ ...initial, phase: "finishing" });
      const observed = yield* observe(input.cwd);
      const roots = new Map(prior.map((r) => [r.root.rootId, r]));
      for (const { root, problem } of observed) {
        if (!roots.has(root.rootId))
          roots.set(root.rootId, {
            root,
            before: missing(
              "missing-baseline",
              "This source was first observed after work started.",
            ),
            after: problem
              ? missing("unavailable", problem)
              : missing("missing-end", "Not captured yet."),
          });
      }
      const completed = yield* Effect.forEach(
        [...roots.values()],
        (entry) =>
          Effect.gen(function* () {
            const after = yield* capture(
              entry.root,
              workspaceSnapshotRef(input.threadId, runId, entry.root.rootId, "after"),
              entry.before.status === "captured" ? entry.before.oid : undefined,
            );
            const pair = { ...entry, after };
            const files = yield* summarize(pair);
            return { ...pair, ...(files !== undefined ? { files } : {}) };
          }),
        { concurrency: 4 },
      );
      let summaryFiles = 0;
      let summaryBytes = 0;
      const bounded = completed.map((entry) => {
        summaryFiles += entry.files?.length ?? 0;
        summaryBytes +=
          entry.files?.reduce((size, file) => size + Buffer.byteLength(file.path) + 80, 0) ?? 0;
        if (summaryFiles <= 2000 && summaryBytes <= 256_000) return entry;
        const { files: _files, ...withoutSummary } = entry;
        return withoutSummary;
      });
      const history = {
        ...historyFor(runId, bounded),
        ...(run?.history.overlappingRunIds
          ? { overlappingRunIds: run.history.overlappingRunIds }
          : {}),
      };
      yield* journal.save({ ...initial, phase: "finalized", history });
      return history;
    },
    Effect.catch((error) =>
      logFailure(error).pipe(
        Effect.as({ ...historyFor("unavailable", []), coverage: "unknown" as const }),
      ),
    ),
  );

  const release: WorkspaceHistory["Service"]["release"] = Effect.fn("WorkspaceHistory.release")(
    function* (threadId, turnId, runId, launchedOnly = false) {
      for (const [runKey, entry] of active) {
        if (
          (launchedOnly && entry.turnId === undefined && !entry.dispatched) ||
          entry.threadId !== threadId ||
          (turnId !== undefined && entry.turnId !== turnId) ||
          (runId !== undefined && entry.runId !== runId)
        )
          continue;
        yield* Deferred.succeed(entry.done, undefined);
        active.delete(runKey);
      }
    },
  );

  const read: WorkspaceHistory["Service"]["read"] = Effect.fn("WorkspaceHistory.read")(
    function* (history, options) {
      const entries = history.roots.filter(
        (r) => options.rootId === undefined || r.root.rootId === options.rootId,
      );
      const results = yield* Effect.forEach(
        entries,
        (entry) =>
          Effect.gen(function* () {
            const { root, before, after } = entry;
            const base = { rootId: root.rootId, label: root.label, pathPrefix: root.pathPrefix };
            const failure = (status: CheckpointDiffRootResult["status"], reason: string) => ({
              diff: "",
              result: { ...base, status, reason },
            });
            if (before.status !== "captured") return failure("missing-baseline", before.reason);
            if (after.status !== "captured") return failure("missing-end", after.reason);
            if (isRemoteRoot(root) && !repositoryFor(root))
              return failure(
                "identity-unresolved",
                "The historical source identity is incomplete.",
              );
            const cwd = root.mountPath ?? root.remotePath;
            return yield* atRoot(
              root,
              Effect.gen(function* () {
                for (const snapshot of [before, after]) {
                  if (
                    !(yield* store.resolveSnapshot({
                      cwd,
                      checkpointRef: snapshot.ref,
                      expectedOid: snapshot.oid,
                    }))
                  )
                    return failure(
                      "missing-objects",
                      "The recorded Git snapshots are no longer present on this service.",
                    );
                }
                const patch = yield* store.diffCheckpoints({
                  cwd,
                  fromCheckpointRef: CheckpointRef.make(before.oid),
                  toCheckpointRef: CheckpointRef.make(after.oid),
                  fallbackFromToHead: false,
                  ignoreWhitespace: options.ignoreWhitespace,
                  maxOutputBytes: 2_000_000,
                });
                if (Buffer.byteLength(patch) > 2_000_000)
                  return failure("oversized", "This diff exceeds the 2 MB review limit.");
                return {
                  diff: prefixUnifiedPatch(patch, root.pathPrefix),
                  result: { ...base, status: "available" as const },
                };
              }),
            ).pipe(
              Effect.timeout("15 seconds"),
              Effect.catch((error) => {
                const reason = message(error);
                if (/not a git repository|not a working repository/i.test(reason))
                  return Effect.succeed(
                    failure(
                      "missing-objects",
                      "The service no longer contains the Git repository holding these snapshots.",
                    ),
                  );
                const status =
                  "_tag" in error && error._tag === "VcsProcessOutputLimitError"
                    ? "oversized"
                    : reason.includes("identity mismatch")
                      ? "identity-unresolved"
                      : /snapshot objects missing|recorded snapshot.*missing|snapshot.*unreadable/i.test(
                            reason,
                          )
                        ? "missing-objects"
                        : "unavailable";
                return Effect.succeed(
                  failure(
                    status,
                    status === "missing-objects"
                      ? "The recorded Git snapshots are no longer present on this service."
                      : status === "identity-unresolved"
                        ? "The connected service does not match the identity recorded for these snapshots."
                        : reason,
                  ),
                );
              }),
            );
          }),
        { concurrency: 4 },
      );
      let bytes = 0;
      const bounded = results.map((r) => {
        bytes += Buffer.byteLength(r.diff) + 1;
        return bytes <= 2_000_000
          ? r
          : {
              diff: "",
              result: {
                ...r.result,
                status: "oversized" as const,
                reason: "Open this service separately; the combined diff exceeds the review limit.",
              },
            };
      });
      if (options.rootId !== undefined && entries.length === 0)
        return {
          diff: "",
          coverage: "unknown",
          roots: [
            {
              rootId: options.rootId,
              label: "Unknown source",
              pathPrefix: "",
              status: "identity-unresolved",
              reason: "This source does not belong to the recorded run.",
            },
          ],
        };
      return {
        diff: bounded
          .map((r) => r.diff)
          .filter(Boolean)
          .join("\n"),
        roots: bounded.map((r) => r.result),
        coverage: bounded.some((r) => r.result.status !== "available")
          ? "partial"
          : history.coverage,
      };
    },
  );

  const cleanup: WorkspaceHistory["Service"]["cleanup"] = Effect.fn("WorkspaceHistory.cleanup")(
    function* (threadId) {
      const runs = yield* journal.list(threadId);
      for (const run of runs)
        for (const entry of run.history.roots) {
          if (isRemoteRoot(entry.root) && !repositoryFor(entry.root)) continue;
          const refs = [entry.before, entry.after].flatMap((s) =>
            s.status === "captured" ? [s.ref] : [],
          );
          if (refs.length === 0) continue;
          yield* atRoot(
            entry.root,
            store.deleteCheckpointRefs({
              cwd: entry.root.mountPath ?? entry.root.remotePath,
              checkpointRefs: refs,
            }),
          ).pipe(Effect.timeout("10 seconds"), Effect.catch(logFailure));
        }
      yield* journal.remove(threadId);
      yield* release(threadId);
    },
    Effect.catch(logFailure),
  );

  return WorkspaceHistory.of({ prepare, bindTurn, markDispatched, finish, release, read, cleanup });
});

export const layer = Layer.effect(WorkspaceHistory, make);
