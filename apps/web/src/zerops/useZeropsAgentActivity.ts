import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useThreadShell, useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import {
  deriveZeropsAgentActivity,
  threadAgentActivity,
  type ZeropsAgentActivity,
} from "./agentActivity";

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

/**
 * What the Mate is up to in one chat — the chat a conversation's header
 * heads. Undefined while the chat has no shell: one not sent yet.
 */
export function useZeropsThreadActivity(
  threadRef: ScopedThreadRef | null,
): ZeropsAgentActivity | undefined {
  const thread = useThreadShell(threadRef);
  const lastVisitedAt = useUiStateStore((state) =>
    threadRef === null ? undefined : state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  return useMemo(
    () => (thread === null ? undefined : threadAgentActivity(thread, lastVisitedAt)),
    [lastVisitedAt, thread],
  );
}
