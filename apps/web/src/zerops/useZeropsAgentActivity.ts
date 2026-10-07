import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { useThreadShell } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { threadAgentActivity, type ZeropsAgentActivity } from "./agentActivity";
import { createLiveStepPacer, sameLiveStep, type ShownLiveSteps } from "./liveStep";
import { mateActivityAtom, matesActivityAtom, matesMenuActivityAtom } from "./mateActivityAtoms";

/** What each Mate is up to, found by its project or by the environment it runs in. */
export interface MatesActivity {
  readonly ofProject: (projectId: string) => ZeropsAgentActivity | undefined;
  readonly ofEnvironment: (environmentId: EnvironmentId) => ZeropsAgentActivity | undefined;
}

/** Enumeration is composed from stable project readers; the menu asks only for order/count facts. */
export function useMatesActivity(menu = false): MatesActivity {
  const read = useAtomValue(menu ? matesMenuActivityAtom : matesActivityAtom);
  const activity = usePacedLiveSteps(read);
  return useMemo(
    () => ({
      ofProject: (projectId: string) => activity.get(projectId),
      ofEnvironment: (environmentId: EnvironmentId) =>
        [...activity.values()].find(
          (entry) =>
            entry.threadKey === scopedThreadKey({ environmentId, threadId: entry.threadId }),
        ),
    }),
    [activity],
  );
}

export function useProjectMateActivity(projectId: string): ZeropsAgentActivity | undefined {
  const activity = useAtomValue(mateActivityAtom(projectId));
  const entries = useMemo(
    () =>
      activity === undefined
        ? new Map<string, ZeropsAgentActivity>()
        : new Map([[projectId, activity]]),
    [activity, projectId],
  );
  return usePacedLiveSteps(entries).get(projectId);
}

/**
 * The activity with each working row's live step paced (`paceLiveStep`): a
 * row's step line changes at most once a hold, however fast its Mate's steps
 * come, and always to the latest. The step itself changes only when a step
 * does — the server relays nothing else — so this only calms a burst.
 */
export function usePacedLiveSteps<K>(
  activity: ReadonlyMap<K, ZeropsAgentActivity>,
): ReadonlyMap<K, ZeropsAgentActivity> {
  const [shown, setShown] = useState<ShownLiveSteps<K>>(() => new Map());
  const [pacer] = useState(() => createLiveStepPacer<K>(setShown));
  useEffect(() => () => pacer.dispose(), [pacer]);
  // Before paint: a step allowed now never shows its predecessor for a frame.
  useLayoutEffect(() => {
    pacer.update(new Map([...activity].map(([key, entry]) => [key, entry.liveStep] as const)));
  }, [pacer, activity]);
  return useMemo(() => {
    let held: Map<K, ZeropsAgentActivity> | null = null;
    for (const [key, entry] of activity) {
      const step = shown.get(key)?.step;
      if (
        entry.liveStep === undefined ||
        step === undefined ||
        sameLiveStep(step, entry.liveStep)
      ) {
        continue;
      }
      held ??= new Map(activity);
      held.set(key, { ...entry, liveStep: step });
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
