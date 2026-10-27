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
 *   result with no readable envelope leaves the previous one alone, a snapshot
 *   without `devServers` keeps the last read of that service, and a lease still
 *   held keeps its last read dev servers, activity and unsaved work (§2.8a.3).
 * - **the recent `zerops_*` tool calls**, from ALL of them, carrier or not.
 *   The envelope says where the agent IS; it cannot say what is happening right
 *   now. A tool that has started and not finished has no result to carry an
 *   envelope, a failed one carries none by design, and the strip still has to
 *   read "deploying". A log, not a state machine.
 *
 * The envelope's `leases` are zcp's: the pool containers it holds, one set for
 * every conversation (zcp keeps it in the shared working directory), so every
 * thread's envelope carries them as the latest call read them, whichever thread
 * made it, and a read that changed them is told to every thread watching. Which one a
 * conversation works in is the conversation's own fact, so it is not kept here:
 * a conversation's agent acquiring a lease (`zerops_lease`) binds that
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

import {
  ForwardCompatibleArray,
  isZeropsLeaseHeld,
  sameZeropsLeaseGroup,
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

/** Whether zcp read the lease's checkout for this activity: one with no `readAt` says only why not. */
const readCheckout = (activity: ZeropsLease["activity"]): boolean => activity?.readAt !== undefined;

const stampMs = (at: string | undefined): number => {
  const parsed = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

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
  return {
    ...lease,
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

/** Whether two reads of zcp's leases say the same, what was last read of each lease included. */
const sameLeases = (
  left: ReadonlyArray<ZeropsLease> | undefined,
  right: ReadonlyArray<ZeropsLease> | undefined,
): boolean => left === right || JSON.stringify(left) === JSON.stringify(right);

/**
 * A thread's state as its views read it: its envelope with zcp's leases as the latest call read
 * them, whichever thread made it, since zcp keeps one set for every conversation. None read yet:
 * the thread's own.
 */
const withSharedLeases = (
  state: ZeropsLifecycleState,
  leases: ReadonlyArray<ZeropsLease> | undefined,
): ZeropsLifecycleState =>
  state.envelope === undefined || leases === undefined || state.envelope.leases === leases
    ? state
    : { ...state, envelope: { ...state.envelope, leases } };

/**
 * A change of a conversation's lease: the same commands the conversation's record takes
 * (`BindLease`, `UnbindLease`).
 */
export type LeaseChange =
  | { readonly _tag: "BindLease"; readonly lease: ThreadLease }
  /** The lease the conversation is bound to ended: released, lost, gone, or taken again. */
  | { readonly _tag: "UnbindLease"; readonly ended: string };

/** A conversation bound to a lease, as its record holds it. */
export interface LeaseBinding {
  readonly conversation: ThreadId;
  readonly alias: string;
  /**
   * The lease's branch (null: none) and repository (none where zcp named none): the group whose
   * other leases the conversation is bound to next.
   */
  readonly branch: string | null;
  readonly repo: string | undefined;
  /**
   * When zcp acquired the lease bound (`ThreadLease.acquiredAt`): a read of its alias acquired at
   * another time is another lease. None in a binding recorded before it was kept: such a binding
   * is checked against the last read every binding was checked against (`renewed`).
   */
  readonly acquiredAt: string | undefined;
}

/** The conversations bound to a lease now, and whether every conversation's record was read. */
export interface LeaseBindings {
  readonly bindings: ReadonlyArray<LeaseBinding>;
  /** False when a record could not be read: what it holds is not known, never none. */
  readonly complete: boolean;
}

/** The tool a conversation's agent leases a pool container with. */
const LEASE_TOOL = "zerops_lease";

const decodeLeases = Schema.decodeUnknownOption(ForwardCompatibleArray(ZeropsLease));
/**
 * A lease a `zerops_lease` call's own result lists: the envelope's, and whether an acquire returned
 * the lease zcp already held for its repository, branch and pool (zcp `docs/spec-workflows.md` §8
 * DP-17) — another conversation's acquire, which moves no binding.
 */
const ZeropsLeaseResult = Schema.Struct({
  ...ZeropsLease.fields,
  reused: Schema.optional(Schema.Boolean),
});
type ZeropsLeaseResult = typeof ZeropsLeaseResult.Type;
const decodeResultLeases = Schema.decodeUnknownOption(ForwardCompatibleArray(ZeropsLeaseResult));
const decodeThreadLease = Schema.decodeUnknownOption(ThreadLease);

/**
 * What a set of leases says, to tell a new read from the same read again: a lease is its alias, its
 * state and when zcp acquired it, since a pool hands a released container out again under the same
 * alias.
 */
const leasesKey = (leases: ReadonlyArray<ZeropsLease>): string =>
  leases
    .map((lease) => `${lease.alias}\u0000${lease.state}\u0000${lease.acquiredAt ?? ""}`)
    .toSorted()
    .join("\n");

/** A read of zcp's leases the conversations' bindings were checked against. */
interface CheckedRead {
  /** The read's `leasesKey`; none for a read only kept from before a restart, checked whole again. */
  readonly key: string | undefined;
  /** When zcp acquired each lease the read named, by alias. */
  readonly acquiredAt: ReadonlyMap<string, string>;
}

const checkedRead = (leases: ReadonlyArray<ZeropsLease>, key: string | undefined): CheckedRead => ({
  key,
  acquiredAt: new Map(
    leases.flatMap((lease) =>
      lease.acquiredAt === undefined ? [] : [[lease.alias, lease.acquiredAt] as const],
    ),
  ),
});

/**
 * The leases a read names held under an alias the checked read named acquired at another time: other
 * leases than the ones bound under it, handed out again while no call of this server read them.
 */
const renewedLeases = (
  read: ReadonlyArray<ZeropsLease>,
  checked: CheckedRead | undefined,
): ReadonlyArray<string> =>
  read.flatMap((lease) => {
    const before = checked?.acquiredAt.get(lease.alias);
    return isZeropsLeaseHeld(lease.state) &&
      lease.acquiredAt !== undefined &&
      before !== undefined &&
      before !== lease.acquiredAt
      ? [lease.alias]
      : [];
  });

/** A call's own `leases` beside its envelope: the leases the `zerops_lease` call acted on. */
const callLeases = (text: string): ReadonlyArray<ZeropsLeaseResult> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? Option.getOrElse(
        decodeResultLeases((parsed as { readonly leases?: unknown }).leases),
        () => [],
      )
    : [];
};

const argument = (call: SpiToolCall, key: string): string | undefined => {
  const value =
    typeof call.arguments === "object" && call.arguments !== null
      ? (call.arguments as Readonly<Record<string, unknown>>)[key]
      : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/** A lease as a conversation's record binds it; none when it cannot be one. */
const threadLeaseOf = (lease: ZeropsLease): ThreadLease | undefined =>
  Option.getOrUndefined(
    decodeThreadLease({
      alias: lease.alias,
      pool: lease.pool,
      branch: lease.branch === undefined || lease.branch === "" ? null : lease.branch,
      ...(lease.repo === undefined || lease.repo === "" ? {} : { repo: lease.repo }),
      ...(lease.acquiredAt === undefined || lease.acquiredAt === ""
        ? {}
        : { acquiredAt: lease.acquiredAt }),
    }),
  );

/**
 * What an acquire leased: every lease its result lists but the ones zcp already held (`reused`),
 * the first of which binds its conversation — a group acquire lists its leases in its pools' order.
 * A result that lists none of its own leased the one lease of its pool and branch zcp's leases
 * hold. None when it leased nothing, or nothing says which.
 */
const acquiredLeases = (
  call: SpiToolCall,
  text: string,
  read: ReadonlyArray<ZeropsLease> | undefined,
): { readonly lease: ThreadLease; readonly aliases: ReadonlyArray<string> } | undefined => {
  const own = callLeases(text);
  const pool = argument(call, "pool");
  const branch = argument(call, "branch");
  const leased =
    own.length > 0
      ? own.filter((lease) => lease.reused !== true)
      : (read ?? []).filter(
          (lease) =>
            lease.pool === pool &&
            (branch === undefined || lease.branch === branch) &&
            isZeropsLeaseHeld(lease.state),
        );
  const [first] = leased;
  if (first === undefined || (own.length === 0 && leased.length !== 1)) return undefined;
  const lease = threadLeaseOf(first);
  return lease === undefined ? undefined : { lease, aliases: leased.map(({ alias }) => alias) };
};

/** When zcp acquired a lease, in ms; one with no time it says is acquired after every other. */
const acquiredAtMs = (lease: ZeropsLease): number => {
  const at = lease.acquiredAt === undefined ? Number.NaN : Date.parse(lease.acquiredAt);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
};

/**
 * What one successful call says of zcp's leases, whoever made it: zcp keeps one set of leases for
 * every conversation (its state is in the shared working directory), so a release, an acquire or
 * a read by one conversation speaks for the leases every other one is bound to.
 */
interface LeaseFacts {
  /** The leases zcp holds, when this call read them and the read differs from the last one. */
  readonly held?: ReadonlyArray<string>;
  /** zcp's leases as this call read them: where a conversation whose lease ended is bound next. */
  readonly read?: ReadonlyArray<ZeropsLease>;
  /** The leases this call released: the one it names, and each its result says it released. */
  readonly released: ReadonlyArray<string>;
  /**
   * The leases this call read held under an alias the last checked read had of another lease: what
   * says a binding that keeps no `acquiredAt` ended.
   */
  readonly renewed: ReadonlyArray<string>;
  /** This call's read, to check the next one against once every binding was checked against it. */
  readonly checkpoint?: CheckedRead;
  /**
   * The leases this call acquired (`aliases`, never one zcp already held), the one of them its
   * conversation is bound to (`lease`), and that conversation (none: no conversation).
   */
  readonly acquired?: {
    readonly lease: ThreadLease;
    readonly aliases: ReadonlyArray<string>;
    readonly by: ThreadId | undefined;
  };
}

const leaseFactsOf = (
  call: SpiToolCall,
  text: string,
  read: ReadonlyArray<ZeropsLease> | undefined,
  readChanged: boolean,
  renewed: ReadonlyArray<string>,
  checkpoint: CheckedRead | undefined,
  owner: ThreadId | undefined,
): LeaseFacts => {
  const held =
    read !== undefined && readChanged
      ? read.filter((lease) => isZeropsLeaseHeld(lease.state)).map((lease) => lease.alias)
      : undefined;
  const action = call.name === LEASE_TOOL ? argument(call, "action") : undefined;
  const named = argument(call, "lease");
  // A release of a branch names no lease: its result lists each it released.
  const released =
    action === "release"
      ? [
          ...new Set([
            ...(named === undefined ? [] : [named]),
            ...callLeases(text)
              .filter((lease) => !isZeropsLeaseHeld(lease.state))
              .map((lease) => lease.alias),
          ]),
        ]
      : [];
  const acquired = action === "acquire" ? acquiredLeases(call, text, read) : undefined;
  return {
    ...(held === undefined ? {} : { held }),
    ...(read === undefined ? {} : { read }),
    released,
    renewed,
    ...(checkpoint === undefined ? {} : { checkpoint }),
    ...(acquired === undefined ? {} : { acquired: { ...acquired, by: owner } }),
  };
};

/**
 * The lease changes the facts say to the conversations bound now, in the order they apply: every
 * conversation whose lease ended is unbound first — released, no longer held, acquired again by
 * another, or read under its alias acquired at another time (a pool hands a released container out
 * again under the same alias, so the alias alone never says whose lease it is: the binding is the
 * conversation's that acquired it) — then each is
 * bound to the earliest-acquired lease of its repository and branch this call read still held, if
 * any (a branch spanning several app parts holds one lease per part's pool, and its conversation
 * goes on showing the others; another app's lease of the same branch is another group), never one
 * another conversation acquired in this call; then the
 * conversation that acquired one is bound, which takes it only while it has no lease, and which
 * its own acquire binds rather than its branch's.
 */
const leaseChangesFor = (
  facts: LeaseFacts,
  bindings: ReadonlyArray<LeaseBinding>,
): ReadonlyArray<{ readonly conversation: ThreadId; readonly change: LeaseChange }> => {
  const { acquired } = facts;
  const acquiredByAnother = (alias: string, conversation: ThreadId) =>
    acquired !== undefined && acquired.aliases.includes(alias) && conversation !== acquired.by;
  // Against the binding's own lease where it keeps when zcp acquired it: the last checked read
  // stays behind while a record cannot be read, and would take the alias's new holder for another
  // lease than its own.
  const renewed = ({ alias, acquiredAt }: LeaseBinding) => {
    if (acquiredAt === undefined) return facts.renewed.includes(alias);
    const now = facts.read?.find((lease) => lease.alias === alias);
    return (
      now !== undefined &&
      isZeropsLeaseHeld(now.state) &&
      now.acquiredAt !== undefined &&
      now.acquiredAt !== acquiredAt
    );
  };
  const ended = bindings.filter(
    (binding) =>
      facts.released.includes(binding.alias) ||
      (facts.held !== undefined && !facts.held.includes(binding.alias)) ||
      renewed(binding) ||
      acquiredByAnother(binding.alias, binding.conversation),
  );
  const boundNext = (binding: LeaseBinding): ThreadLease | undefined => {
    if (acquired !== undefined && binding.conversation === acquired.by) return undefined;
    const earliest = (facts.read ?? [])
      .filter(
        (lease) =>
          lease.alias !== binding.alias &&
          isZeropsLeaseHeld(lease.state) &&
          sameZeropsLeaseGroup(binding, lease) &&
          !facts.released.includes(lease.alias) &&
          !acquiredByAnother(lease.alias, binding.conversation),
      )
      .reduce<ZeropsLease | undefined>(
        (best, lease) =>
          best === undefined || acquiredAtMs(lease) < acquiredAtMs(best) ? lease : best,
        undefined,
      );
    return earliest === undefined ? undefined : threadLeaseOf(earliest);
  };
  const by = acquired?.by;
  return [
    ...ended.map(({ conversation, alias }) => ({
      conversation,
      change: { _tag: "UnbindLease", ended: alias } as const,
    })),
    ...ended.flatMap((binding) => {
      const lease = boundNext(binding);
      return lease === undefined
        ? []
        : [{ conversation: binding.conversation, change: { _tag: "BindLease", lease } as const }];
    }),
    ...(acquired === undefined || by === undefined
      ? []
      : [{ conversation: by, change: { _tag: "BindLease", lease: acquired.lease } as const }]),
  ];
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
    const shared = yield* Ref.make<ReadonlyArray<ZeropsLease> | undefined>(undefined);

    // A restart knows which mounts are leases from the last read this server kept, and which lease
    // each alias was then: its first read is checked whole against it.
    yield* repository.latestLeases.pipe(
      Effect.map(Option.flatMap(decodeLeases)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (leases) =>
            Effect.all([
              Ref.set(checked, checkedRead(leases, undefined)),
              Ref.set(shared, leases),
              noteLeases(leases.map((lease) => lease.alias)),
            ]),
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
          // Absent `leases` means "not read", never "none": a call that read none keeps the last.
          const sharedBefore = yield* Ref.get(shared);
          const leases =
            envelope?.leases === undefined
              ? sharedBefore
              : withLastLeases(envelope.leases, sharedBefore);
          yield* Ref.set(shared, leases);

          const next: ZeropsLifecycleState = withSharedLeases(
            {
              threadId,
              // A result with no readable envelope leaves the previous one
              // standing. Clearing it, or reaching back to an older block, would
              // move the strip backwards over a corrupt payload.
              ...(envelope === undefined
                ? previous.envelope === undefined
                  ? {}
                  : { envelope: previous.envelope }
                : {
                    envelope: {
                      ...withLastDevServers(envelope, previous.envelope),
                      ...(previous.envelope?.leases === undefined
                        ? {}
                        : { leases: previous.envelope.leases }),
                    },
                  }),
              recentTools: withRecentTool(previous.recentTools, {
                toolName: call.name,
                status:
                  event.type === "item.started" ? "inProgress" : failed ? "failed" : "completed",
                at,
                ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
              }),
              updatedAt: at,
            },
            leases,
          );

          yield* Ref.update(cache, (current) => new Map(current).set(next.threadId, next));
          yield* persist(next, at);
          yield* PubSub.publish(yield* channel(next.threadId), next);
          // A read that changed zcp's leases changes what every other thread's views show.
          if (!sameLeases(leases, sharedBefore)) {
            const states = yield* Ref.get(cache);
            for (const [other, watching] of yield* Ref.get(channels)) {
              const state = states.get(other);
              if (other === threadId || state?.envelope === undefined) continue;
              yield* PubSub.publish(watching, withSharedLeases(state, leases));
            }
          }

          let readChanged = false;
          let renewed: ReadonlyArray<string> = [];
          let checkpoint: CheckedRead | undefined;
          if (envelope?.leases !== undefined) {
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
                envelope?.leases,
                readChanged,
                renewed,
                checkpoint,
                owner === undefined ? undefined : threadId,
              );
        }),
      );

    // The lease changes an event says are told after its state is recorded,
    // outside the write mutex: a reader never waits on a conversation's record.
    const ingest = (event: SpiEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        const facts = yield* fold(event);
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
              ? `lease:${event.eventId}:bind`
              : `lease:${event.eventId}:unbind:${conversation}`;
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

    /** A thread's state as its views read it: with zcp's leases as the latest call read them. */
    const view = (threadId: ThreadId) =>
      Effect.zipWith(loadOrEmpty(threadId), Ref.get(shared), withSharedLeases);

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
      ingest,
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
      return yield* make({
        toolEvents: bus.events,
        repository,
        threadOwner,
        noteLeases: roster.note,
        ...leases,
      });
    }),
  );
