import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { repoOfUrl } from "@t3tools/shared/hqChanges";
import type { ZeropsPublicRoute } from "./publicRoutes.ts";
import { mateParts } from "./mateParts.ts";
import { recipeTierRepositories } from "./recipeTier.ts";
import type { PoolPair } from "./servicePairs.ts";

/** The change's own workspace and its parts' public stages. */
export interface ReviewTryTargets {
  readonly builds: ReadonlyArray<{
    readonly service: string;
    readonly url: string;
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
  readonly poolPairs?: ReadonlyArray<PoolPair> | undefined;
}): ReviewTryTargets {
  const { parts } = mateParts({
    services: input.hostnames.map((hostname) => ({ hostname })),
    routes: input.routes,
    pools: input.pools,
    controlPlane: input.controlPlane,
    tier: input.tier,
    poolPairs: input.poolPairs,
  });
  const changeRepo = input.repositoryUrl === undefined ? null : repoOfUrl(input.repositoryUrl);
  const appTarget = (service: string, url: string): ReviewTryTargets["builds"][number] => ({
    service,
    url: new URL(url).origin,
  });
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
  const builds = routed.filter(
    (entry, index, all) => all.findIndex((other) => other.url === entry.url) === index,
  );
  return { builds };
}
