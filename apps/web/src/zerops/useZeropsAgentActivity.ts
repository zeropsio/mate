import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { deriveZeropsAgentActivity, type ZeropsAgentActivity } from "./agentActivity";

/**
 * Every connected Mate's activity, keyed by environment — the left menu and
 * the projects screen both read this, so a Mate says the same thing in both.
 */
export function useZeropsAgentActivity(): ReadonlyMap<EnvironmentId, ZeropsAgentActivity> {
  const threads = useThreadShells();
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  return useMemo(
    () => deriveZeropsAgentActivity(threads, threadLastVisitedAtById),
    [threadLastVisitedAtById, threads],
  );
}
