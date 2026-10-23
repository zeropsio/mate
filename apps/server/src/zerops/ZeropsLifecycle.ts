/**
 * The lifecycle feed: where each thread's agent is, reduced from what its tools
 * already report.
 *
 * There is no lifecycle state machine here and there must not be one — the
 * `workflow.StateEnvelope` zcp computes IS the state, and this reducer only
 * carries it across. Nothing reads `.zcp/state`, and nothing calls the Zerops
 * API for lifecycle.
 *
 * Two things are recorded per thread:
 *
 * - **the latest envelope**, from every tool that carries one — through either
 *   carrier, the trailing fenced block on a prose result or the top-level
 *   `envelope` key on a JSON one (zcp `docs/spec-mate.md` §1). Latest wins; a
 *   result with no readable envelope leaves the previous one alone, and a
 *   snapshot without `devServers` keeps the last read of that service (§2.8a.3).
 * - **the recent `zerops_*` tool calls**, from ALL of them, carrier or not.
 *   The envelope says where the agent IS; it cannot say what is happening right
 *   now. A tool that has started and not finished has no result to carry an
 *   envelope, a failed one carries none by design, and the strip still has to
 *   read "deploying". A log, not a state machine.
 *
 * The envelope's `leases` are zcp's: the pool containers it holds. Which one a
 * conversation works in is the conversation's own fact, so it is not kept here:
 * a conversation's agent acquiring a lease (`zerops_lease`), releasing it, or
 * zcp no longer holding it is told to the conversation's record
 * (`recordLease`), which binds or unbinds it; and every read of the leases is
 * told to the repository source (`noteLeases`), whose mounts named after one
 * are a lease's, never a service's.
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import {
  ForwardCompatibleArray,
  ZEROPS_RECENT_TOOLS_LIMIT,
  ZeropsLease,
  ZeropsRecentTool,
  ZeropsStateEnvelope,
  type SpiEvent,
  type SpiToolCall,
  ThreadId,
  ThreadLease,
  type ZeropsLifecycle as ZeropsLifecycleState,
} from "@t3tools/contracts";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import {
  ZeropsThreadLifecycleRepository,
  type ZeropsThreadLifecycleRow,
} from "../persistence/ZeropsThreadLifecycle.ts";
import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import { extractZeropsEnvelope } from "./zeropsEnvelope.ts";
import { ZeropsLeaseRoster } from "./ZeropsRepositorySource.ts";
import { readZeropsToolCall } from "./zeropsToolResult.ts";

export class ZeropsLifecycle extends Context.Service<
  ZeropsLifecycle,
  {
    readonly get: (threadId: ThreadId) => Effect.Effect<ZeropsLifecycleState>;
    readonly subscribe: (threadId: ThreadId) => Effect.Effect<
      {
        readonly latest: ZeropsLifecycleState;
        readonly changes: Stream.Stream<ZeropsLifecycleState>;
      },
      never,
      Scope.Scope
    >;
    /**
     * Folds one provider runtime event in. The background subscription is a
     * thin adapter over this, so a caller (or a test) can drive the reducer
     * directly and know when it has settled.
     */
    readonly ingest: (event: SpiEvent) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsLifecycle") {}

const decodeEnvelope = Schema.decodeUnknownOption(ZeropsStateEnvelope);
const decodeRecentTools = Schema.decodeUnknownOption(Schema.Array(ZeropsRecentTool));
const encodeRecentTools = Schema.encodeUnknownOption(Schema.Array(ZeropsRecentTool));
const encodeEnvelope = Schema.encodeUnknownOption(ZeropsStateEnvelope);

const emptyState = (threadId: ThreadId): ZeropsLifecycleState => ({
  threadId,
  recentTools: [],
});

/**
 * Appends a tool call, or updates the entry a matching `item.started` left
 * behind so a long deploy shows as one entry that changes status rather than
 * two rows.
 */
