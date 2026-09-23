/**
 * The inventory's reads as knowledge (DESIGN §2.B B1–B2, §3.5).
 *
 * A read the runtime has not answered is `unread`, `reading` or `failed` — never an empty list —
 * so "no projects" and "no services" exist only inside `known` with complete coverage (M5). How
 * current a value is comes from the interests that feed the read, not from every interest the
 * account holds: one project's failing topology says nothing about the organization's list.
 *
 * No I/O, but not in the pure zone: it value-imports `interestKeyOf` from the runtime, so a
 * projection takes these `Known` values as inputs and never imports this module. A stale value is
 * stale since it was read. A read with no value yet takes the caller's `nowMs` for a recovering
 * feeder's `reading.sinceMs` and a failed one's `failed.atMs`, because the runtime keeps no time
 * for either transition.
 */
import type { AbsenceEvidence, Freshness, Known, Stamp } from "../knowledge/known.ts";
import { interestKeyOf } from "./runtime.ts";
import type {
  CollectionRead,
  EntityKnowledge,
  EntityRead,
  IngestionStamp,
  InterestKey,
  InterestState,
  ProjectRecord,
  ProjectRef,
  QueryState,
  ServiceRecord,
  ViewObservation,
} from "./types.ts";

/** A read is as current as its best feeder: one observing interest keeps it live. */
const RANK: Record<InterestState["status"], number> = {
  observing: 0,
  establishing: 1,
  recovering: 2,
  paused: 3,
  failed: 4,
};

/** The best-placed interest among those that feed a read; `null` when none does. */
function sourceOf(
  observation: ViewObservation,
  feeders: ReadonlySet<InterestKey>,
): InterestState | null {
  let best: InterestState | null = null;
  for (const interest of [...observation.required, ...observation.optional]) {
    if (!feeders.has(interest.identity.key)) continue;
    if (best === null || RANK[interest.status] < RANK[best.status]) best = interest;
  }
  return best;
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
    case "recovering":
      return { state: "reading", sinceMs: nowMs, attempt: source.attempt };
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
    case "recovering":
      return {
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: source.nextRetryAtMs },
        sinceMs: asOf.atMs,
      };
    case "paused":
      return source.reason === "no-leases"
        ? unobserved(asOf.atMs)
        : { kind: "paused", by: source.reason };
    case "failed":
      return {
        kind: "stale",
        reason: {
          kind: "revalidation-failed",
          failure: { kind: "transport", detail: source.reason },
          attempt: source.attempts,
          retryAtMs: source.retryAtMs,
        },
        sinceMs: asOf.atMs,
      };
  }
}

function knownCollection<Record extends ProjectRecord | ServiceRecord>(
  read: CollectionRead<Record>,
  feeders: ReadonlySet<InterestKey>,
  nowMs: number,
): Known<ReadonlyArray<Record>> {
  const source = sourceOf(read.observation, feeders);
  const query: QueryState = read.query;
  if (query.status !== "observed") return notYetKnown(source, nowMs);
  const records: Record[] = [];
  let pending = query.unresolvedMemberKeys.length > 0;
  for (const member of read.value) {
    if (member.knowledge === "observed") records.push(member.record);
    else if (member.knowledge === "unresolved") pending = true;
  }
  const asOf = stampOf(query.stamp);
  return {
    state: "known",
    value: records,
    asOf,
    coverage: query.coverage.kind === "exhausted-traversal" && !pending ? "complete" : "partial",
    freshness: freshnessOf(source, asOf),
  };
}

/** An organization's projects: fed by its inventory interest. */
export function knownProjectsOf(
  read: CollectionRead<ProjectRecord>,
  nowMs: number,
): Known<ReadonlyArray<ProjectRecord>> {
  const { organization } = read.query.descriptor;
  return knownCollection(
    read,
    new Set([interestKeyOf({ kind: "organization-inventory", organization })]),
    nowMs,
  );
}

/** The interests that read one project and its services directly. */
const projectFeeders = (project: ProjectRef): ReadonlyArray<InterestKey> => [
  interestKeyOf({ kind: "project-inventory", project }),
  interestKeyOf({ kind: "project-topology", project, includeCurrentMetrics: false }),
  interestKeyOf({ kind: "project-topology", project, includeCurrentMetrics: true }),
];

/** A project's services: fed by its inventory interest or by its topology. */
export function knownServicesOf(
  read: CollectionRead<ServiceRecord>,
  nowMs: number,
): Known<ReadonlyArray<ServiceRecord>> {
  return knownCollection(read, new Set(projectFeeders(read.query.descriptor.project)), nowMs);
}

/** A confirmed denial of the scope, or a direct read that found nothing (§3.5). */
const ABSENCE: Record<
  Extract<EntityKnowledge<ProjectRecord>, { readonly knowledge: "unavailable" }>["reason"],
  AbsenceEvidence
> = {
  forbidden: "direct-forbidden",
  "access-revoked": "direct-forbidden",
  "not-found": "direct-not-found",
};

/**
 * A project's tags (B2): fed by its organization's list and by the project's own reads. A
 * presentation read that did not carry the tags leaves them unread.
 */
export function knownProjectTags(
  read: EntityRead<ProjectRecord>,
  nowMs: number,
): Known<ReadonlyArray<string>> {
  const entity = read.value;
  const ref = entity.knowledge === "observed" ? entity.record.ref : entity.ref;
  const source = sourceOf(
    read.observation,
    new Set([
      interestKeyOf({ kind: "organization-inventory", organization: ref.organization }),
      ...projectFeeders(ref),
    ]),
  );
  if (entity.knowledge === "unavailable")
    return { state: "gone", evidence: ABSENCE[entity.reason], asOf: stampOf(entity.since) };
  if (entity.knowledge === "unresolved") return notYetKnown(source, nowMs);
  const facet = entity.record.presentation;
  if (facet.knowledge === "unavailable")
    return { state: "gone", evidence: ABSENCE[facet.reason], asOf: stampOf(facet.stamp) };
  if (facet.knowledge === "unresolved" || facet.fields.tags === undefined)
    return notYetKnown(source, nowMs);
  const asOf = stampOf(facet.stamp);
  return {
    state: "known",
    value: facet.fields.tags,
    asOf,
    coverage: "complete",
    freshness: freshnessOf(source, asOf),
  };
}
