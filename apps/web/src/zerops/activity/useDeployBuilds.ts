/**
 * What the thread's Zerops project says of the builds its deploys named — the read
 * `deriveZeropsThreadModel` takes as `builds`, so a deploy whose build zcp stopped following
 * reads as that build stands, never against a clock. Uncertain only where the project cannot be
 * read here at all.
 */
import {
  type DeployBuildRead,
  readDeployBuild,
} from "@t3tools/client-runtime/zerops/activity/deployBuild";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ZeropsLifecycle } from "@t3tools/contracts";
import { useMemo } from "react";

import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import { findInventoryProjectRef, projectAuthority, useZeropsInventory } from "../inventoryContext";
import { useZeropsSessionOptional } from "../ZeropsSessionProvider";
import {
  type ProjectActivitySnapshot,
  useProjectActivityDemand,
  useProjectActivityRead,
} from "./useProjectActivity";

export interface DeployBuildsInput {
  readonly signedIn: boolean;
  /** The thread's lifecycle: its envelope names the project the thread works in. */
  readonly lifecycle: Known<ZeropsLifecycle> | undefined;
  /** The project as the inventory holds it: still loading, readable here, or not. */
  readonly project: "loading" | "readable" | "unreadable";
  readonly snapshot: ProjectActivitySnapshot;
}

const UNREAD = (): DeployBuildRead => "unread";
const UNOBSERVABLE = (): DeployBuildRead => "unobservable";

/** The thread's project, while its lifecycle is still read, or none it can be read by. */
export function threadProjectOf(
  lifecycle: Known<ZeropsLifecycle> | undefined,
): { readonly projectId: string } | "reading" | "none" {
  switch (lifecycle?.state) {
    case "unread":
    case "reading":
      return "reading";
    case "known": {
      const projectId = lifecycle.value.envelope?.project.id;
      return projectId === undefined ? "none" : { projectId };
    }
    default:
      return "none";
  }
}

/** Pure: the lookup a derivation reads a deploy's build by. */
export function deployBuildLookup(
  input: DeployBuildsInput,
): (appVersionId: string) => DeployBuildRead {
  const thread = threadProjectOf(input.lifecycle);
  if (
    !input.signedIn ||
    thread === "none" ||
    input.project === "unreadable" ||
    input.snapshot.unavailableReason !== undefined
  ) {
    return UNOBSERVABLE;
  }
  if (thread === "reading" || input.project === "loading") return UNREAD;
  const read = {
    processes: input.snapshot.processes,
    processHistory: input.snapshot.processHistory ?? "unread",
  };
  return (appVersionId) => readDeployBuild(read, thread.projectId, appVersionId);
}

/** The thread's builds lookup, and the project it reads. */
export function useDeployBuilds(lifecycle: Known<ZeropsLifecycle> | undefined): {
  readonly builds: (appVersionId: string) => DeployBuildRead;
  readonly projectId: string | null;
} {
  const session = useZeropsSessionOptional();
  const inventory = useZeropsInventory();
  const thread = threadProjectOf(lifecycle);
  const projectId = typeof thread === "string" ? null : thread.projectId;
  const snapshot = useProjectActivityRead(projectId);
  const signedIn = session !== null && session.status === "signed-in";
  const project =
    projectId === null ||
    inventory.lost.has(projectId) ||
    projectAuthority(inventory, projectId).kind === "withheld"
      ? "unreadable"
      : findInventoryProjectRef(inventory, projectId) !== null
        ? "readable"
        : inventory.isLoading
          ? "loading"
          : "unreadable";
  const builds = useMemo(
    () => deployBuildLookup({ signedIn, lifecycle, project, snapshot }),
    [signedIn, lifecycle, project, snapshot],
  );
  return { builds, projectId };
}

/**
 * Keeps the store reading the project while the thread's running operation is a deploy whose
 * build it follows by the appVersion its result named — whether or not its card is drawn.
 */
export function useRunningBuildDemand(
  projectId: string | null,
  running: ZeropsOperation | undefined,
): void {
  const follows =
    running?.kind === "deploy" &&
    (running.version?.id !== undefined || (running.appVersionIds?.length ?? 0) > 0);
  useProjectActivityDemand(follows ? projectId : null);
}
