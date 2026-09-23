/**
 * The project picker's listing (DESIGN §7.5, A10): the shared `selectCandidates` rows, joined
 * with the environments this device has connected and the container store's verdict on each
 * Mate, and what the picker draws of them. Pure; `useZeropsCandidates` feeds it.
 */
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import {
  containerVerdict,
  type ContainerMachine,
  type ContainerVerdict,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import type { Freshness, Known, KnownSurface } from "@t3tools/client-runtime/zerops/knowledge";
import {
  candidatesNotice,
  heldCandidates,
  presentCandidates,
  type CandidateRow,
  type CandidatesNotice,
} from "@t3tools/client-runtime/zerops/projections";
import type { EnvironmentId } from "@t3tools/contracts";

/** A listed candidate with its container as the container store holds it now. */
export interface MobileCandidate extends CandidateRow {
  readonly container: ContainerVerdict;
}

type Listing = Known<ReadonlyArray<CandidateRow>>;
type KnownListing = Extract<Listing, { readonly state: "known" }>;
type UnknownListing = Exclude<Listing, { readonly state: "known" }>;

/** How far a value is from current: a listing is as current as its least current part. */
const FRESHNESS_RANK: Record<Freshness["kind"], number> = {
  live: 0,
  settled: 1,
  revalidating: 2,
  paused: 3,
  stale: 4,
};

/** Which listing speaks for none known: a failure names its cause, then a read on its way. */
const UNKNOWN_RANK: Record<UnknownListing["state"], number> = {
  failed: 0,
  reading: 1,
  unread: 2,
  gone: 3,
};

/**
 * The organizations' listings as one (M5): known while any is known, with the rows of those that
 * are, complete only when every organization's is, and as current as its least current part.
 * With none known, the one that says most. An account with no organization holds no project.
 */
function combineOrganizations(organizations: ReadonlyArray<Listing>, nowMs: number): Listing {
  const known = organizations.filter(
    (listing): listing is KnownListing => listing.state === "known",
  );
  const [first] = known;
  if (first === undefined) {
    const unknown = organizations.filter(
      (listing): listing is UnknownListing => listing.state !== "known",
    );
    const [speaker] = unknown;
    if (speaker === undefined) {
      return {
        state: "known",
        value: [],
        asOf: { ordinal: 0, atMs: nowMs },
        coverage: "complete",
        freshness: { kind: "settled" },
      };
    }
    return unknown.reduce(
      (best, listing) => (UNKNOWN_RANK[listing.state] < UNKNOWN_RANK[best.state] ? listing : best),
      speaker,
    );
  }
  return {
    state: "known",
    value: known.flatMap((listing) => heldCandidates(listing).rows),
    asOf: known.reduce(
      (oldest, listing) => (listing.asOf.atMs < oldest.atMs ? listing.asOf : oldest),
      first.asOf,
    ),
    coverage:
      known.length === organizations.length &&
      known.every((listing) => listing.coverage === "complete")
        ? "complete"
        : "partial",
    freshness: known.reduce(
      (least, listing) =>
        FRESHNESS_RANK[listing.freshness.kind] > FRESHNESS_RANK[least.kind]
          ? listing.freshness
          : least,
      first.freshness,
    ),
  };
}

/** A ready row whose origin an environment this device connected serves is connected to it. */
function withConnection(
  row: CandidateRow,
  connectedOrigins: ReadonlyMap<string, EnvironmentId>,
): CandidateRow {
  if (row.group !== "ready" || row.containerOrigin === undefined) return row;
  const environmentId = connectedOrigins.get(
    normalizeOrigin(row.containerOrigin) ?? row.containerOrigin,
  );
  return environmentId === undefined ? row : { ...row, group: "connected", environmentId };
}

const UNKNOWN_CONTAINER: ContainerVerdict = { level: "unknown" };

/**
 * The picker's listing: every organization's `selectCandidates` rows, each joined with the
 * environment this device connected at its origin and its container's verdict — unknown until
 * the container store holds the target.
 */
export function mobileCandidates(input: {
  readonly organizations: ReadonlyArray<Known<ReadonlyArray<CandidateRow>>>;
  readonly connectedOrigins: ReadonlyMap<string, EnvironmentId>;
  readonly containers: ReadonlyMap<TargetKey, ContainerMachine>;
  readonly nowMs: number;
}): Known<ReadonlyArray<MobileCandidate>> {
  return presentCandidates(
    combineOrganizations(input.organizations, input.nowMs),
    (row): MobileCandidate => {
      const machine = input.containers.get(row.key);
      return {
        ...withConnection(row, input.connectedOrigins),
        container: machine === undefined ? UNKNOWN_CONTAINER : containerVerdict(machine),
      };
    },
  );
}

const PICKER_SURFACE: KnownSurface<ReadonlyArray<MobileCandidate>> = {
  subject: "your projects",
  entity: "project",
  source: "zerops",
  checking: "Reading your projects…",
  negative: null,
};

/**
 * What the picker draws: the listing's notice in place of rows it has none of yet, "No projects
 * found" only off a complete listing, or the rows read so far with the notice a listing known in
 * part still carries (§3.4).
 */
export type CandidatePickerBody =
  | ({ readonly kind: "notice" } & CandidatesNotice)
  | { readonly kind: "none" }
  | {
      readonly kind: "rows";
      readonly rows: ReadonlyArray<MobileCandidate>;
      readonly notice: CandidatesNotice | null;
    };

const NONE: CandidatePickerBody = { kind: "none" };

export function candidatePickerBody(
  listing: Known<ReadonlyArray<MobileCandidate>>,
  nowMs: number,
): CandidatePickerBody {
  const held = heldCandidates(listing);
  const notice = candidatesNotice(listing, PICKER_SURFACE, nowMs);
  if (held.rows.length > 0) return { kind: "rows", rows: held.rows, notice };
  return notice === null ? NONE : { kind: "notice", ...notice };
}
