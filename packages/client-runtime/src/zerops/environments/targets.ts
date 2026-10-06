/**
 * The account's Mate targets, as its listings and the sessions kept for its Mates name them
 * (DESIGN §4.4 region P, §2.B B4, §2.C C1). Pure.
 *
 * - A row the inventory read names its target's presence: present at its origin, in a platform
 *   transition, young and ACTIVE before its address landed, inactive, or without a public address.
 * - A row whose project's services are not read yet says nothing of any Mate in it: those
 *   targets' presence is `unknown`. A target a kept session names there, like one whose
 *   organization's listing no read has answered yet, is `remembered` at the origin its session
 *   opened at (A16): its Mate is looked for there before the services are read, never found gone.
 * - A target only a kept session names holds its last value until every listing is known and
 *   complete.
 *   Then it is `gone` when its project is not listed. When its project's services were read
 *   without it, it is `gone` only once a direct read of those services, finished after the
 *   omission was seen, lacks it too (§9 C19): a service the listing drops for a moment keeps its
 *   Mate.
 * - A remembered target its project's services were read without, or whose organization's complete
 *   listing lacks its project, is `unknown` until then, whether or not the other listings settled:
 *   that read replaces what its session kept (A16).
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { Known } from "../knowledge/known.ts";
import { heldCandidates, type CandidateRow } from "../projections/candidates.ts";
import type { PlatformStatus } from "./containerMachine.ts";
import type { Presence, ServiceTransition } from "./environmentMachine.ts";
import type { TargetKey } from "./exchange.ts";

/**
 * A Mate an earlier load reached, as the session it kept names it (`keptSessions.ts`): personal
 * context, never authority for its existence or access — absent means "not reached here".
 */
export interface RememberedTarget {
  readonly targetKey: TargetKey;
  readonly environmentId: EnvironmentId;
  /** The address its session was opened at; null when it names none. */
  readonly origin: string | null;
  /** The organization it was reached in; null where the session does not say. */
  readonly orgId: string | null;
}

const SERVICE_TRANSITIONS: ReadonlySet<string> = new Set<ServiceTransition>([
  "NEW",
  "CREATING",
  "STARTING",
  "RESTARTING",
  "UPGRADING",
  "READY_TO_DEPLOY",
]);

/** Region P for a target a listing row names (§4.4). */
export function candidatePresence(row: CandidateRow): Presence {
  if (row.presence === "unknown") return { kind: "unknown" };
  if (row.containerOrigin !== undefined) return { kind: "present", origin: row.containerOrigin };
  if (row.addressAwaited !== undefined) return { kind: "address-pending" };
  const status = row.service?.status ?? row.project.status;
  if (SERVICE_TRANSITIONS.has(status)) {
    return { kind: "transitioning", status: status as ServiceTransition };
  }
  if (status === "ACTIVE") return { kind: "no-origin", reason: "no-subdomain" };
  return { kind: "inactive", status };
}

/** One target as the listings and the kept sessions describe it now. */
export interface ListedTarget {
  readonly key: TargetKey;
  /** Null while the listings cannot say: presence holds its last value. */
  readonly presence: Presence | null;
  /** The environment its kept session names (C1). */
  readonly record: EnvironmentId | null;
}

/** The Zerops project of a `projectId:serviceId` target. */
export const targetProject = (key: TargetKey): string => key.split(":")[0] ?? key;

export interface ListedTargets {
  readonly targets: ReadonlyArray<ListedTarget>;
}

const GONE: Presence = { kind: "gone", evidence: "complete-scope-omits-verified" };

