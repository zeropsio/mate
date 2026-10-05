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
import { UNREACHABLE_GRACE_MS } from "@t3tools/client-runtime/zerops/activity/observe";
import { useEffect, useMemo, useState } from "react";

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
  /** Zerops unreachable past the grace (`unreachableLasts`): what was never read cannot be. */
  readonly unreachable?: boolean;
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
    input.snapshot.unavailableReason !== undefined ||
    (input.unreachable === true && input.snapshot.processes === undefined)
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
  // Zerops unreachable past the grace, on a timer of its own: the routine
  // reconnect is back within it, a lasting outage is not.
  const reconnecting = snapshot.reconnecting === true;
  const [lasted, setLasted] = useState(false);
  useEffect(() => {
    if (!reconnecting) return;
    const timer = setTimeout(() => setLasted(true), UNREACHABLE_GRACE_MS);
    return () => {
      clearTimeout(timer);
      setLasted(false);
    };
  }, [reconnecting]);
  const unreachable = reconnecting && lasted;
  const builds = useMemo(
    () => deployBuildLookup({ signedIn, thread, project, snapshot, unreachable }),
    [signedIn, thread, project, snapshot, unreachable],
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
