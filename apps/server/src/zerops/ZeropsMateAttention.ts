/**
 * The Mate's attention (`@t3tools/contracts` `MateAttention`, HANDOFF §4.2 "Mate") as one value
 * with its revision, for the link up to HQ and for the Mate's own clients — one instance, so both
 * carry the same incarnation and the same revisions.
 *
 * Built from events, never by reading every chat again: the chats of the project at the workspace
 * root are read whole once, when the project is first found; after that each domain event of a chat
 * reads that chat alone. A chat that is no longer active (archived, deleted) or not the project's
 * leaves; a read that fails keeps the chat as held, and its next event reads it again.
 *
 * The incarnation is one run of this server: the revision starts at 0 with it and is never kept
 * across a restart, so a reader orders values only inside one incarnation.
 *
 * @module ZeropsMateAttention
 */
import type {
  EnvironmentId,
  MateAttention,
  OrchestrationEvent,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { mateAttentionOf } from "./zeropsAttentionValue.ts";

/** What of a domain event the attention reads: whose it is. */
export type AttentionEvent = Pick<OrchestrationEvent, "aggregateKind" | "aggregateId">;

export interface MateAttentionReads<E> {
  readonly environmentId: EnvironmentId;
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
}

export class ZeropsMateAttention extends Context.Service<
  ZeropsMateAttention,
  {
    /** The attention as it stands. */
    readonly current: Effect.Effect<MateAttention>;
    /** The attention now, then each new revision. */
    readonly changes: Stream.Stream<MateAttention>;
  }
>()("t3/zerops/ZeropsMateAttention") {}

export const makeZeropsMateAttention = <E>(
  reads: MateAttentionReads<E>,
): Effect.Effect<ZeropsMateAttention["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const source = { environmentId: reads.environmentId, incarnation: reads.incarnation };
    const chats = new Map<ThreadId, OrchestrationThreadShell>();
    let project = Option.none<ProjectId>();
    /** Finds the project and reads its chats whole; nothing while it does not exist. */
    const baseline = Effect.gen(function* () {
      const found = yield* reads.project;
      if (Option.isNone(found)) return;
      for (const thread of yield* reads.threadsOf(found.value)) chats.set(thread.id, thread);
      project = found;
    }).pipe(Effect.ignore);

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

    // Subscribed before the baseline is read (the fork runs up to its first wait at once), so no
    // event between the two is lost; one that the baseline already holds only reads its chat again.
    const events = yield* Queue.unbounded<AttentionEvent>();
    yield* Effect.forkScoped(
      Stream.runForEach(reads.domainEvents, (event) => Queue.offer(events, event)),
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
          const event = yield* Queue.take(events);
          if (Option.isNone(project)) yield* baseline;
          else if (event.aggregateKind === "thread") yield* refresh(event.aggregateId as ThreadId);
          yield* publish;
        }),
      ),
    );

    return ZeropsMateAttention.of({
      current: SubscriptionRef.get(attention),
      changes: SubscriptionRef.changes(attention),
    });
  });

/**
 * The attention of the project at the workspace root (the threads the stand-up and every client
 * open the Mate to), from the projection and the engine's domain events; its incarnation a new id
 * at every start.
 */
export const layer = Layer.effect(
  ZeropsMateAttention,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const projection = yield* ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;
    return yield* makeZeropsMateAttention({
      environmentId: yield* (yield* ServerEnvironment).getEnvironmentId,
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
    });
  }),
);
