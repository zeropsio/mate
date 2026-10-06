/**
 * The inventory's reads as knowledge (DESIGN §2.B B1–B2, §3.5).
 *
 * A read the runtime has not answered is `unread`, `reading` or `failed` — never an empty list —
 * so "no services" exists only inside `known` with complete coverage (M5). How current a value is
 * comes from the interests that feed the read, not from every interest the account holds.
 *
 * No I/O, but not in the pure zone: it value-imports `interestKeyOf` from the runtime, so a
 * projection takes these `Known` values as inputs and never imports this module. A stale value is
 * stale since it was read. A read with no value yet takes the caller's `nowMs` for a failed
 * feeder's `failed.atMs`, because the runtime keeps no time for that transition.
 */
import type { Freshness, Known, Stamp } from "../knowledge/known.ts";
import { interestKeyOf } from "./runtime.ts";
import type {
  CollectionRead,
  IngestionStamp,
  InterestKey,
  InterestState,
  ProjectRef,
  QueryState,
  ServiceRecord,
  ViewObservation,
} from "./types.ts";

/** A read is as current as its best feeder: one observing interest keeps it live. */
const RANK: Record<InterestState["status"], number> = {
  observing: 0,
  establishing: 1,
  paused: 3,
  failed: 4,
};

/** The best-placed interest among those that feed a read; `null` when none does. */
function sourceOf(
  observation: ViewObservation,
  feeders: ReadonlySet<InterestKey>,
): InterestState | null {
  let best: InterestState | null = null;
  for (const interests of [observation.required, observation.optional]) {
    for (const interest of interests) {
      if (!feeders.has(interest.identity.key)) continue;
      if (best === null || RANK[interest.status] < RANK[best.status]) best = interest;
    }
  }
  return best;
}

/** A read's feeders, computed once per ref object: every publication reads every project's. */
function feedersOnce<Ref extends object>(
  feedersOf: (ref: Ref) => ReadonlySet<InterestKey>,
): (ref: Ref) => ReadonlySet<InterestKey> {
  const held = new WeakMap<Ref, ReadonlySet<InterestKey>>();
  return (ref) => {
    let feeders = held.get(ref);
    if (feeders === undefined) {
      feeders = feedersOf(ref);
      held.set(ref, feeders);
    }
    return feeders;
  };
}

const stampOf = (stamp: IngestionStamp): Stamp => ({
  ordinal: stamp.receiptOrdinal,
  atMs: stamp.observedAtMs,
});

/** What a read is while it holds no value (§3.5, facet `unresolved`). */
function notYetKnown<T>(source: InterestState | null, nowMs: number): Known<T> {
  if (source === null) return { state: "unread", waitingFor: null };
  switch (source.status) {
    case "observing":
      return { state: "unread", waitingFor: null };
    case "establishing":
      return { state: "reading", sinceMs: source.startedAtMs, attempt: 1 };
    case "paused":
      return {
        state: "unread",
        waitingFor:
          source.reason === "background"
            ? "visible"
            : source.reason === "offline"
              ? "online"
              : null,
      };
    case "failed":
      return {
        state: "failed",
        failure: { kind: "transport", detail: source.reason },
        atMs: nowMs,
        attempt: source.attempts,
        retryAtMs: source.retryAtMs,
      };
  }
}

/**
 * A read no interest observes: its source pushes, but to nobody, so the value is not current and
 * nothing is scheduled to bring it back (§3.5: never current unless its interest observes).
 */
const unobserved = (sinceMs: number): Freshness => ({
  kind: "stale",
  reason: { kind: "source-recovering", retryAtMs: null },
  sinceMs,
});

/**
 * How current a held value is, by the source that feeds it (§3.5). The runtime keeps no time for
 * a feeder's failure, so a stale value is stale since it was read: the last moment it is known to
 * have been current, and the same on every evaluation.
 */
