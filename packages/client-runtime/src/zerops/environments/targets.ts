/**
 * The account's Mate targets, as its listings and its records name them (DESIGN §4.4 region P,
 * §2.B B4, §2.C C1). Pure.
 *
 * - A row the inventory read names its target's presence: present at its origin, in a platform
 *   transition, inactive, or without a public address.
 * - A row whose project's services are not read yet says nothing of any Mate in it: those
 *   targets' presence is `unknown`. A target a record names there, like one whose organization's
 *   listing no read has answered yet, is `remembered` at the origin the record kept (A16): its
 *   Mate is looked for there before the services are read, never found gone.
 * - A target only a record names holds its last value until every listing is known and complete.
 *   Then it is `gone` when its project is not listed. When its project's services were read
 *   without it, it is `gone` only once a direct read of those services, finished after the
 *   omission was seen, lacks it too (§9 C19): a service the listing drops for a moment keeps its
 *   Mate.
 * - A remembered target its project's services were read without is `unknown` until then, whether
 *   or not the listings settled: that read replaces what its record kept (A16).
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { Known } from "../knowledge/known.ts";
import { heldCandidates, type CandidateRow } from "../projections/candidates.ts";
import type { ContainerTarget } from "./containerStore.ts";
import type { Presence, ServiceTransition } from "./environmentMachine.ts";
import type { TargetKey } from "./exchangeDriver.ts";
import type { RegistrationRecord } from "./records.ts";

const SERVICE_TRANSITIONS: ReadonlySet<string> = new Set<ServiceTransition>([
  "NEW",
  "CREATING",
  "STARTING",
  "RESTARTING",
  "UPGRADING",
]);

/** Region P for a target a listing row names (§4.4). */
export function candidatePresence(row: CandidateRow): Presence {
  if (row.presence === "unknown") return { kind: "unknown" };
  if (row.containerOrigin !== undefined) return { kind: "present", origin: row.containerOrigin };
  const status = row.service?.status ?? row.project.status;
  if (SERVICE_TRANSITIONS.has(status)) {
    return { kind: "transitioning", status: status as ServiceTransition };
  }
  if (status === "ACTIVE") return { kind: "no-origin", reason: "no-subdomain" };
  return { kind: "inactive", status };
}

/** One target as the listings and the records describe it now. */
export interface ListedTarget {
  readonly key: TargetKey;
  /** Null while the listings cannot say: presence holds its last value. */
  readonly presence: Presence | null;
  /** The registration record's environment (C1). */
  readonly record: EnvironmentId | null;
}

/** The Zerops project of a `projectId:serviceId` target. */
export const targetProject = (key: TargetKey): string => key.split(":")[0] ?? key;

/**
 * A remembered target its project's services were read without (§9 C19): waiting for a direct
 * read of those services past `past` (null: past the first one held), or confirmed by one.
 */
export type Absence =
  | { readonly kind: "waiting"; readonly past: number | null }
  | { readonly kind: "confirmed" };

export interface ListedTargets {
  readonly targets: ReadonlyArray<ListedTarget>;
  /** Every absence now; the next evaluation takes it back. */
  readonly absences: ReadonlyMap<TargetKey, Absence>;
  /** The targets whose absence began a wait now: each asks for a direct read of its project. */
  readonly confirm: ReadonlyArray<TargetKey>;
}

const GONE: Presence = { kind: "gone", evidence: "complete-scope-omits-verified" };

