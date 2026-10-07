/**
 * The Mate's attention (`@t3tools/contracts` `MateAttention`) as one value
 * with its revision, for the link up to HQ and for the Mate's own clients — one instance, so both
 * carry the same incarnation and the same revisions.
 *
 * Built from events, never by reading every chat again: the chats of the project at the workspace
 * root are read whole once, when the project is first found; after that each chat a domain event
 * names is read alone, once for however many events it had since its last read. A chat that is no longer active (archived, deleted) or not the project's
 * leaves; a read that fails keeps the chat as held, and its next event reads it again.
 *
 * Nothing is read or followed until the first reader asks (the link once it opens, a client's
 * subscription); from then on it is kept for the service's lifetime.
 *
 * The incarnation is one run of this server: the revision starts at 0 with it and is never kept
 * across a restart. The epoch orders the runs: counted in the state directory beside the
 * environment id and raised by one at every start, so a reader orders values of one environment by
 * epoch first, then by revision.
 *
 * @module ZeropsMateAttention
 */
import type {
  EnvironmentId,
  MateAttention,
  MateHealth,
  OrchestrationEvent,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { resourceHealthChanges } from "./mateResourceHealth.ts";
import { mateAttentionOf } from "./zeropsAttentionValue.ts";

/** The most chats followed one by one between two reads; past it, all are read whole again. */
export const MATE_ATTENTION_MOVED_MAX = 256;

/** What of a domain event the attention reads: whose it is. */
export type AttentionEvent = Pick<OrchestrationEvent, "aggregateKind" | "aggregateId">;

export interface MateAttentionReads<E> {
  readonly environmentId: EnvironmentId;
  /** This start's place among the server's starts in its environment (`nextMateEpoch`). */
  readonly epoch: number;
  /** This run of the server. */
  readonly incarnation: string;
  /** The project at the workspace root; none until it exists. */
  readonly project: Effect.Effect<Option.Option<ProjectId>, E>;
  /** Every active chat of `project`: read once, when the project is first found. */
  readonly threadsOf: (
    project: ProjectId,
  ) => Effect.Effect<ReadonlyArray<OrchestrationThreadShell>, E>;
  /** One chat as it stands; none once it is not active. */
  readonly thread: (id: ThreadId) => Effect.Effect<Option.Option<OrchestrationThreadShell>, E>;
  /** Every orchestration domain event. */
  readonly domainEvents: Stream.Stream<AttentionEvent>;
  readonly healthDemand?: Effect.Effect<void>;
  readonly health?: Stream.Stream<Omit<MateHealth, "source">>;
}

export class ZeropsMateAttention extends Context.Service<
  ZeropsMateAttention,
  {
    /** The attention as it stands. */
    readonly healthCurrent: Effect.Effect<Option.Option<MateHealth>>;
    readonly healthChanges: Stream.Stream<MateHealth>;
    readonly current: Effect.Effect<MateAttention>;
    /** The attention now, then each new revision. */
    readonly changes: Stream.Stream<MateAttention>;
  }
>()("t3/zerops/ZeropsMateAttention") {}

export const makeZeropsMateAttention = <E>(
  reads: MateAttentionReads<E>,
): Effect.Effect<ZeropsMateAttention["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const source = {
      environmentId: reads.environmentId,
      epoch: reads.epoch,
      incarnation: reads.incarnation,
    };
    const health = yield* SubscriptionRef.make<Option.Option<MateHealth>>(Option.none());
    let healthRevision = 0;
    if (reads.health !== undefined)
      yield* Effect.forkScoped(
        Stream.runForEach(reads.health, (value) => {
          const next: MateHealth = { ...value, source: { ...source, revision: healthRevision++ } };
          return SubscriptionRef.set(health, Option.some(next));
        }),
      );
    const chats = new Map<ThreadId, OrchestrationThreadShell>();
    let project = Option.none<ProjectId>();
    /**
     * Finds the project and reads its chats whole, in the order they were created; nothing while
     * the project does not exist, and the chats as held where the read fails.
     */
    const baseline = Effect.gen(function* () {
      const found = yield* reads.project;
      if (Option.isNone(found)) return;
      const threads = yield* reads.threadsOf(found.value);
      chats.clear();
      for (const thread of threads.toSorted(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
      )) {
        chats.set(thread.id, thread);
      }
      project = found;
    }).pipe(Effect.ignore);

    /** Reads one chat again; a chat new to the Mate goes last (`mateAttentionOf`'s order). */
    const refresh = (id: ThreadId) =>
      reads.thread(id).pipe(
        Effect.map((thread) => {
          if (Option.isSome(thread) && Option.contains(project, thread.value.projectId)) {
            chats.set(id, thread.value);
          } else {
            chats.delete(id);
          }
        }),
        Effect.ignore,
      );

    // Started by the first reader — the link once it opens, or a client — and then kept for the
    // service's lifetime: a server nobody reads follows nothing and reads nothing. The start runs
    // on a fiber of the service's own scope, so a reader that goes away mid-start never cuts it;
    // a start that did not finish is started again by the next reader.
    const scope = yield* Scope.Scope;
    const start = Effect.gen(function* () {
      // The chats that moved since they were last read, each once however many events it had;
      // past MATE_ATTENTION_MOVED_MAX of them every chat is read whole again instead. A wake-up
      // marks that there is something to read; it is never more than one.
      const moved = new Set<ThreadId>();
      let wholeAgain = false;
      const wake = yield* Queue.sliding<void>(1);
      // Subscribed before the baseline is read (the fork runs up to its first wait at once), so no
      // event between the two is lost; one that the baseline already holds only reads its chat again.
      yield* Effect.forkScoped(
        Stream.runForEach(reads.domainEvents, (event) => {
          if (event.aggregateKind !== "thread") return Effect.void;
          if (moved.size >= MATE_ATTENTION_MOVED_MAX) wholeAgain = true;
          else moved.add(event.aggregateId as ThreadId);
          return Queue.offer(wake, undefined);
        }),
        { startImmediately: true },
      );
      yield* baseline;
      const attention = yield* SubscriptionRef.make(
        mateAttentionOf(chats.values(), undefined, source),
      );
      // Set only when the value moved, so each revision reaches a reader once.
      const publish = Effect.gen(function* () {
        const previous = yield* SubscriptionRef.get(attention);
        const next = mateAttentionOf(chats.values(), previous, source);
        if (next !== previous) yield* SubscriptionRef.set(attention, next);
      });
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.gen(function* () {
            yield* Queue.take(wake);
            const ids = [...moved];
            moved.clear();
            const whole = wholeAgain || Option.isNone(project);
            wholeAgain = false;
            if (whole) yield* baseline;
            else for (const id of ids) yield* refresh(id);
            yield* publish;
          }),
        ),
      );

      return attention;
    }).pipe(Scope.provide(scope));
    const lock = yield* Semaphore.make(1);
    let starting: Fiber.Fiber<SubscriptionRef.SubscriptionRef<MateAttention>> | undefined;
    const started = Effect.gen(function* () {
      const fiber = yield* lock.withPermits(1)(
        Effect.suspend(() =>
          starting === undefined
            ? Effect.forkIn(start, scope).pipe(
                Effect.tap((forked) =>
                  Effect.sync(() => {
                    starting = forked;
                  }),
                ),
              )
            : Effect.succeed(starting),
        ),
      );
      const exit = yield* Fiber.await(fiber);
      if (Exit.isSuccess(exit)) return exit.value;
      if (starting === fiber) starting = undefined;
      return yield* Effect.die(Cause.squash(exit.cause));
    });

    return ZeropsMateAttention.of({
      healthCurrent: SubscriptionRef.get(health),
      healthChanges: Stream.concat(
        Stream.fromEffect(reads.healthDemand ?? Effect.void).pipe(Stream.drain),
        SubscriptionRef.changes(health).pipe(
          Stream.filter(Option.isSome),
          Stream.map((value) => value.value),
        ),
      ),
      current: Effect.flatMap(started, SubscriptionRef.get),
      changes: Stream.unwrap(Effect.map(started, SubscriptionRef.changes)),
    });
  });

