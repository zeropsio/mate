import type { ZeropsDraftCopy, ZeropsLease } from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { leaseMayBeOf, repoOfUrl } from "@t3tools/shared/hqChanges";

export type DraftLook =
  | { readonly kind: "reading" | "unavailable" | "added" | "discarded" }
  | { readonly kind: "openable"; readonly copy: ZeropsDraftCopy };

/** A change's copy, from copy identities, never from a server's last observation. */
export function draftLook(input: {
  readonly state: "open" | "adding" | "merging" | "merged" | "closed";
  readonly branch: string | undefined;
  readonly repositoryUrl: string | undefined;
  readonly repositoryRemote: string | undefined;
  readonly leases: ReadonlyArray<ZeropsLease> | undefined;
  /** Null when no classic dev half exists, undefined while its topology is unread. */
  readonly classic:
    | { readonly hostname: string; readonly branch: string | null | undefined }
    | null
    | undefined;
}): DraftLook {
  if (input.state === "merged") return { kind: "added" };
  if (input.state === "closed") return { kind: "discarded" };
  if (
    input.branch === undefined ||
    input.leases === undefined ||
    input.classic === undefined ||
    (input.repositoryUrl === undefined && input.repositoryRemote === undefined)
  )
    return { kind: "reading" };
  const changeRepo = input.repositoryUrl === undefined ? null : repoOfUrl(input.repositoryUrl);
  let repositoryUnread = false;
  for (const lease of input.leases) {
    if (
      lease.branch !== input.branch ||
      lease.state !== "held" ||
      lease.unverified === true ||
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
    ) {
      repositoryUnread = true;
      continue;
    }
    if (remoteMatches || leaseMayBeOf(lease.repo, changeRepo))
      return {
        kind: "openable",
        copy: {
          kind: "lease",
          alias: lease.alias,
          acquiredAt: lease.acquiredAt,
          branch: input.branch,
        },
      };
  }
  if (input.classic !== null) {
    if (input.classic.branch === undefined) return { kind: "reading" };
    if (input.classic.branch === input.branch)
      return {
        kind: "openable",
        copy: { kind: "service", hostname: input.classic.hostname, branch: input.branch },
      };
  }
  return { kind: repositoryUnread ? "reading" : "unavailable" };
}
