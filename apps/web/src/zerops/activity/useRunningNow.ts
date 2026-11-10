/**
 * A place's running and waiting platform work as lines a person reads (`runningLines`): the
 * organization's running work, already observed for the menu, joined with the place's services.
 * It asks Zerops nothing and holds nothing.
 */
import { runningLines, type RunningLine } from "@t3tools/client-runtime/zerops/activity/runningNow";
import { createContext, useContext, useMemo } from "react";

import { useProjectServices } from "../accountData";
import { useProjectRunning } from "./useProjectActivity";

const NO_LINES: ReadonlyArray<RunningLine> = [];

/**
 * What a design harness says runs in a project, in place of an account's store: a surface that
 * reads its place's work itself (the menu's popover) has no props to hand it through.
 */
export const RunningNowFixture = createContext<
  ((projectId: string) => ReadonlyArray<RunningLine>) | null
>(null);

export function useRunningNow(projectId: string | null | undefined): ReadonlyArray<RunningLine> {
  const fixture = useContext(RunningNowFixture);
  const processes = useProjectRunning(projectId ?? null);
  const { services } = useProjectServices(projectId);
  return useMemo(() => {
    if (fixture !== null) return projectId == null ? NO_LINES : fixture(projectId);
    if (processes.length === 0) return NO_LINES;
    const own = new Map<string, string>();
    for (const service of services === undefined ? [] : services)
      if (service.isSystem !== true) own.set(service.id, service.name);
    return runningLines({ processes, services: own });
  }, [fixture, processes, projectId, services]);
}
