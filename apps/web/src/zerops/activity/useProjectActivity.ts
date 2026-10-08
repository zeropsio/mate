/**
 * A project's processes as the account's store holds them (`projectProcesses`): what runs now, what
 * ended this session, and its newest history while somebody holds it. Nothing here reads Zerops;
 * a project the grant withholds reads as nothing (DESIGN §4.2 G12).
 */
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { HistoryRead, ProjectProcesses } from "@t3tools/client-runtime/data";
import {
  NOT_READ_PROCESSES,
  projectProcesses,
  projectsProcesses,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { projectAuthority, useZeropsInventory } from "../inventoryContext";
import { useAccountOrgId, useDetailDemand, useProjection } from "../ZeropsAccountData";

export interface ProjectActivitySnapshot {
  readonly processes: ReadonlyArray<ActivityProcess> | undefined;
  /** The organization's running work is observed live now: what is held is current. */
  readonly live: boolean;
  /** Its read was refused: the session ended, or the viewer may not read it. */
  readonly unavailableReason?: "expired-session" | "forbidden" | "refused";
  /** Read before and not live now: what is held stays while it catches up. */
  readonly reconnecting?: true;
  /** Where the project's newest process history read stands. */
  readonly processHistory: HistoryRead;
}

export const EMPTY_PROJECT_ACTIVITY_SNAPSHOT: ProjectActivitySnapshot = {
  processes: undefined,
  live: false,
  processHistory: "unread",
};

const NOT_READ_ATOM = Atom.make(NOT_READ_PROCESSES);
const NONE_READ_ATOM = Atom.make<Readonly<Record<string, ProjectProcesses>>>({});

export function projectActivitySnapshotOf(read: ProjectProcesses): ProjectActivitySnapshot {
  return {
    processes: read.processes,
    live: read.live,
    processHistory: read.history,
    ...(read.unavailableReason === undefined ? {} : { unavailableReason: read.unavailableReason }),
    ...(read.reconnecting ? { reconnecting: true as const } : {}),
  };
}

/** A project's processes, its newest history held while this is drawn. */
export function useProjectActivity(projectId: string | null): ProjectActivitySnapshot {
  useProjectActivityDemand(projectId);
  return useProjectActivityRead(projectId);
}

/** Holds a project's newest process history while this is drawn with one. */
export function useProjectActivityDemand(projectId: string | null): void {
  useDetailDemand("process", "history", projectId);
}

/** What the store holds of a project's processes, whoever holds its history: it holds nothing. */
export function useProjectActivityRead(projectId: string | null): ProjectActivitySnapshot {
  const inventory = useZeropsInventory();
  const orgId = useAccountOrgId();
  const read = useProjection(
    projectProcesses,
    orgId === null || projectId === null ? null : { orgId, projectId },
    NOT_READ_ATOM,
  );
  // Withheld at the read while the grant withholds the project; its demand stays.
  const withheld = projectId !== null && projectAuthority(inventory, projectId).kind === "withheld";
  return useMemo(
    () => (withheld ? EMPTY_PROJECT_ACTIVITY_SNAPSHOT : projectActivitySnapshotOf(read)),
    [read, withheld],
  );
}

/** Several projects' processes at once, without holding any history. */
export function useProjectsActivityRead(
  projectIds: ReadonlyArray<string>,
): Readonly<Record<string, ProjectProcesses>> {
  const orgId = useAccountOrgId();
  return useProjection(
    projectsProcesses,
    orgId === null ? null : { orgId, projectIds },
    NONE_READ_ATOM,
  );
}
