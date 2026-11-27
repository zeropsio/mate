import type { ZeropsDraftCopy, ZeropsLease } from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { leaseMayBeOf, repoOfUrl } from "@t3tools/shared/hqChanges";

/** A copy's preview-server state as zcp, its one writer, last emitted it (zcp spec-mate §1.0a). */
export type DraftState = "parked" | "starting" | "running" | "stopped" | "failed" | "unknown";
const DRAFT_STATES: ReadonlyArray<DraftState> = [
  "parked",
  "starting",
  "running",
  "stopped",
  "failed",
  "unknown",
];

/**
 * Why a change offers no copy to open: its Mate has not reported its copies yet (`unreported`),
 * reports none of the change's branch and repository (`none`), or is no longer one of the
 * application's (`mate-gone`). None describes the draft server's condition.
 */
export type DraftAbsence = "unreported" | "none" | "mate-gone";

/**
 * Unavailable selects no copy and says why. An openable copy carries zcp's state for it; none
 * where zcp wrote none, or one this build does not know.
 */
export type DraftLook =
  | { readonly kind: "added" | "discarded" }
  | { readonly kind: "unavailable"; readonly why: DraftAbsence }
  | { readonly kind: "openable"; readonly copy: ZeropsDraftCopy; readonly state?: DraftState };

const withState = (copyState: string | undefined): { readonly state?: DraftState } => {
  const state = DRAFT_STATES.find((known) => known === copyState);
  return state === undefined ? {} : { state };
};

/** A change's copy, from copy identities, never from a server's last observation. */
export function draftLook(input: {
  readonly state: "open" | "adding" | "merging" | "merged" | "closed";
  /** HQ's word that the change's Mate is no longer the application's (`HqChange.mateGone`). */
  readonly mateGone: boolean;
  readonly branch: string | undefined;
  readonly repositoryUrl: string | undefined;
  readonly repositoryRemote: string | undefined;
  /** Undefined while the Mate has not reported its copies. */
  readonly leases: ReadonlyArray<ZeropsLease> | undefined;
  /** Null when no classic dev half exists, undefined while its topology is unread. */
  readonly classic:
    | {
        readonly hostname: string;
        readonly branch: string | null | undefined;
        readonly copyState?: string | undefined;
      }
    | null
    | undefined;
}): DraftLook {
  if (input.state === "merged") return { kind: "added" };
  if (input.state === "closed") return { kind: "discarded" };
  if (input.mateGone) return { kind: "unavailable", why: "mate-gone" };
  if (input.branch === undefined) return { kind: "unavailable", why: "none" };
  const changeRepo = input.repositoryUrl === undefined ? null : repoOfUrl(input.repositoryUrl);
  for (const lease of input.leases ?? []) {
    if (
      lease.branch !== input.branch ||
      (lease.state !== "held" && lease.state !== "parked" && lease.state !== "unmounted") ||
      lease.acquiredAt === undefined
    )
      continue;
    const remoteMatches =
      lease.repo !== undefined &&
      input.repositoryRemote !== undefined &&
      normalizeGitRemoteUrl(lease.repo) === normalizeGitRemoteUrl(input.repositoryRemote);
    const leaseRepo = lease.repo === undefined ? null : repoOfUrl(lease.repo);
    if (
      !remoteMatches &&
      (changeRepo === null ||
        leaseRepo === null ||
        changeRepo.hq.toLowerCase() !== leaseRepo.hq.toLowerCase())
    )
      continue;
    if (remoteMatches || leaseMayBeOf(lease.repo, changeRepo))
      return {
        kind: "openable",
        copy: {
          kind: "lease",
          alias: lease.alias,
          acquiredAt: lease.acquiredAt,
          branch: input.branch,
        },
        ...withState(lease.copyState),
      };
  }
  if (input.classic != null && input.classic.branch === input.branch)
    return {
      kind: "openable",
      copy: { kind: "service", hostname: input.classic.hostname, branch: input.branch },
      ...withState(input.classic.copyState),
    };
  if (input.leases === undefined || input.classic === undefined)
    return { kind: "unavailable", why: "unreported" };
  return { kind: "unavailable", why: "none" };
}