const withRecentTool = (
  recentTools: ReadonlyArray<ZeropsRecentTool>,
  entry: ZeropsRecentTool,
): ReadonlyArray<ZeropsRecentTool> => {
  const index =
    entry.itemId === undefined
      ? -1
      : recentTools.findLastIndex((tool) => tool.itemId === entry.itemId);
  const next =
    index < 0
      ? [...recentTools, entry]
      : recentTools.map((tool, position) => (position === index ? entry : tool));
  return next.slice(-ZEROPS_RECENT_TOOLS_LIMIT);
};

/**
 * The newest envelope, with each service's last dev-server read carried over
 * where this call did not read the supervisor: absent `devServers` means "not
 * read in this call", never "none running" (zcp `docs/spec-mate.md` §2.8a.3).
 */
const withLastDevServers = (
  next: ZeropsStateEnvelope,
  previous: ZeropsStateEnvelope | undefined,
): ZeropsStateEnvelope => {
  const lastRead = new Map(
    (previous?.services ?? []).flatMap((service) =>
      service.devServers === undefined ? [] : [[service.hostname, service.devServers] as const],
    ),
  );
  if (lastRead.size === 0) return next;
  return {
    ...next,
    services: next.services.map((service) => {
      const devServers = lastRead.get(service.hostname);
      return service.devServers !== undefined || devServers === undefined
        ? service
        : { ...service, devServers };
    }),
  };
};

/**
 * The newest envelope, with the last read of zcp's leases carried over where this call did not
 * read them: absent `leases` means "not read", never "none".
 */
const withLastLeases = (
  next: ZeropsStateEnvelope,
  previous: ZeropsStateEnvelope | undefined,
): ZeropsStateEnvelope =>
  next.leases !== undefined || previous?.leases === undefined
    ? next
    : { ...next, leases: previous.leases };

/**
 * A change of a conversation's lease: the same commands the conversation's record takes
 * (`BindLease`, `UnbindLease`).
 */
export type LeaseChange =
  | { readonly _tag: "BindLease"; readonly lease: ThreadLease }
  | {
      readonly _tag: "UnbindLease";
      /** The lease its agent released. */
      readonly ended?: string;
      /** Every lease zcp still holds. */
      readonly held?: ReadonlyArray<string>;
    };

/** The tool a conversation's agent leases a pool container with. */
const LEASE_TOOL = "zerops_lease";
/** A lease in one of these states is no longer held. */
const ENDED_LEASE_STATES: ReadonlySet<string> = new Set(["released", "lost"]);

const decodeLeases = Schema.decodeUnknownOption(ForwardCompatibleArray(ZeropsLease));
const decodeThreadLease = Schema.decodeUnknownOption(ThreadLease);

/** What a set of leases says, to tell a new read from the same read again. */
const leasesKey = (leases: ReadonlyArray<ZeropsLease>): string =>
  leases
    .map((lease) => `${lease.alias}\u0000${lease.state}`)
    .toSorted()
    .join("\n");

/** A call's own `leases` beside its envelope: the leases the `zerops_lease` call acted on. */
const callLeases = (text: string): ReadonlyArray<ZeropsLease> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? Option.getOrElse(decodeLeases((parsed as { readonly leases?: unknown }).leases), () => [])
    : [];
};

