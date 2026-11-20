import {
  type OrchestrationEvent,
  OrchestrationGetSnapshotError,
  type OrchestrationShellStreamEvent,
  type OrchestrationShellStreamItem,
  type OrchestrationSubscribeShellInput,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { makeLiveStreamBudget, type RetainedLiveItem } from "./LiveStreamBudget.ts";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";

// When a resuming client's cursor is more than this many events behind the
// current head, skip the per-event catch-up replay and send a fresh shell
// snapshot instead. Replaying each intervening event costs a shell refetch;
// past this gap a single O(active-threads) snapshot is cheaper and bounded.
// Matches the event store's default page size (DEFAULT_READ_FROM_SEQUENCE_LIMIT).
const SHELL_RESUME_MAX_GAP = 1_000;

// Row count alone does not bound replay memory: a few events with large tool
// payloads can decode to gigabytes. Before replaying, sum the serialized
// payload bytes of the range in SQL and reset with a snapshot past this budget.
const ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES = 8 * 1024 * 1024;

interface ShellStreamDeps {
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly orchestrationEngine: OrchestrationEngineShape;
}

export const makeShellStream = ({
  projectionSnapshotQuery,
  orchestrationEngine,
}: ShellStreamDeps) => {
  const canReplayPersistedRange = Effect.fnUntraced(function* (
    afterSequence: number,
    headSequence: number,
    maxGap: number,
  ) {
    const replayGap = headSequence - afterSequence;
    if (replayGap < 0 || replayGap > maxGap) {
      return false;
    }
    const stats = yield* projectionSnapshotQuery
      .getEventReplayStats({
        fromSequenceExclusive: afterSequence,
        toSequenceInclusive: headSequence,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationGetSnapshotError({
              message: "Failed to measure orchestration replay range",
              cause,
            }),
        ),
      );
    if (stats.payloadBytes > ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES) {
      yield* Effect.logDebug("orchestration replay replaced by snapshot", {
        afterSequence,
        headSequence,
        replayGap,
        eventCount: stats.eventCount,
        payloadBytes: stats.payloadBytes,
        payloadBudgetBytes: ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES,
      });
      return false;
    }
    return true;
  });

  // Shell updates refetch the aggregate. Message and tool bodies are not needed.
  const toShellEvent = ({ type, aggregateKind, aggregateId, sequence }: OrchestrationEvent) => ({
    type,
    aggregateKind,
    aggregateId,
    sequence,
  });
  type ShellEvent = ReturnType<typeof toShellEvent>;

  const toShellStreamEvent = (
    event: ShellEvent,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
    switch (event.type) {
      case "project.created":
      case "project.meta-updated":
        return projectUpsertOrRemove(ProjectId.make(event.aggregateId), event.sequence);
      case "project.deleted":
        return Effect.succeedSome({
          kind: "project-removed" as const,
          sequence: event.sequence,
          projectId: ProjectId.make(event.aggregateId),
        });
      case "thread.deleted":
      case "thread.archived":
        return Effect.succeedSome({
          kind: "thread-removed" as const,
          sequence: event.sequence,
          threadId: ThreadId.make(event.aggregateId),
        });
      case "thread.unarchived":
        return threadUpsertOrRemove(ThreadId.make(event.aggregateId), event.sequence);
      default:
        if (event.aggregateKind !== "thread") {
          return Effect.succeedNone;
        }
        return threadUpsertOrRemove(ThreadId.make(event.aggregateId), event.sequence);
    }
  };

  // Coalescing makes each projection read represent every event for that
  // aggregate in the current window. Retry a typed persistence failure once
  // so a brief read failure cannot strand the shell at its previous state.
  // If both attempts fail, log and drop the stream item; treating an error as
  // a missing row would incorrectly remove a still-active aggregate.
  const retryShellProjectionRead = <A, E>(
    aggregateKind: "project" | "thread",
    aggregateId: string,
    read: Effect.Effect<A, E>,
  ): Effect.Effect<Option.Option<A>, never, never> =>
    read.pipe(
      Effect.retry({ times: 1 }),
      Effect.asSome,
      Effect.tapError((error) =>
        Effect.logWarning("orchestration shell projection refetch failed", {
          aggregateKind,
          aggregateId,
          error,
        }),
      ),
      Effect.orElseSucceed(() => Option.none()),
    );

  const projectUpsertOrRemove = (
    projectId: ProjectId,
    sequence: number,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
    retryShellProjectionRead(
      "project",
      projectId,
      projectionSnapshotQuery.getProjectShellById(projectId),
    ).pipe(
      Effect.map(
        Option.flatMap((project) =>
          Option.match(project, {
            onNone: () =>
              Option.some<OrchestrationShellStreamEvent>({
                kind: "project-removed" as const,
                sequence,
                projectId,
              }),
            onSome: (nextProject) =>
              Option.some<OrchestrationShellStreamEvent>({
                kind: "project-upserted" as const,
                sequence,
                project: nextProject,
              }),
          }),
        ),
      ),
    );

  // Refetch a thread's shell and emit an upsert if it is still active, or a
  // `thread-removed` if the projection has no active row for it. Emitting a
  // removal on a `none` (rather than dropping the event) is what keeps
  // coalescing correct: when a burst collapses a `thread.deleted`/`archived`
  // into a later refetchable event for the same thread, the refetch returns
  // `none` for the now-inactive row and this still tells the sidebar to drop
  // it. A `thread-removed` the client does not have is a harmless no-op. The
  // projection commits in the same transaction before the event publishes,
  // so a `none` reliably means the thread is deleted or archived, not
  // not-yet-persisted.
  const threadUpsertOrRemove = (
    threadId: ThreadId,
    sequence: number,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
    retryShellProjectionRead(
      "thread",
      threadId,
      projectionSnapshotQuery.getThreadShellById(threadId),
    ).pipe(
      Effect.map(
        Option.flatMap((thread) =>
          Option.match(thread, {
            onNone: () =>
              Option.some<OrchestrationShellStreamEvent>({
                kind: "thread-removed" as const,
                sequence,
                threadId,
              }),
            onSome: (nextThread) =>
              Option.some<OrchestrationShellStreamEvent>({
                kind: "thread-upserted" as const,
                sequence,
                thread: nextThread,
              }),
          }),
        ),
      ),
    );

  // Turn a batch of domain events into shell stream items, coalescing by
  // aggregate first. `toShellStreamEvent` re-reads the *current* projected
  // shell for an aggregate, so within a batch only the latest event per
  // aggregate matters: a burst of streaming `thread.message-sent` deltas for
  // one thread collapses into a single shell refetch, and an unrelated
  // `thread.created` in the same batch is never stuck behind those DB reads.
  //
  // Input events arrive in ascending sequence; we keep the last (highest
  // sequence) event per aggregate, then re-sort ascending before emitting so
  // the client — which applies shell items strictly by increasing sequence
  // and drops any `sequence <= snapshotSequence` — never skips a coalesced
  // item. The refetch runs with bounded concurrency (order-preserving).
  const SHELL_REFETCH_CONCURRENCY = 8;
  const coalesceShellEvents = (
    events: ReadonlyArray<ShellEvent>,
  ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamEvent>, never, never> =>
    Effect.gen(function* () {
      if (events.length === 0) {
        return [];
      }
      const latestByAggregate = new Map<string, ShellEvent>();
      for (const event of events) {
        latestByAggregate.set(`${event.aggregateKind}:${event.aggregateId}`, event);
      }
      const survivors = Array.from(latestByAggregate.values()).sort(
        (left, right) => left.sequence - right.sequence,
      );
      const shellEvents = yield* Effect.forEach(survivors, toShellStreamEvent, {
        concurrency: SHELL_REFETCH_CONCURRENCY,
      });
      return shellEvents.flatMap((option) => (Option.isSome(option) ? [option.value] : []));
    });

  // Small time/size window over which to coalesce shell events. The window
  // bounds the worst-case added latency for a brand-new thread to appear in
  // the sidebar (imperceptible), while collapsing high-frequency streaming
  // traffic so it can't serialize the shell stream behind per-event DB reads.
  const SHELL_COALESCE_WINDOW = Duration.millis(50);
  const SHELL_COALESCE_MAX_CHUNK = 512;
  const coalesceShellStream = <E, R>(
    stream: Stream.Stream<OrchestrationEvent, E, R>,
  ): Stream.Stream<OrchestrationShellStreamEvent, E, R> =>
    stream.pipe(
      Stream.map(toShellEvent),
      Stream.groupedWithin(SHELL_COALESCE_MAX_CHUNK, SHELL_COALESCE_WINDOW),
      Stream.mapEffect(coalesceShellEvents),
      Stream.flatMap((items) => Stream.fromIterable(items)),
    );

  type ShellLiveInput =
    | { readonly kind: "event"; readonly event: ShellEvent }
    | { readonly kind: "synchronized" };

  // A completion marker is queued alongside live event metadata so it cannot
  // overtake an event still waiting in the coalescing window. Split each
  // batch at markers and coalesce only the event segments on either side.
  const coalesceShellLiveInputs = (
    inputs: ReadonlyArray<ShellLiveInput>,
  ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamItem>, never, never> =>
    Effect.gen(function* () {
      const output: Array<OrchestrationShellStreamItem> = [];
      let pendingEvents: Array<ShellEvent> = [];

      for (const input of inputs) {
        if (input.kind === "event") {
          pendingEvents.push(input.event);
          continue;
        }

        output.push(...(yield* coalesceShellEvents(pendingEvents)));
        pendingEvents = [];
        output.push({ kind: "synchronized" });
      }

      output.push(...(yield* coalesceShellEvents(pendingEvents)));
      return output;
    });

  return (input: OrchestrationSubscribeShellInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Coalesce the live shell stream per aggregate over a small window
        // so bursts of high-frequency events (streaming message deltas,
        // activity appends) collapse into a single shell refetch and never
        // serialize a brand-new thread's `thread.created` behind hundreds
        // of per-event DB reads. See coalesceShellStream.
        // Attach live delivery into a scope-bound buffer BEFORE loading any
        // snapshot or draining catch-up, otherwise an event published while
        // the snapshot query is in flight is lost (it is past the snapshot's
        // sequence but the live subscription is not attached yet). Every
        // path below emits from this same buffered live tail. Overlapping
        // events are deduped by sequence on the client.
        const liveBudget = yield* makeLiveStreamBudget();
        const liveBuffer = yield* Queue.unbounded<
          RetainedLiveItem<ShellLiveInput>,
          OrchestrationGetSnapshotError
        >();
        let liveBufferClosed = false;
        const closeLiveBuffer = (error?: OrchestrationGetSnapshotError) =>
          Effect.gen(function* () {
            if (liveBufferClosed) {
              return;
            }
            liveBufferClosed = true;
            liveBudget.release(yield* Queue.clear(liveBuffer).pipe(Effect.orDie));
            if (error) {
              yield* Queue.fail(liveBuffer, error);
            }
            yield* Queue.shutdown(liveBuffer);
          });
        yield* Effect.addFinalizer(() => closeLiveBuffer());
        yield* liveBudget.failed.pipe(
          Effect.catchTags({ OrchestrationGetSnapshotError: closeLiveBuffer }),
          Effect.forkScoped,
        );
        yield* Effect.forkScoped(
          orchestrationEngine.streamDomainEvents.pipe(
            Stream.map(toShellEvent),
            Stream.runForEach((event) =>
              liveBudget.retain({ kind: "event" as const, event }, event).pipe(
                Effect.flatMap((item) => Queue.offer(liveBuffer, item)),
                Effect.uninterruptible,
              ),
            ),
            // Stop the PubSub consumer even if RPC delivery is waiting
            // for an ACK and never pulls the failed buffer again.
            Effect.raceFirst(liveBudget.failed),
            Effect.catchTags({ OrchestrationGetSnapshotError: () => Effect.void }),
          ),
          { startImmediately: true },
        );
        const coalesceRetainedInputs = (items: ReadonlyArray<RetainedLiveItem<ShellLiveInput>>) =>
          coalesceShellLiveInputs(items.map((item) => item.value)).pipe(
            Effect.flatMap((output) => liveBudget.replace(items, output)),
          );
        const bufferedLiveStream = Stream.fromQueue(liveBuffer).pipe(
          Stream.groupedWithin(SHELL_COALESCE_MAX_CHUNK, SHELL_COALESCE_WINDOW),
          Stream.mapEffect(coalesceRetainedInputs),
          Stream.flatMap((items) => Stream.fromIterable(items)),
        );

        const loadSnapshot = projectionSnapshotQuery.getShellSnapshot().pipe(
          Effect.tapError((cause) =>
            Effect.logError("orchestration shell snapshot load failed", { cause }),
          ),
          Effect.mapError(
            (cause) =>
              new OrchestrationGetSnapshotError({
                message: "Failed to load orchestration shell snapshot",
                cause,
              }),
          ),
        );

        // Offer the completion marker into the same queue as live events.
        // Anything buffered while snapshot/replay work was in flight is
        // therefore delivered before the client is told it is synchronized.
        const synchronizedThenLive = liveBudget.deliver(
          input.requestCompletionMarker === true
            ? Stream.concat(
                Stream.fromEffect(
                  liveBudget.retain({ kind: "synchronized" as const }).pipe(
                    Effect.flatMap((item) => Queue.offer(liveBuffer, item)),
                    Effect.uninterruptible,
                    Effect.andThen(Queue.takeAll(liveBuffer)),
                    Effect.flatMap(coalesceRetainedInputs),
                  ),
                ).pipe(Stream.flatMap((items) => Stream.fromIterable(items))),
                bufferedLiveStream,
              )
            : bufferedLiveStream,
        );

        // When the client already holds a shell snapshot (cached, or loaded
        // over HTTP) it passes that snapshot's sequence, and we resume by
        // replaying shell events after it instead of re-sending the whole
        // projects/threads list over the socket. If the client is too far
        // behind, we fall back to a fresh snapshot instead of an unbounded
        // replay (see below).
        if (input.afterSequence !== undefined) {
          const afterSequence = input.afterSequence;
          const headSequence = yield* orchestrationEngine.latestSequence;
          const replayGap = headSequence - afterSequence;
          // Gap too large: replaying every intervening event (each a shell
          // refetch) is far more expensive than a single O(active-threads)
          // snapshot. A cursor ahead of this engine's authoritative state
          // is also invalid, so reset it with a snapshot. Send the snapshot
          // followed by the buffered live tail, exactly as the
          // no-afterSequence path does.
          if (
            !(yield* canReplayPersistedRange(afterSequence, headSequence, SHELL_RESUME_MAX_GAP))
          ) {
            const snapshot = yield* loadSnapshot;
            return Stream.concat(
              Stream.make({ kind: "snapshot" as const, snapshot }),
              synchronizedThenLive,
            );
          }
          const catchUpStream = coalesceShellStream(
            // Replay only through the head captured above. Newer events
            // are already covered by the live subscription, so this bound
            // cannot chase a moving event-store head or grow the live
            // buffer indefinitely while waiting for an empty page.
            orchestrationEngine.readEvents(afterSequence, replayGap),
          ).pipe(
            Stream.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to replay orchestration shell events",
                  cause,
                }),
            ),
          );
          return Stream.concat(catchUpStream, synchronizedThenLive);
        }

        const snapshot = yield* loadSnapshot;
        return Stream.concat(
          Stream.make({
            kind: "snapshot" as const,
            snapshot,
          }),
          synchronizedThenLive,
        );
      }),
    );
};
