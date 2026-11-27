/**
 * The lifecycle and Mate copy feeds, reduced from zcp's status file and tool results.
 *
 * There is no lifecycle state machine here and there must not be one — the
 * `workflow.StateEnvelope` zcp computes IS the state, and this reducer only
 * carries it across. Nothing calls the Zerops API for lifecycle.
 *
 * Two things are recorded per thread:
 *
 * - **the conversation's latest envelope**, from every tool that carries one,
 *   through either the fenced prose block or JSON `envelope` (zcp
 *   `docs/spec-mate.md` §1). A result with no readable envelope leaves it alone.
 * - **the recent `zerops_*` tool calls**, from ALL of them, carrier or not.
 *   The envelope says where the agent IS; it cannot say what is happening right
 *   now. A tool that has started and not finished has no result to carry an
 *   envelope, a failed one carries none by design, and the strip still has to
 *   read "deploying". A log, not a state machine.
 *
 * The Mate's copy record holds the lease set and classic working copies from
 * zcp's status file, plus service and dev-server observations from any tool
 * envelope. A file read replaces the lease set, while a later envelope can
 * enrich only leases still present. These are observations, not liveness; a copy's state
 * (`copyState`) is zcp's own, its one writer's, carried as written and never derived here.
 * Which lease a conversation works in is the conversation's own fact: its
 * agent acquiring a lease (`zerops_lease`) binds that
 * conversation's record (`recordLease`) — the first lease a group acquire lists,
 * and never one it says zcp already held (`reused`) — and any call that releases
 * a lease, acquires it again, or reads it no longer held unbinds every other
 * conversation bound to it (`leaseBindings`), each then bound to the
 * earliest-acquired lease of its repository and branch still held, if any — two
 * apps of one Mate both on `main` hold two groups. Every read of the
 * leases is told to the repository source (`noteLeases`), whose mounts named
 * after one are a lease's, never a service's, and every lease that changed hands
 * is told by its alias (`checkoutChanged`): its checkout may be another branch's
 * now.
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
import * as SecureRandom from "effect/crypto/SecureRandom";

import {
  isZeropsLeaseHeld,
  ZEROPS_RECENT_TOOLS_LIMIT,
  ZeropsConversationEnvelope,
  ZeropsLease,
  ZeropsMateCopies,
  ZeropsRecentTool,
  type ZeropsCopyStatus,
  type ZeropsServiceSnapshot,
  type SpiEvent,
  ThreadId,
  type ZeropsLifecycle as ZeropsLifecycleState,
} from "@t3tools/contracts";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import {
  ZeropsThreadLifecycleRepository,
  type ZeropsThreadLifecycleRow,
} from "../persistence/ZeropsThreadLifecycle.ts";
import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import {
  checkedRead,
  leaseChangesFor,
  leaseFactsOf,
  leasesKey,
  renewedLeases,
  type CheckedRead,
  type LeaseBinding,
  type LeaseChange,
  type LeaseFacts,
} from "./lease/leaseBinding.ts";
import { extractZeropsEnvelope } from "./zeropsEnvelope.ts";
import { ZeropsLeaseRoster } from "./ZeropsRepositorySource.ts";
import { ZeropsSetup } from "./ZeropsSetup.ts";
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
    readonly copies: Effect.Effect<ZeropsMateCopies>;
    readonly subscribeCopies: Effect.Effect<
      { readonly latest: ZeropsMateCopies; readonly changes: Stream.Stream<ZeropsMateCopies> },
      never,
      Scope.Scope
    >;
    /**
     * Folds one provider runtime event in. The background subscription is a
     * thin adapter over this, so a caller (or a test) can drive the reducer
     * directly and know when it has settled.
     */
    readonly ingest: (event: SpiEvent) => Effect.Effect<void>;
    /** Settles a status-file observation, including its conversation binding changes. */
    readonly ingestCopies: (status: ZeropsCopyStatus | undefined) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsLifecycle") {}