export class MateEpochPersistenceError extends Schema.TaggedError<MateEpochPersistenceError>()(
  "MateEpochPersistenceError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The Mate's start epoch at '${this.path}' could not be counted.`;
  }
}

/**
 * This start's epoch: the one saved at `path` plus one (1 when none is), saved atomically before it
 * is used. A saved value that is no positive whole number is refused, never counted from 0 again: a
 * count that went back would let an older run's values order after this one's.
 */
export const nextMateEpoch = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const saved = (yield* fs.exists(path)) ? (yield* fs.readFileString(path)).trim() : null;
    if (saved !== null && !/^[1-9][0-9]*$/u.test(saved))
      return yield* Effect.fail(`no epoch in "${saved}"`);
    const epoch = saved === null ? 1 : Number(saved) + 1;
    if (!Number.isSafeInteger(epoch)) return yield* Effect.fail(`no epoch after ${saved}`);
    yield* writeFileStringAtomically({ filePath: path, contents: `${epoch}\n` });
    return epoch;
  }).pipe(Effect.mapError((cause) => new MateEpochPersistenceError({ path, cause })));

/**
 * The attention of the project at the workspace root (the threads the stand-up and every client
 * open the Mate to), from the projection and the engine's domain events; its incarnation a new id
 * and its epoch one more at every start.
 */
export const layer = Layer.effect(
  ZeropsMateAttention,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const projection = yield* ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;
    const healthDemand = yield* PubSub.unbounded<void>();
    return yield* makeZeropsMateAttention({
      environmentId: yield* (yield* ServerEnvironment).getEnvironmentId,
      epoch: yield* nextMateEpoch(config.mateEpochPath),
      incarnation: yield* (yield* Crypto.Crypto).randomUUIDv4,
      project: projection
        .getActiveProjectByWorkspaceRoot(config.cwd)
        .pipe(Effect.map(Option.map((project) => project.id))),
      threadsOf: (project) =>
        projection
          .getShellSnapshot()
          .pipe(
            Effect.map((shell) => shell.threads.filter((thread) => thread.projectId === project)),
          ),
      thread: projection.getThreadShellById,
      domainEvents: engine.streamDomainEvents,
      healthDemand: PubSub.publish(healthDemand, undefined).pipe(Effect.asVoid),
      health: resourceHealthChanges(
        config.stateDir,
        undefined,
        Stream.fromPubSub(healthDemand),
      ).pipe(
        Stream.mapEffect((evidence) =>
          Effect.map(Clock.currentTimeMillis, (ms) => ({
            sampledAt: DateTime.formatIso(DateTime.makeUnsafe(ms)),
            evidence,
          })),
        ),
      ),
    });
  }),
);
