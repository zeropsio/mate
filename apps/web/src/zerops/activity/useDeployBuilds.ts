/**
 * What the thread's Zerops project says of the builds its deploys named — the read
 * `deriveZeropsThreadModel` takes as `builds`, so a deploy whose build zcp stopped following
 * reads as that build stands, never against a clock. Uncertain only where the project cannot be
 * read here at all.
 */
import {
  type DeployBuildRead,
  type ThreadProject,
  readDeployBuild,
  threadProjectOf,
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
  /** The project the thread works in (threadProjectOf). */
  readonly thread: ThreadProject;
  /** The project as the inventory holds it: still loading, readable here, or not. */
  readonly project: "loading" | "readable" | "unreadable";
  readonly snapshot: ProjectActivitySnapshot;
}

const UNREAD = (): DeployBuildRead => "unread";
const UNOBSERVABLE = (): DeployBuildRead => "unobservable";

/** Pure: the lookup a derivation reads a deploy's build by. */
export function deployBuildLookup(
  input: DeployBuildsInput,
): (appVersionId: string) => DeployBuildRead {
  const { thread } = input;
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
  const thread = useMemo(() => threadProjectOf(lifecycle), [lifecycle]);
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
    () => deployBuildLookup({ signedIn, thread, project, snapshot }),
    [signedIn, thread, project, snapshot],
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