const decodeEnvelope = Schema.decodeUnknownOption(ZeropsConversationEnvelope);
const decodeRecentTools = Schema.decodeUnknownOption(Schema.Array(ZeropsRecentTool));
const encodeRecentTools = Schema.encodeUnknownOption(Schema.Array(ZeropsRecentTool));
const encodeEnvelope = Schema.encodeUnknownOption(ZeropsConversationEnvelope);
const decodeCopies = Schema.decodeUnknownOption(ZeropsMateCopies);
const encodeCopies = Schema.encodeUnknownOption(ZeropsMateCopies);
const sameCopies = (a: ZeropsMateCopies, b: ZeropsMateCopies): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

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
  next: ReadonlyArray<ZeropsServiceSnapshot>,
  previous: ReadonlyArray<ZeropsServiceSnapshot> | undefined,
): ReadonlyArray<ZeropsServiceSnapshot> => {
  const lastRead = new Map(
    (previous ?? []).flatMap((service) =>
      service.devServers === undefined ? [] : [[service.hostname, service.devServers] as const],
    ),
  );
  if (lastRead.size === 0) return next;
  return next.map((service) => {
    const devServers = lastRead.get(service.hostname);
    return service.devServers !== undefined || devServers === undefined
      ? service
      : { ...service, devServers };
  });
};

/** Whether zcp read the lease's checkout for this activity: one with no `readAt` says only why not. */
const readCheckout = (activity: ZeropsLease["activity"]): boolean => activity?.readAt !== undefined;

