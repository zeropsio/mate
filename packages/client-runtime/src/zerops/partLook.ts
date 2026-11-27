import type { ZeropsLease } from "@t3tools/contracts";
import { draftLook, type DraftLook, type DraftState } from "./draftLook.ts";
import { mateParts } from "./mateParts.ts";
import type { ZeropsPublicRoute } from "./publicRoutes.ts";
import type { PoolPair } from "./servicePairs.ts";
import { tryItTargets, type ReviewTryTargets } from "./tryItTargets.ts";

/**
 * What every surface draws for one change: Your app (the stage of each part of the change's own
 * repository, never another part's) and its Draft (the change's working copy, with the state zcp
 * last wrote for it).
 */
export interface PartLook {
  readonly app: ReviewTryTargets["builds"];
  readonly draft: DraftLook;
}

/** The one decision behind Try it, the Draft pane and the change's chat buttons. */
export function partLook(input: {
  /** The Mate's project as the menu read it; undefined while its services are unread. */
  readonly project:
    | {
        readonly routes: ReadonlyArray<ZeropsPublicRoute>;
        readonly hostnames: ReadonlyArray<string>;
        readonly pools: ReadonlyArray<string> | undefined;
        readonly controlPlane: string | undefined;
      }
    | undefined;
  readonly tier: string | undefined;
  /** The change's repository, its part's dev service name. */
  readonly repository: string;
  readonly repositoryUrl: string | undefined;
  /** The external repository HQ says this repository follows or mirrors. */
  readonly repositoryRemote: string | undefined;
  readonly poolPairs: ReadonlyArray<PoolPair> | undefined;
  readonly state: "open" | "adding" | "merging" | "merged" | "closed";
  readonly branch: string | undefined;
  readonly leases: ReadonlyArray<ZeropsLease> | undefined;
  /** zcp's read of the repository's classic dev half, when it has one. */
  readonly classic: {
    readonly branch: string | null | undefined;
    readonly copyState?: string | undefined;
  };
}): PartLook {
  const project = input.project;
  const { builds } = tryItTargets({
    routes: project?.routes ?? [],
    hostnames: project?.hostnames ?? [],
    pools: project?.pools,
    controlPlane: project?.controlPlane,
    tier: input.tier,
    repository: input.repository,
    repositoryUrl: input.repositoryUrl,
    repositoryRemote: input.repositoryRemote,
    poolPairs: input.poolPairs,
  });
  const classicPart =
    project === undefined
      ? undefined
      : mateParts({
          services: project.hostnames.map((hostname) => ({ hostname })),
          routes: project.routes,
          pools: project.pools,
          controlPlane: project.controlPlane,
          tier: input.tier,
          poolPairs: input.poolPairs,
        }).parts.find((part) => part.devService === input.repository && !part.pooled);
  return {
    app: builds,
    draft: draftLook({
      state: input.state,
      branch: input.branch,
      repositoryUrl: input.repositoryUrl,
      repositoryRemote: input.repositoryRemote,
      leases: input.leases,
      classic:
        project === undefined
          ? undefined
          : classicPart === undefined
            ? null
            : { hostname: classicPart.devService, ...input.classic },
    }),
  };
}

/** The line a surface shows beside a Draft for zcp's state; none while zcp wrote none. */
export function draftStateLine(state: DraftState | undefined): string | undefined {
  switch (state) {
    case undefined:
    case "running":
      return undefined;
    case "parked":
      return "Asleep; it wakes when opened.";
    case "starting":
      return "Starting…";
    case "stopped":
      return "Stopped; it starts again when opened.";
    case "failed":
      return "Stopped with an error; opening it tries again.";
    case "unknown":
      return "Mate lost touch with it; this updates when it reports again.";
  }
}