/** Every target a listing row or a kept session names, with its presence (region P). */
export function listTargets(input: {
  /** Each organization's listing. */
  readonly listings: ReadonlyArray<{
    readonly organizationId: string;
    readonly listing: Known<ReadonlyArray<CandidateRow>>;
  }>;
  readonly remembered: ReadonlyArray<RememberedTarget>;
  /** Each target's presence as last set; null for a target none was set for. */
  readonly lastPresence: (key: TargetKey) => Presence | null;
}): ListedTargets {
  const rows = input.listings.flatMap(({ listing }) => heldCandidates(listing).rows);
  // No listing says nothing: an organization not read, or none chosen, settles no absence.
  const settled =
    input.listings.length > 0 &&
    input.listings.every(
      ({ listing }) => listing.state === "known" && listing.coverage === "complete",
    );
  /** A kept session's own organization has no listing here: nothing here may say it is gone. */
  const unlistedOrganization = (record: RememberedTarget | undefined): boolean =>
    record?.orgId != null &&
    !input.listings.some(({ organizationId }) => organizationId === record.orgId);
  /**
   * A kept session's organization's listing, or any listing for one that names no organization,
   * that no read has answered yet: the projects it will name are not read either.
   */
  const unanswered = (record: RememberedTarget | undefined): boolean =>
    input.listings.some(
      ({ organizationId, listing }) =>
        (record?.orgId == null || record.orgId === organizationId) &&
        (listing.state === "unread" || listing.state === "reading"),
    );
  /** A kept session's organization's listing is known and complete: a project it lacks is not there. */
  const ownComplete = (record: RememberedTarget | undefined): boolean =>
    input.listings.some(
      ({ organizationId, listing }) =>
        record?.orgId === organizationId &&
        listing.state === "known" &&
        listing.coverage === "complete",
    );
  const listed = new Set(rows.map((row) => row.project.id));
  const unread = new Set(
    rows.filter((row) => row.presence === "unknown").map((row) => row.project.id),
  );
  const byKey = new Map(rows.map((row) => [row.key, row] as const));
  const recorded = new Map(input.remembered.map((record) => [record.targetKey, record] as const));
  /** Region P for a target no row names. */
  const unlisted = (key: TargetKey, record: RememberedTarget | undefined): Presence | null => {
    const projectId = targetProject(key);
    // Where its session kept it, while nothing read has said anything of it (A16).
    const remembered =
      record?.origin != null ? ({ kind: "remembered", origin: record.origin } as const) : null;
    // Services not read yet say nothing of a Mate in the project.
    if (unread.has(projectId)) return remembered ?? { kind: "unknown" };
    // Its session's organization is not listed here: nothing here says where it is.
    if (unlistedOrganization(record)) return remembered ?? input.lastPresence(key);
    // Its project's services were read without it, or its organization's complete listing lacks
    // the project: where its session kept it no longer answers (A16), and anything else it was is
    // held until every listing is whole.
    const omitted =
      input.lastPresence(key)?.kind === "remembered" ? ({ kind: "unknown" } as const) : null;
    if (!settled) {
      if (listed.has(projectId) || ownComplete(record)) return omitted;
      return unanswered(record) ? remembered : null;
    }
    // Every listing whole: its project's services, live and complete in the organization's
    // listing, or the organization's projects, no longer name it.
    return GONE;
  };
  const targets = [...new Set([...byKey.keys(), ...recorded.keys()])].map((key) => {
    const row = byKey.get(key);
    const presence = row !== undefined ? candidatePresence(row) : unlisted(key, recorded.get(key));
    return { key, presence, record: recorded.get(key)?.environmentId ?? null };
  });
  return { targets };
}

/** One target's container as the listing describes it: where it is reached, and its statuses. */
export interface ContainerTarget {
  readonly key: TargetKey;
  /** The Mate's public origin; null while the platform gives it none. */
  readonly origin: string | null;
  readonly platform: PlatformStatus;
}

/**
 * Each target's container: each row, at its origin and with its platform statuses, and each
 * remembered target of a listed project at the origin its session kept, its service unread (A16).
 */
export function containerTargetsOf(
  rows: ReadonlyArray<CandidateRow>,
  targets: ReadonlyArray<ListedTarget>,
): ReadonlyArray<ContainerTarget> {
  const projects = new Map(rows.map((row) => [row.project.id, row.project] as const));
  const remembered = targets.flatMap((target): ReadonlyArray<ContainerTarget> => {
    const project = projects.get(targetProject(target.key));
    return target.presence?.kind === "remembered" && project !== undefined
      ? [
          {
            key: target.key,
            origin: target.presence.origin,
            platform: { project: project.status, service: null },
          },
        ]
      : [];
  });
  const listed = rows.map((row) => ({
    key: row.key,
    origin: row.containerOrigin ?? null,
    platform: {
      project: row.project.status,
      service: row.service?.status ?? null,
      ...(row.service?.created === undefined ? {} : { serviceCreated: row.service.created }),
    },
  }));
  return [...remembered, ...listed];
}