const stampMs = (at: string | undefined): number => {
  const parsed = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

/** A copy's state as zcp's status file wrote it, under the name the Mate's copies give it. */
const copyStateOf = (
  state: string | undefined,
  stateAt: string | undefined,
): Pick<ZeropsLease, "copyState" | "copyStateAt"> => ({
  ...(state === undefined ? {} : { copyState: state }),
  ...(stateAt === undefined ? {} : { copyStateAt: stateAt }),
});

/**
 * The newer of two reads of a lease's dev servers: this call's where it read them and the last
 * read did not, the last where this call did not; where both did, the one zcp stamped later
 * (`devServersReadAt`), one with no stamp older than one with it, and this call's on a tie.
 */
const newerServersRead = (
  lease: ZeropsLease,
  last: ZeropsLease,
): Pick<ZeropsLease, "devServers" | "devServersReadAt"> => {
  const take = (from: ZeropsLease) => ({
    devServers: from.devServers,
    devServersReadAt: from.devServersReadAt,
  });
  if (lease.devServers === undefined) return take(last);
  if (last.devServers === undefined) return take(lease);
  return stampMs(last.devServersReadAt) > stampMs(lease.devServersReadAt)
    ? take(last)
    : take(lease);
};

/**
 * What a lease keeps of its last read where this call did not read it: the dev servers last read
 * on it where this call did not read its supervisor (only a `zerops_dev_server` call for its alias
 * does), or where the read this call carries is older (`newerServersRead`), and what zcp last read of its checkout — its activity and unsaved work — where this call
 * did not (only `zerops_lease action=status` does; one that could not read a lease says why and
 * clears nothing). A read of the checkout is one whole: a newer one replaces both, so unsaved work
 * it could not read is not known rather than an older read's beside newer activity. Every read is
 * the same lease's only: the alias acquired at another time is another lease, which keeps none.
 */
const withLastRead = (lease: ZeropsLease, last: ZeropsLease): ZeropsLease => {
  if (lease.acquiredAt !== last.acquiredAt) return lease;
  const servers = newerServersRead(lease, last);
  const devServers = servers.devServers;
  const newer = readCheckout(lease.activity);
  const activity = newer
    ? lease.activity
    : readCheckout(last.activity)
      ? last.activity
      : (lease.activity ?? last.activity);
  const unsaved = newer ? lease.unsaved : (lease.unsaved ?? last.unsaved);
  // Only zcp's status file carries a copy's state; an envelope's read of the same lease keeps it.
  const copyState =
    lease.copyState === undefined ? copyStateOf(last.copyState, last.copyStateAt) : {};
  return {
    ...lease,
    ...copyState,
    ...(devServers === undefined ? {} : { devServers }),
    ...(servers.devServersReadAt === undefined
      ? {}
      : { devServersReadAt: servers.devServersReadAt }),
    ...(activity === undefined ? {} : { activity }),
    ...(unsaved === undefined ? {} : { unsaved }),
  };
};

/**
 * zcp's leases as a call read them, with the last read of them carried over: a lease still held
 * keeps what was last read of it where this call did not read it (`withLastRead`); a lease that
 * ended, or is gone from the read, keeps none.
 */
const withLastLeases = (
  read: ReadonlyArray<ZeropsLease>,
  last: ReadonlyArray<ZeropsLease> | undefined,
): ReadonlyArray<ZeropsLease> => {
  const lastRead = new Map((last ?? []).map((lease) => [lease.alias, lease] as const));
  if (lastRead.size === 0) return read;
  return read.map((lease) => {
    const before = lastRead.get(lease.alias);
    return before === undefined || !isZeropsLeaseHeld(lease.state)
      ? lease
      : withLastRead(lease, before);
  });
};

/** The conversations bound to a lease now, and whether every conversation's record was read. */
export interface LeaseBindings {
  readonly bindings: ReadonlyArray<LeaseBinding>;
  /** False when a record could not be read: what it holds is not known, never none. */
  readonly complete: boolean;
}

const INGEST_RESTART_FIRST = Duration.seconds(1);
/** The longest wait between two restarts, and the run length that counts as healthy. */
const INGEST_RESTART_CAP = Duration.seconds(30);

export interface ZeropsLifecycleOptions {
  readonly toolEvents: Stream.Stream<SpiEvent>;
  readonly repository: ZeropsThreadLifecycleRepository["Service"];
  /** zcp's status file, read once after arming its watch and again when it changes. */
  readonly copyChanges?: Stream.Stream<ZeropsCopyStatus | undefined>;
  /** The current file, synchronized with a completed tool before its lease effects apply. */
  readonly readCopies?: Effect.Effect<ZeropsCopyStatus | undefined>;
  /** The runtime wiring supplies the owner of a provider session; other threads keep their ID. */
  readonly threadOwner?: (threadId: ThreadId) => string | undefined;
  /**
   * The conversations bound to a lease now, as their records hold them: whom a release, an acquire
   * or a read of zcp's leases unbinds. A read checked against bindings not all read is checked
   * again by the next read, however alike. Absent: none is bound.
   */
  readonly leaseBindings?: Effect.Effect<LeaseBindings>;
  /**
   * Records a change of a conversation's lease in that conversation's own record, once per `key`
   * (derived from the call and the conversation). Absent: nothing is bound. Only the conversation
   * that owns the provider session an acquire ran in is bound by it.
   */
  readonly recordLease?: (
    conversation: ThreadId,
    change: LeaseChange,
    key: string,
  ) => Effect.Effect<void>;
  /** Told the aliases of every lease each read of zcp's leases names, and the last one at start. */
  readonly noteLeases?: (aliases: ReadonlyArray<string>) => Effect.Effect<void>;
  /**
   * Told the alias of every lease a call released, acquired or read ended, once its conversations'
   * records are told: a pool hands a container on under the same alias, so the checkout at
   * `/var/www/<alias>` may be another branch's now, and nothing read of it before may be served.
   */
  readonly checkoutChanged?: (alias: string) => Effect.Effect<void>;
}

export const make = (options: ZeropsLifecycleOptions) =>
  Effect.gen(function* () {
    const { toolEvents, repository } = options;
    const noteLeases = options.noteLeases ?? (() => Effect.void);
    const channels = yield* Ref.make(new Map<ThreadId, PubSub.PubSub<ZeropsLifecycleState>>());
    // The last read of zcp's leases the bindings were checked against: one set for every
    // conversation, so a read that says nothing new unbinds nothing.
    const checked = yield* Ref.make<CheckedRead | undefined>(undefined);
    // zcp's leases as the latest call read them, whichever thread's, with what was last read of each
    // carried over: every thread's views read these, never a copy its own last call left.
    const shared = yield* Ref.make<ZeropsMateCopies>({});
    const copiesChannel = yield* PubSub.sliding<ZeropsMateCopies>(1);
    const statusHasLeases = yield* Ref.make(false);
    const random = yield* SecureRandom.SecureRandom.pipe(
      Effect.provide(SecureRandom.layerWebCrypto),
    );

    // A restart knows which mounts are leases from the last read this server kept, and which lease
    // each alias was then: its first read is checked whole against it.
    yield* repository.mateCopies.pipe(
      Effect.map(Option.flatMap(decodeCopies)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (copies) =>
            Effect.all([
              Ref.set(
                checked,
                copies.leases === undefined ? undefined : checkedRead(copies.leases, undefined),
              ),
              Ref.set(shared, copies),
              noteLeases((copies.leases ?? []).map((lease) => lease.alias)),
            ]),
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not read the stored Zerops leases", { cause }),
      ),
    );
    const writeMutex = yield* Semaphore.make(1);
    // The status-file watch and provider events share one writer, including their
    // effects on conversation bindings, so an older release cannot unbind a new lease.
    const ingestMutex = yield* Semaphore.make(1);
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

    const publishCopies = (before: ZeropsMateCopies, next: ZeropsMateCopies) =>
      Effect.gen(function* () {
        if (sameCopies(before, next)) return;
        yield* repository
          .putMateCopies(Option.getOrElse(encodeCopies(next), () => ({})))
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not persist Mate copies", { cause }),
            ),
          );
        yield* Ref.set(shared, next);
        yield* PubSub.publish(copiesChannel, next);
      });

    // A state folded over an unread row would be persisted over it and drop
    // its envelope, so an event that cannot be read against its thread's
    // state is dropped instead; the next one reads again. Any other failure
    // or defect in the fold drops its event the same way: one bad event must
    // not stop the ingest for every other thread.
    const fold = (event: SpiEvent) =>
      writeMutex.withPermits(1)(
        Effect.gen(function* () {
          if (event.type !== "item.started" && event.type !== "item.completed") {
            return undefined;
          }
          const call = readZeropsToolCall(event);
          if (call === undefined) {
            return undefined;
          }

          const owner = options.threadOwner?.(event.threadId);
          const threadId = ThreadId.make(owner ?? event.threadId);
          const previous = yield* load(threadId);
          const at = yield* DateTime.now;
          const resultText = call.result?.text;
          const failed = call.result?.failed === true;
          const envelope =
            resultText === undefined || failed ? undefined : extractZeropsEnvelope(resultText);
          const sharedBefore = yield* Ref.get(shared);
          const statusOwnsLeases = yield* Ref.get(statusHasLeases);
          let leases = sharedBefore.leases;
          if (envelope?.leases !== undefined) {
            if (statusOwnsLeases) {
              // A tool result may arrive after a release written outside the call.
              // It can enrich an existing lease, but cannot add one back.
              leases = (leases ?? []).map((lease) => {
                const read = envelope.leases?.find(
                  (item) =>
                    item.alias === lease.alias &&
                    item.acquiredAt === lease.acquiredAt &&
                    item.branch === lease.branch,
                );
                return read === undefined
                  ? lease
                  : withLastRead(
                      {
                        ...lease,
                        ...read,
                        alias: lease.alias,
                        pool: lease.pool,
                        branch: lease.branch,
                        repo: lease.repo,
                        containerHostname: lease.containerHostname,
                        acquiredAt: lease.acquiredAt,
                        state: isZeropsLeaseHeld(read.state) ? read.state : lease.state,
                      },
                      lease,
                    );
              });
            } else {
              leases = withLastLeases(envelope.leases, leases);
            }
          }
          if (envelope !== undefined) {
            yield* publishCopies(sharedBefore, {
              ...sharedBefore,
              ...(leases === undefined ? {} : { leases }),
              services: withLastDevServers(envelope.services, sharedBefore.services),
            });
          }

          const next: ZeropsLifecycleState = {
            threadId,
            // A result with no readable envelope leaves the previous one
            // standing. Clearing it, or reaching back to an older block, would
            // move the strip backwards over a corrupt payload.
            ...(envelope === undefined
              ? previous.envelope === undefined
                ? {}
                : { envelope: previous.envelope }
              : Option.match(decodeEnvelope(envelope), {
                  onNone: () =>
                    previous.envelope === undefined ? {} : { envelope: previous.envelope },
                  onSome: (conversationEnvelope) => ({ envelope: conversationEnvelope }),
                })),
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
          let readChanged = false;
          let renewed: ReadonlyArray<string> = [];
          let checkpoint: CheckedRead | undefined;
          if (envelope?.leases !== undefined && !statusOwnsLeases) {
            yield* noteLeases(envelope.leases.map((lease) => lease.alias));
            const key = leasesKey(envelope.leases);
            const prior = yield* Ref.get(checked);
            readChanged = prior?.key !== key;
            renewed = renewedLeases(envelope.leases, prior);
            checkpoint = checkedRead(envelope.leases, key);
          }
          // Only what a successful call did or read; any thread's, since zcp's leases are shared.
          return resultText === undefined || failed
            ? undefined
            : leaseFactsOf(
                call,
                resultText,
                statusOwnsLeases ? undefined : envelope?.leases,
                readChanged,
                renewed,
                checkpoint,
                owner === undefined ? undefined : threadId,
              );
        }),
      );

    // The lease changes an event says are told after its state is recorded,
    // outside the write mutex: a reader never waits on a conversation's record.
    const applyFacts = (facts: LeaseFacts | undefined, source: string) =>
      Effect.gen(function* () {
        if (
          facts === undefined ||
          (facts.held === undefined &&
            facts.released.length === 0 &&
            facts.renewed.length === 0 &&
            facts.acquired === undefined)
        ) {
          return;
        }
        const { bindings, complete } = yield* (
          options.leaseBindings ?? Effect.succeed<LeaseBindings>({ bindings: [], complete: true })
        );
        const changes = leaseChangesFor(facts, bindings);
        for (const { conversation, change } of changes) {
          const key =
            change._tag === "BindLease"
              ? `lease:${source}:bind`
              : `lease:${source}:unbind:${conversation}`;
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
        // A conversation whose record was not read is checked again by the next read.
        if (complete && facts.checkpoint !== undefined) yield* Ref.set(checked, facts.checkpoint);
        const changedCheckouts = new Set([
          ...facts.released,
          ...facts.renewed,
          ...(facts.acquired?.aliases ?? []),
          ...changes.flatMap(({ change }) => (change._tag === "UnbindLease" ? [change.ended] : [])),
        ]);
        for (const alias of changedCheckouts) {
          yield* (options.checkoutChanged?.(alias) ?? Effect.void).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not forget a lease's checkout", { alias, cause }),
            ),
          );
        }
      });

    const applyCopies = (status: ZeropsCopyStatus | undefined) =>
      Effect.gen(function* () {
        if (status === undefined) return;
        const facts = yield* writeMutex.withPermits(1)(
          Effect.gen(function* () {
            const before = yield* Ref.get(shared);
            let leases = before.leases;
            let facts: LeaseFacts | undefined;
            if (status.leases !== null) {
              yield* Ref.set(statusHasLeases, true);
              leases = status.leases.map(({ state, stateAt, ...read }): ZeropsLease => {
                // The file's `state` is the copy's, not the lease's (zcp spec-mate §1.0a).
                const lease = { ...read, ...copyStateOf(state, stateAt) };
                const last = before.leases?.find(
                  (old) =>
                    old.alias === lease.alias &&
                    old.acquiredAt === lease.acquiredAt &&
                    old.branch === lease.branch &&
                    old.containerHostname === lease.containerHostname &&
                    isZeropsLeaseHeld(old.state),
                );
                return last === undefined
                  ? { ...lease, state: "held" }
                  : withLastRead({ ...last, ...lease }, last);
              });
              yield* noteLeases(leases.map((lease) => lease.alias));
              const prior = yield* Ref.get(checked);
              const key = leasesKey(leases);
              facts = {
                ...(prior?.key === key ? {} : { held: leases.map((lease) => lease.alias) }),
                read: leases,
                released: [],
                renewed: renewedLeases(leases, prior),
                checkpoint: checkedRead(leases, key),
              };
            }
            yield* publishCopies(before, {
              ...before,
              ...(leases === undefined ? {} : { leases }),
              ...(status.devServices === null
                ? {}
                : {
                    devServices: status.devServices.map(({ state, stateAt, ...read }) => ({
                      ...read,
                      ...copyStateOf(state, stateAt),
                    })),
                  }),
            });
            return facts;
          }),
        );
        // Each file observation has its own command identity, even when two
        // changes have the same second-resolution status timestamp.
        yield* applyFacts(facts, `status:${yield* random.uuidV4()}`);
      });

    const ingestCopies = (status: ZeropsCopyStatus | undefined) =>
      ingestMutex
        .withPermits(1)(applyCopies(status))
        .pipe(
          Effect.catchCause((cause) => Effect.logWarning("Dropped a copy status read", { cause })),
        );

    const ingest = (event: SpiEvent): Effect.Effect<void> =>
      ingestMutex
        .withPermits(1)(
          Effect.gen(function* () {
            // zcp writes the file before returning a tool result, but the file watch
            // and provider stream can be delivered in either order.
            if (
              event.type === "item.completed" &&
              readZeropsToolCall(event) !== undefined &&
              options.readCopies !== undefined
            ) {
              yield* applyCopies(yield* options.readCopies);
            }
            const facts = yield* fold(event);
            if (facts === undefined || !(yield* Ref.get(statusHasLeases))) {
              yield* applyFacts(facts, event.eventId);
              return;
            }
            const held = (yield* Ref.get(shared)).leases ?? [];
            const acquired = facts.acquired;
            const ownsAcquisition =
              acquired !== undefined &&
              acquired.lease.acquiredAt !== undefined &&
              held.some(
                (lease) =>
                  lease.alias === acquired.lease.alias &&
                  lease.acquiredAt === acquired.lease.acquiredAt &&
                  lease.branch === acquired.lease.branch,
              );
            const { acquired: _acquired, ...otherFacts } = facts;
            yield* applyFacts(
              {
                ...otherFacts,
                released: facts.released.filter(
                  (alias) => !held.some((lease) => lease.alias === alias),
                ),
                ...(ownsAcquisition && acquired !== undefined ? { acquired } : {}),
              },
              event.eventId,
            );
          }),
        )
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Dropped a Zerops lifecycle event", {
              threadId: event.threadId,
              cause,
            }),
          ),
        );

    if (options.copyChanges !== undefined) {
      yield* Stream.runForEach(options.copyChanges, ingestCopies).pipe(Effect.forkScoped);
    }

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

    const view = (threadId: ThreadId) => loadOrEmpty(threadId);

    return {
      get: (threadId) => writeMutex.withPermits(1)(view(threadId)),
      // Under the write mutex no update can land between the subscription and
      // the snapshot, so a subscriber misses nothing and sees nothing twice.
      subscribe: (threadId) =>
        writeMutex.withPermits(1)(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(yield* channel(threadId));
            const latest = yield* view(threadId);
            return { latest, changes: Stream.fromSubscription(subscription) };
          }),
        ),
      copies: Ref.get(shared),
      subscribeCopies: writeMutex.withPermits(1)(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(copiesChannel);
          const latest = yield* Ref.get(shared);
          return { latest, changes: Stream.fromSubscription(subscription) };
        }),
      ),
      ingest,
      ingestCopies,
    } satisfies ZeropsLifecycle["Service"];
  });

