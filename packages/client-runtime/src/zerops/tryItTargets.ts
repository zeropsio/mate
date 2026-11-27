import type { ZeropsDevServer, ZeropsLease } from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { leaseMayBeOf, repoOfUrl, type HqReviewBuild } from "@t3tools/shared/hqChanges";
import type { ZeropsPublicRoute } from "./publicRoutes.ts";
import { mateParts, poolWorkspaceLink } from "./mateParts.ts";
import { recipeTierRepositories } from "./recipeTier.ts";
import { reviewBuildVerdict } from "./reviewVerdict.ts";
import type { PoolPair } from "./servicePairs.ts";

/** The change's own workspace and its parts' public stages. */
export interface ReviewTryTargets {
  readonly previews: ReadonlyArray<{ readonly service: string; readonly url: string }>;
  readonly previewState: "reading" | "not-running" | "available" | "ended";
  readonly builds: ReadonlyArray<{
    readonly service: string;
    readonly url: string;
    readonly version: "building" | "unknown";
  }>;
}

/** Select the branch's live workspace and public stages that belong to its repository. */
export function tryItTargets(input: {
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly hostnames: ReadonlyArray<string>;
  readonly pools: ReadonlyArray<string> | undefined;
  readonly controlPlane: string | undefined;
  readonly tier: string | undefined;
  readonly repository: string;
  readonly repositoryUrl: string | undefined;
  /** The external repository HQ says this repository follows or mirrors. */
  readonly repositoryRemote: string | undefined;
  readonly open: boolean;
  readonly branch: string | undefined;
  readonly head: string | undefined;
  readonly reviewBuild: HqReviewBuild | undefined;
  readonly now?: number | undefined;
  readonly leases: ReadonlyArray<ZeropsLease> | undefined;
  readonly poolPairs?: ReadonlyArray<PoolPair> | undefined;
  /** The classic dev checkout's branch, null when read and not a branch. */
  readonly classicBranch: string | null | undefined;
  /** The dev servers zcp last read on the classic service. */
  readonly classicServers: ReadonlyArray<ZeropsDevServer> | undefined;
}): ReviewTryTargets {
  const { parts } = mateParts({
    services: input.hostnames.map((hostname) => ({ hostname })),
    routes: input.routes,
    pools: input.pools,
    controlPlane: input.controlPlane,
    tier: input.tier,
    poolPairs: input.poolPairs,
  });
  const classic = parts.find((part) => part.devService === input.repository && !part.pooled);
  const changeRepo = input.repositoryUrl === undefined ? null : repoOfUrl(input.repositoryUrl);
  let repositoryUnread = false;
  const previews = (input.leases ?? []).flatMap((lease) => {
    if (!input.open || input.branch === undefined || lease.branch !== input.branch) return [];
    const link = poolWorkspaceLink(lease);
    if (link.url === undefined) return [];
    const remoteMatches =
      lease.repo !== undefined &&
      input.repositoryRemote !== undefined &&
      normalizeGitRemoteUrl(lease.repo) === normalizeGitRemoteUrl(input.repositoryRemote);
    const leaseRepo = lease.repo === undefined ? null : repoOfUrl(lease.repo);
    if (remoteMatches) return [{ service: lease.alias, url: link.url }];
    if (
      changeRepo === null ||
      leaseRepo === null ||
      changeRepo.hq.toLowerCase() !== leaseRepo.hq.toLowerCase()
    ) {
      repositoryUnread = true;
      return [];
    }
    return leaseMayBeOf(lease.repo, changeRepo) ? [{ service: lease.alias, url: link.url }] : [];
  });
  if (
    input.open &&
    input.branch !== undefined &&
    input.classicBranch === input.branch &&
    classic !== undefined
  ) {
    const link = poolWorkspaceLink({ state: "held", devServers: input.classicServers });
    if (link.url !== undefined) previews.push({ service: classic.devService, url: link.url });
  }
  const reading =
    input.branch === undefined ||
    ((input.pools === undefined || input.pools.length > 0) && input.leases === undefined) ||
    repositoryUnread ||
    (classic !== undefined &&
      (input.classicBranch === undefined ||
        (input.classicBranch === input.branch && input.classicServers === undefined)));
  const build = input.reviewBuild;
  const verdict = reviewBuildVerdict(build, input.now);
  const version =
    verdict?.state === "awaiting" && build?.head === input.head ? "building" : "unknown";
  const appTarget = (service: string, url: string): ReviewTryTargets["builds"][number] => ({
    service,
    url: new URL(url).origin,
    version,
  });
  const reported =
    build !== undefined && input.head !== undefined && build.head === input.head
      ? (verdict?.links ?? []).map(({ setup, url }) => appTarget(setup, url))
      : [];
  const repositories = input.tier === undefined ? new Map() : recipeTierRepositories(input.tier);
  const sameRepository = (address: string | undefined): boolean => {
    if (address === undefined) return false;
    if (
      [input.repositoryUrl, input.repositoryRemote].some(
        (own) => own !== undefined && normalizeGitRemoteUrl(address) === normalizeGitRemoteUrl(own),
      )
    )
      return true;
    const source = repoOfUrl(address);
    return (
      source !== null &&
      changeRepo !== null &&
      source.hq.toLowerCase() === changeRepo.hq.toLowerCase() &&
      source.appId.toLowerCase() === changeRepo.appId.toLowerCase() &&
      source.repo.toLowerCase() === changeRepo.repo.toLowerCase()
    );
  };
  const routed = parts.flatMap((part) => {
    const stage = part.preview;
    if (stage?.url === undefined) return [];
    if (part.devService !== input.repository && !sameRepository(repositories.get(stage.service)))
      return [];
    return [appTarget(stage.service, stage.url)];
  });
  const builds = [...reported, ...routed].filter(
    (entry, index, all) => all.findIndex((other) => other.url === entry.url) === index,
  );
  return {
    previews,
    previewState: !input.open
      ? "ended"
      : previews.length > 0
        ? "available"
        : reading
          ? "reading"
          : "not-running",
    builds,
  };
}