const argument = (call: SpiToolCall, key: string): string | undefined => {
  const value =
    typeof call.arguments === "object" && call.arguments !== null
      ? (call.arguments as Readonly<Record<string, unknown>>)[key]
      : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/**
 * The lease an acquire took: the one its result names, else the one lease of its pool and branch
 * zcp's leases hold. None when neither says which.
 */
const acquiredLease = (
  call: SpiToolCall,
  text: string,
  read: ReadonlyArray<ZeropsLease> | undefined,
): ThreadLease | undefined => {
  const own = callLeases(text);
  const pool = argument(call, "pool");
  const branch = argument(call, "branch");
  const candidates =
    own.length === 1
      ? own
      : (read ?? []).filter(
          (lease) =>
            lease.pool === pool &&
            (branch === undefined || lease.branch === branch) &&
            !ENDED_LEASE_STATES.has(lease.state),
        );
  const [lease] = candidates;
  if (candidates.length !== 1 || lease === undefined) return undefined;
  return Option.getOrUndefined(
    decodeThreadLease({
      alias: lease.alias,
      pool: lease.pool,
      branch: lease.branch === undefined || lease.branch === "" ? null : lease.branch,
    }),
  );
};

/**
 * The lease changes one successful call says, in the order they apply: what zcp no longer holds
 * first, so a conversation whose lease is gone can take the one this call acquired.
 */
const leaseChangesOf = (
  call: SpiToolCall,
  text: string,
  read: ReadonlyArray<ZeropsLease> | undefined,
  previous: ReadonlyArray<ZeropsLease> | undefined,
): ReadonlyArray<{ readonly key: string; readonly change: LeaseChange }> => {
  const changes: Array<{ readonly key: string; readonly change: LeaseChange }> = [];
  if (read !== undefined && (previous === undefined || leasesKey(read) !== leasesKey(previous))) {
    changes.push({
      key: "held",
      change: {
        _tag: "UnbindLease",
        held: read
          .filter((lease) => !ENDED_LEASE_STATES.has(lease.state))
          .map((lease) => lease.alias),
      },
    });
  }
  if (call.name !== LEASE_TOOL) return changes;
  const action = argument(call, "action");
  const released = argument(call, "lease");
  if (action === "release" && released !== undefined) {
    changes.push({ key: "ended", change: { _tag: "UnbindLease", ended: released } });
  }
  const acquired = action === "acquire" ? acquiredLease(call, text, read) : undefined;
  if (acquired !== undefined) {
    changes.push({ key: "bind", change: { _tag: "BindLease", lease: acquired } });
  }
  return changes;
};

const INGEST_RESTART_FIRST = Duration.seconds(1);
/** The longest wait between two restarts, and the run length that counts as healthy. */
const INGEST_RESTART_CAP = Duration.seconds(30);

export interface ZeropsLifecycleOptions {
  readonly toolEvents: Stream.Stream<SpiEvent>;
  readonly repository: ZeropsThreadLifecycleRepository["Service"];
  /** The runtime wiring supplies the owner of a provider session; other threads keep their ID. */
  readonly threadOwner?: (threadId: ThreadId) => string | undefined;
  /**
   * Records a change of the lease of the conversation that owns a provider session, in that
   * conversation's own record, once per `key` (derived from the call). Absent, or for a thread
   * no conversation owns: nothing is bound.
   */
  readonly recordLease?: (
    conversation: ThreadId,
    change: LeaseChange,
    key: string,
  ) => Effect.Effect<void>;
  /** Told the aliases of every lease each read of zcp's leases names, and the last one at start. */
  readonly noteLeases?: (aliases: ReadonlyArray<string>) => Effect.Effect<void>;
}

export const make = (options: ZeropsLifecycleOptions) =>
  Effect.gen(function* () {
    const { toolEvents, repository } = options;
    const noteLeases = options.noteLeases ?? (() => Effect.void);
    const channels = yield* Ref.make(new Map<ThreadId, PubSub.PubSub<ZeropsLifecycleState>>());

    // A restart knows which mounts are leases from the last read this server kept.
    yield* repository.latestLeases.pipe(
      Effect.map(Option.flatMap(decodeLeases)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (leases) => noteLeases(leases.map((lease) => lease.alias)),
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not read the stored Zerops leases", { cause }),
      ),
    );
    const writeMutex = yield* Semaphore.make(1);
    const cache = yield* Ref.make(new Map<ThreadId, ZeropsLifecycleState>());

    /** Reads a stored row tolerantly: anything unreadable degrades to "nothing yet". */
    const fromRow = (row: ZeropsThreadLifecycleRow): ZeropsLifecycleState => ({
      threadId: row.threadId,
      ...(row.envelope === null
        ? {}
        : Option.match(decodeEnvelope(row.envelope), {
            onNone: () => ({}),
            onSome: (envelope) => ({ envelope }),
          })),
      recentTools: Option.getOrElse(
        decodeRecentTools(row.recentTools),
        () => [] as ReadonlyArray<ZeropsRecentTool>,
      ),
      updatedAt: DateTime.makeUnsafe(row.updatedAt),
    });

    /**
     * The thread's state, read from the store on first use. Only a successful
     * read is cached: a failed one says nothing about the row, so nothing may
     * be built on it.
     */
    const load = (
      threadId: ThreadId,
    ): Effect.Effect<ZeropsLifecycleState, ProjectionRepositoryError> =>
      Effect.gen(function* () {
        const cached = (yield* Ref.get(cache)).get(threadId);
        if (cached !== undefined) {
          return cached;
        }
        const stored = yield* repository.getByThreadId(threadId);
        const state = Option.match(stored, {
          onNone: () => emptyState(threadId),
          onSome: fromRow,
        });
        yield* Ref.update(cache, (current) => new Map(current).set(threadId, state));
        return state;
      });

    // A read failure is not worth propagating to a reader: the client's
    // fallback is one `zerops_workflow action="status"` call, which is the same
    // recovery path a compacted thread already takes.
    const loadOrEmpty = (threadId: ThreadId): Effect.Effect<ZeropsLifecycleState> =>
      load(threadId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not read stored Zerops lifecycle state", {
            threadId,
            cause,
          }).pipe(Effect.as(emptyState(threadId))),
        ),
      );

    /**
     * One channel per thread, so no other thread's traffic can push a thread's
     * latest state out of a subscriber's buffer. Each state is complete, so a
     * subscriber needs only the newest one it has not read yet.
     */
    const channel = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const existing = (yield* Ref.get(channels)).get(threadId);
        if (existing !== undefined) {
          return existing;
        }
        const created = yield* PubSub.sliding<ZeropsLifecycleState>(1);
        yield* Ref.update(channels, (current) => new Map(current).set(threadId, created));
        return created;
      });

    const persist = (state: ZeropsLifecycleState, at: DateTime.Utc) =>
      repository
        .upsert({
          threadId: state.threadId,
          envelope:
            state.envelope === undefined
              ? null
              : Option.getOrElse(encodeEnvelope(state.envelope), () => null),
          recentTools: Option.getOrElse(encodeRecentTools(state.recentTools), () => [] as unknown),
          updatedAt: DateTime.formatIso(at),
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not persist Zerops lifecycle state", {
              threadId: state.threadId,
              cause,
            }),
          ),
        );

    // A state folded over an unread row would be persisted over it and drop
    // its envelope, so an event that cannot be read against its thread's
    // state is dropped instead; the next one reads again. Any other failure
    // or defect in the fold drops its event the same way: one bad event must
    // not stop the ingest for every other thread.
    const fold = (event: SpiEvent) =>
      writeMutex.withPermits(1)(
        Effect.gen(function* () {
          if (event.type !== "item.started" && event.type !== "item.completed") {
            return [];
          }
          const call = readZeropsToolCall(event);
          if (call === undefined) {
            return [];
          }

          const owner = options.threadOwner?.(event.threadId);
          const threadId = ThreadId.make(owner ?? event.threadId);
          const previous = yield* load(threadId);
          const at = yield* DateTime.now;
          const resultText = call.result?.text;
          const failed = call.result?.failed === true;
          const envelope =
            resultText === undefined || failed ? undefined : extractZeropsEnvelope(resultText);

          const next: ZeropsLifecycleState = {
            threadId,
            // A result with no readable envelope leaves the previous one
            // standing. Clearing it, or reaching back to an older block, would
            // move the strip backwards over a corrupt payload.
            ...(envelope === undefined
              ? previous.envelope === undefined
                ? {}
                : { envelope: previous.envelope }
              : {
                  envelope: withLastLeases(
                    withLastDevServers(envelope, previous.envelope),
                    previous.envelope,
                  ),
                }),
            recentTools: withRecentTool(previous.recentTools, {
              toolName: call.name,
              status:
                event.type === "item.started" ? "inProgress" : failed ? "failed" : "completed",
              at,
              ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
            }),
            updatedAt: at,
          };

          yield* Ref.update(cache, (current) => new Map(current).set(next.threadId, next));
          yield* persist(next, at);
          yield* PubSub.publish(yield* channel(next.threadId), next);

          if (envelope?.leases !== undefined) {
            yield* noteLeases(envelope.leases.map((lease) => lease.alias));
          }
          // Only a conversation's own provider session binds it, and only by what a call did.
          return owner === undefined || resultText === undefined || failed
            ? []
            : leaseChangesOf(call, resultText, envelope?.leases, previous.envelope?.leases).map(
                (change) => ({
                  ...change,
                  conversation: threadId,
                  key: `lease:${event.eventId}:${change.key}`,
                }),
              );
        }),
      );

    // The lease changes an event says are told after its state is recorded,
    // outside the write mutex: a reader never waits on a conversation's record.
    const ingest = (event: SpiEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        const changes = yield* fold(event);
        for (const { conversation, change, key } of changes) {
          yield* (options.recordLease?.(conversation, change, key) ?? Effect.void).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not record a Zerops lease change", {
                threadId: conversation,
                change: change._tag,
                cause,
              }),
            ),
          );
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Dropped a Zerops lifecycle event", {
            threadId: event.threadId,
            cause,
          }),
        ),
      );

    // The ingest is the feed's only writer, so it must not end quietly: a
    // failure of the event stream itself is logged and the stream
    // resubscribed, backing off to one attempt every 30 s. A run that lasted
    // longer than that was healthy, so the failure that ended it starts the
    // backoff from the first rung again.
    yield* Effect.gen(function* () {
      let delay = INGEST_RESTART_FIRST;
      while (true) {
        const startedAt = yield* Clock.currentTimeMillis;
        const exit = yield* Effect.exit(Stream.runForEach(toolEvents, ingest));
        if (Exit.isSuccess(exit)) {
          return;
        }
        const ranFor = Duration.millis((yield* Clock.currentTimeMillis) - startedAt);
        if (Duration.isGreaterThan(ranFor, INGEST_RESTART_CAP)) {
          delay = INGEST_RESTART_FIRST;
        }
        yield* Effect.logError("Zerops lifecycle ingest failed; restarting it", {
          cause: exit.cause,
        });
        yield* Effect.sleep(delay);
        delay = Duration.min(Duration.times(delay, 2), INGEST_RESTART_CAP);
      }
    }).pipe(Effect.forkScoped);

    return {
      get: (threadId) => writeMutex.withPermits(1)(loadOrEmpty(threadId)),
      // Under the write mutex no update can land between the subscription and
      // the snapshot, so a subscriber misses nothing and sees nothing twice.
      subscribe: (threadId) =>
        writeMutex.withPermits(1)(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(yield* channel(threadId));
            const latest = yield* loadOrEmpty(threadId);
            return { latest, changes: Stream.fromSubscription(subscription) };
          }),
        ),
      ingest,
    } satisfies ZeropsLifecycle["Service"];
  });

/**
 * The feed over the provider bus. Every read of zcp's leases is told to the lease roster the
 * repository source classifies by; a lease change, to `recordLease` (the wiring's engine door).
 */
export const layer = (
  threadOwner: NonNullable<ZeropsLifecycleOptions["threadOwner"]>,
  recordLease?: ZeropsLifecycleOptions["recordLease"],
) =>
  Layer.effect(
    ZeropsLifecycle,
    Effect.gen(function* () {
      const bus = yield* ProviderRuntimeEventBus;
      const repository = yield* ZeropsThreadLifecycleRepository;
      const roster = yield* ZeropsLeaseRoster;
      return yield* make({
        toolEvents: bus.events,
        repository,
        threadOwner,
        noteLeases: roster.note,
        ...(recordLease === undefined ? {} : { recordLease }),
      });
    }),
  );