/** Every target a listing row or a record names, with its presence (region P). */
export function listTargets(input: {
  /** Each organization's listing. */
  readonly listings: ReadonlyArray<{
    readonly organizationId: string;
    readonly listing: Known<ReadonlyArray<CandidateRow>>;
  }>;
  readonly records: ReadonlyArray<RegistrationRecord>;
  /**
   * The receipt ordinal of each project's latest complete direct read of its services, by
   * project id; a project with none held is missing.
   */
  readonly directReads: ReadonlyMap<string, number>;
  /** The absences the last evaluation answered. */
  readonly absences: ReadonlyMap<TargetKey, Absence>;
  /** Each target's presence as last set; null for a target none was set for. */
  readonly lastPresence: (key: TargetKey) => Presence | null;
}): ListedTargets {
  const rows = input.listings.flatMap(({ listing }) => heldCandidates(listing).rows);
  const settled = input.listings.every(
    ({ listing }) => listing.state === "known" && listing.coverage === "complete",
  );
  /**
   * The record's organization's listing, or any listing for a record that kept no organization,
   * that no read has answered yet: the projects it will name are not read either.
   */
  const unanswered = (record: RegistrationRecord | undefined): boolean =>
    input.listings.some(
      ({ organizationId, listing }) =>
        (record?.projectRef == null || record.projectRef.orgId === organizationId) &&
        (listing.state === "unread" || listing.state === "reading"),
    );
  const listed = new Set(rows.map((row) => row.project.id));
  const unread = new Set(
    rows.filter((row) => row.presence === "unknown").map((row) => row.project.id),
  );
  const byKey = new Map(rows.map((row) => [row.key, row] as const));
  const recorded = new Map(input.records.map((record) => [record.targetKey, record] as const));
  const absences = new Map<TargetKey, Absence>();
  const confirm: TargetKey[] = [];
  /** Region P for a target no row names. */
  const unlisted = (key: TargetKey, record: RegistrationRecord | undefined): Presence | null => {
    const projectId = targetProject(key);
    const held = input.absences.get(key);
    // Where its record kept it, while no read of its project's services has said anything (A16).
    const remembered =
      held === undefined && record?.origin != null
        ? ({ kind: "remembered", origin: record.origin } as const)
        : null;
    // Services not read yet say nothing of a Mate in the project, unless a direct read already
    // confirmed it gone; a listing that cannot say holds the absence as it was.
    if (unread.has(projectId)) {
      if (held?.kind !== "confirmed") return remembered ?? { kind: "unknown" };
      absences.set(key, held);
      return null;
    }
    // Its project's services were read without it: where its record kept it no longer answers
    // (A16), and anything else it was is held.
    const omitted =
      input.lastPresence(key)?.kind === "remembered" ? ({ kind: "unknown" } as const) : null;
    if (!settled) {
      if (held !== undefined) absences.set(key, held);
      if (listed.has(projectId)) return omitted;
      return unanswered(record) ? remembered : null;
    }
    if (!listed.has(projectId)) return GONE;
    const read = input.directReads.get(projectId) ?? null;
    const next: Absence =
      held === undefined
        ? { kind: "waiting", past: read }
        : held.kind === "confirmed"
          ? held
          : held.past === null
            ? { kind: "waiting", past: read }
            : read !== null && read > held.past
              ? { kind: "confirmed" }
              : held;
    absences.set(key, next);
    if (next.kind === "confirmed") return GONE;
    if (held === undefined || (held.kind === "waiting" && held.past !== next.past))
      confirm.push(key);
    return omitted;
  };
  const targets = [...new Set([...byKey.keys(), ...recorded.keys()])].map((key) => {
    const row = byKey.get(key);
    const presence = row !== undefined ? candidatePresence(row) : unlisted(key, recorded.get(key));
    return { key, presence, record: recorded.get(key)?.environmentId ?? null };
  });
  return { targets, absences, confirm };
}

/**
 * The container store's targets: each row, at its origin and with its platform statuses, and each
 * remembered target of a listed project at the origin its record kept, its service unread (A16).
 * `first` — the route's target — is read before any other.
 */
export function containerTargetsOf(
  rows: ReadonlyArray<CandidateRow>,
  targets: ReadonlyArray<ListedTarget>,
  first: TargetKey | null,
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
    platform: { project: row.project.status, service: row.service?.status ?? null },
  }));
  const all = [...remembered, ...listed];
  const route = all.find((target) => target.key === first);
  return route === undefined ? all : [route, ...all.filter((target) => target !== route)];
}