/**
 * The feed over the provider bus. Every read of zcp's leases is told to the lease roster the
 * repository source classifies by; a lease change, to `recordLease` (the wiring's engine door),
 * for the conversations `leaseBindings` reads bound, and then to `checkoutChanged` by its alias.
 */
export const layer = (
  threadOwner: NonNullable<ZeropsLifecycleOptions["threadOwner"]>,
  leases?: Pick<ZeropsLifecycleOptions, "leaseBindings" | "recordLease" | "checkoutChanged">,
) =>
  Layer.effect(
    ZeropsLifecycle,
    Effect.gen(function* () {
      const bus = yield* ProviderRuntimeEventBus;
      const repository = yield* ZeropsThreadLifecycleRepository;
      const roster = yield* ZeropsLeaseRoster;
      const setup = yield* ZeropsSetup;
      const copyChanges = Stream.unwrap(
        Effect.map(setup.statusChanges, (watch) => {
          const read = Effect.map(setup.status, (status) => status?.copies);
          return Stream.concat(
            Stream.fromEffect(read),
            Stream.fromEffectRepeat(Effect.andThen(watch.next, read)),
          );
        }),
      ).pipe(Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)));
      return yield* make({
        toolEvents: bus.events,
        repository,
        threadOwner,
        noteLeases: roster.note,
        copyChanges,
        readCopies: Effect.map(setup.status, (status) => status?.copies),
        ...leases,
      });
    }),
  );
