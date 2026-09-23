/**
 * The account's Mate targets, as its listings and its records name them (DESIGN §4.4 region P,
 * §2.B B4, §2.C C1). Pure.
 *
 * - A row the inventory read names its target's presence: present at its origin, in a platform
 *   transition, inactive, or without a public address.
 * - A row whose project's services are not read yet says nothing of any Mate in it: those
 *   targets' presence is `unknown`, whatever a record remembers of them.
 * - A target only a record names is `gone` once every listing is known and complete — its project
 *   is not listed, or its services were read without it — and holds its last value otherwise.
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

/** Every target a listing row or a record names, with its presence (region P). */
export function listTargets(input: {
  readonly listings: ReadonlyArray<Known<ReadonlyArray<CandidateRow>>>;
  readonly records: ReadonlyArray<RegistrationRecord>;
}): ReadonlyArray<ListedTarget> {
  const rows = input.listings.flatMap((listing) => heldCandidates(listing).rows);
  const settled = input.listings.every(
    (listing) => listing.state === "known" && listing.coverage === "complete",
  );
  const unread = new Set(
    rows.filter((row) => row.presence === "unknown").map((row) => row.project.id),
  );
  const byKey = new Map(rows.map((row) => [row.key, row] as const));
  const recorded = new Map(input.records.map((record) => [record.targetKey, record] as const));
  return [...new Set([...byKey.keys(), ...recorded.keys()])].map((key) => {
    const row = byKey.get(key);
    const presence: Presence | null =
      row !== undefined
        ? candidatePresence(row)
        : unread.has(targetProject(key))
          ? { kind: "unknown" }
          : settled
            ? { kind: "gone", evidence: "complete-scope-omits-verified" }
            : null;
    return { key, presence, record: recorded.get(key)?.environmentId ?? null };
  });
}

/** Each row as the container store's target: its origin and its platform statuses. */
export function containerTargetsOf(
  rows: ReadonlyArray<CandidateRow>,
): ReadonlyArray<ContainerTarget> {
  return rows.map((row) => ({
    key: row.key,
    origin: row.containerOrigin ?? null,
    platform: { project: row.project.status, service: row.service?.status ?? null },
  }));
}
