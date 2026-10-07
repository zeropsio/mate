/**
 * What the thread's Zerops project says of the builds its deploys named — the read
 * `deriveZeropsThreadModel` takes as `builds`, so a deploy whose build zcp stopped following
 * reads as that build stands, never against a clock. Uncertain only where the project cannot be
 * read here at all; an outage leaves it as it was read, catching up.
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
import { Atom } from "effect/unstable/reactivity";
import {
  projectProcesses,
  historyScope,
  NOT_READ_PROCESSES,
  type Projection,
  type ProjectKey,
} from "@t3tools/client-runtime/data";
import { sameValue } from "../../lib/sameValue";
import { useAccountOrgId, useProjection } from "../ZeropsAccountData";

import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import { findInventoryProjectRef, projectAuthority, useZeropsInventory } from "../inventoryContext";
import { useZeropsSessionOptional } from "../ZeropsSessionProvider";
import { type ProjectActivitySnapshot, useProjectActivityDemand } from "./useProjectActivity";

export interface DeployBuildsInput {
  readonly signedIn: boolean;
  /** The project the thread works in (threadProjectOf). */
  readonly thread: ThreadProject;
  /** The project as the inventory holds it: still loading, readable here, or not. */
  readonly project: "loading" | "readable" | "unreadable";
  readonly snapshot: Pick<
    ProjectActivitySnapshot,
    "processes" | "processHistory" | "unavailableReason"
  >;
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
    processHistory: input.snapshot.processHistory,
  };
  return (appVersionId) => readDeployBuild(read, thread.projectId, appVersionId);
}

/** A build card reads process evidence; transport recovery does not erase a completed history. */
export const projectBuildProcesses: Projection<ProjectKey, DeployBuildsInput["snapshot"]> = {
  name: "projectBuildProcesses",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, key) => {
    const held = projectProcesses.derive(read, key);
    return {
      processes: held.processes,
      processHistory:
        held.history !== "failed" &&
        read.coverage(historyScope(key.orgId, key.projectId)) === "complete"
          ? "read"
          : held.history,
      ...(held.unavailableReason === undefined
        ? {}
        : { unavailableReason: held.unavailableReason }),
    };
  },
  equals: sameValue,
};
const UNREAD_BUILDS = Atom.make<DeployBuildsInput["snapshot"]>({
  processes: NOT_READ_PROCESSES.processes,
  processHistory: NOT_READ_PROCESSES.history,
});

/** The thread's builds lookup, and the project it reads. */
export function useDeployBuilds(lifecycle: Known<ZeropsLifecycle> | undefined): {
  readonly builds: (appVersionId: string) => DeployBuildRead;
  readonly projectId: string | null;
} {
  const session = useZeropsSessionOptional();
  const inventory = useZeropsInventory();
  const thread = useMemo(() => threadProjectOf(lifecycle), [lifecycle]);
  const projectId = typeof thread === "string" ? null : thread.projectId;
  const orgId = useAccountOrgId();
  const snapshot = useProjection(
    projectBuildProcesses,
    orgId === null || projectId === null ? null : { orgId, projectId },
    UNREAD_BUILDS,
  );
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
  // An outage leaves what was read standing and what was not unread: it catches up, it never
  // turns unobservable on a timer.
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
