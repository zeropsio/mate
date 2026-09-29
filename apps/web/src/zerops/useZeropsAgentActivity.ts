import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { useThreadShell, useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import {
  deriveZeropsAgentActivity,
  threadAgentActivity,
  type ZeropsAgentActivity,
} from "./agentActivity";
import { createLiveStepPacer, sameLiveStep, type ShownLiveSteps } from "./liveStep";

/**
 * Every connected Mate's activity, keyed by environment — the left menu and
 * the projects screen both read this, so a Mate says the same thing in both.
 */
export function useZeropsAgentActivity(): ReadonlyMap<EnvironmentId, ZeropsAgentActivity> {
  const threads = useThreadShells();
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const activity = useMemo(
    () => deriveZeropsAgentActivity(threads, threadLastVisitedAtById),
    [threadLastVisitedAtById, threads],
  );
  return usePacedLiveSteps(activity);
}

const NOTHING_SHOWN: ShownLiveSteps<EnvironmentId> = new Map();

/**
 * The activity with each working row's live step paced (`paceLiveStep`): a
 * row's step line changes at most once a hold, however fast its Mate's steps
 * come, and always to the latest. The step itself changes only when a step
 * does — the server relays nothing else — so this only calms a burst.
 */
export function usePacedLiveSteps(
  activity: ReadonlyMap<EnvironmentId, ZeropsAgentActivity>,
): ReadonlyMap<EnvironmentId, ZeropsAgentActivity> {
  const [shown, setShown] = useState(NOTHING_SHOWN);
  const [pacer] = useState(() => createLiveStepPacer<EnvironmentId>(setShown));
  useEffect(() => () => pacer.dispose(), [pacer]);
  // Before paint: a step allowed now never shows its predecessor for a frame.
  useLayoutEffect(() => {
    pacer.update(new Map([...activity].map(([key, entry]) => [key, entry.liveStep] as const)));
  }, [pacer, activity]);
  return useMemo(() => {
    let held: Map<EnvironmentId, ZeropsAgentActivity> | null = null;
    for (const [environmentId, entry] of activity) {
      const step = shown.get(environmentId)?.step;
      if (
        entry.liveStep === undefined ||
        step === undefined ||
        sameLiveStep(step, entry.liveStep)
      ) {
        continue;
      }
      held ??= new Map(activity);
      held.set(environmentId, { ...entry, liveStep: step });
    }
    return held ?? activity;
  }, [activity, shown]);
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
