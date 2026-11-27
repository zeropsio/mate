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
 * Unavailable selects no copy; it does not describe the draft server's condition. An openable
 * copy carries zcp's state for it; none where zcp wrote none, or one this build does not know.
 */
export type DraftLook =
  | { readonly kind: "unavailable" | "added" | "discarded" }
  | { readonly kind: "openable"; readonly copy: ZeropsDraftCopy; readonly state?: DraftState };

const withState = (copyState: string | undefined): { readonly state?: DraftState } => {
  const state = DRAFT_STATES.find((known) => known === copyState);
  return state === undefined ? {} : { state };
};

/** A change's copy, from copy identities, never from a server's last observation. */
export function draftLook(input: {
  readonly state: "open" | "adding" | "merging" | "merged" | "closed";
  readonly branch: string | undefined;
  readonly repositoryUrl: string | undefined;
  readonly repositoryRemote: string | undefined;
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
  if (input.branch === undefined) return { kind: "unavailable" };
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
  return { kind: "unavailable" };
}