function freshnessOf(source: InterestState | null, asOf: Stamp): Freshness {
  if (source === null) return unobserved(asOf.atMs);
  switch (source.status) {
    case "observing":
      return { kind: "live" };
    case "establishing":
      return { kind: "revalidating", sinceMs: source.startedAtMs };
    case "paused":
      return source.reason === "no-leases"
        ? unobserved(asOf.atMs)
        : { kind: "paused", by: source.reason };
    case "failed":
      return {
        kind: "stale",
        reason:
          source.retryAtMs !== null
            ? {
                kind: "source-recovering",
                retryAtMs: source.retryAtMs,
                coverageGap: true,
              }
            : {
                kind: "revalidation-failed",
                failure: { kind: "transport", detail: source.reason },
                attempt: source.attempts,
                retryAtMs: source.retryAtMs,
              },
        sinceMs: asOf.atMs,
      };
  }
}

function knownCollection<Record extends ServiceRecord>(
  read: CollectionRead<Record>,
  source: InterestState | null,
  nowMs: number,
): Known<ReadonlyArray<Record>> {
  const query: QueryState = read.query;
  if (query.status !== "observed") return notYetKnown(source, nowMs);
  const records: Record[] = [];
  // A project's slice of the organization's read is pending on its own unresolved members, which
  // it lists as such, never on another project's.
  let pending = read.project === undefined && query.unresolvedMemberKeys.length > 0;
  let revoked = 0;
  for (const member of read.value) {
    if (member.knowledge === "observed") records.push(member.record);
    else if (member.knowledge === "unresolved") pending = true;
    else if (member.reason === "access-revoked") revoked += 1;
  }
  // A revoked access is a denial of a scope, not a read of what it holds: the listing is partial
  // while any member waits for the grant, and waits for it when every member does (§3.4).
  if (revoked > 0 && revoked === read.value.length)
    return { state: "unread", waitingFor: "access-grant" };
  if (revoked > 0) pending = true;
  const asOf = stampOf(query.stamp);
  return {
    state: "known",
    value: records,
    asOf,
    coverage: query.coverage.kind === "exhausted-traversal" && !pending ? "complete" : "partial",
    freshness: freshnessOf(source, asOf),
  };
}

/** The interests that read one project and its services directly. */
const projectFeeders = feedersOnce(
  (project: ProjectRef): ReadonlySet<InterestKey> =>
    new Set([
      interestKeyOf({ kind: "project-inventory", project }),
      interestKeyOf({ kind: "project-topology", project }),
    ]),
);

/**
 * A complete direct project service list proves absence. A membership search alone cannot:
 * its index may lag. A separately requested confirming read also supplies this proof.
 */
export function servicesCheckOrdinalOf(read: CollectionRead<ServiceRecord>): number | null {
  if (read.project === undefined) return null;
  if (
    read.query.status === "observed" &&
    read.query.source === "direct-read" &&
    read.query.coverage.kind === "exhausted-traversal" &&
    servicesSourceOf(read)?.status === "observing"
  )
    return read.query.stamp.receiptOrdinal;
  const check = interestKeyOf({ kind: "project-services-check", project: read.project });
  for (const interests of [read.observation.required, read.observation.optional]) {
    for (const interest of interests) {
      if (interest.status === "observing" && interest.identity.key === check)
        return interest.sinceReceiptOrdinal;
    }
  }
  return null;
}

/** The interest a project's services read is as current as. */
export function servicesSourceOf(read: CollectionRead<ServiceRecord>): InterestState | null {
  return read.project === undefined
    ? null
    : sourceOf(read.observation, projectFeeders(read.project));
}

/** A project's services: fed by its inventory interest or by its topology. */
export function knownServicesOf(
  read: CollectionRead<ServiceRecord>,
  nowMs: number,
): Known<ReadonlyArray<ServiceRecord>> {
  return knownCollection(read, servicesSourceOf(read), nowMs);
}
