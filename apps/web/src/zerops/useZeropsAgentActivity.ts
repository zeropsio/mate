import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { useThreadShell, useThreadShells } from "../state/entities";
import { hqMatesAtom, zeropsEnvironmentsAtom, type HqMatesView } from "../state/zerops";
import { useUiStateStore } from "../uiStateStore";
import {
  deriveZeropsAgentActivity,
  overviewAgentActivity,
  restingActivity,
  threadAgentActivity,
  type ZeropsAgentActivity,
} from "./agentActivity";
import { createLiveStepPacer, sameLiveStep, type ShownLiveSteps } from "./liveStep";

/** The socket phases in which a conversation read through it still stands: up, or only blinking. */
const STANDING_PHASES: ReadonlySet<EnvironmentConnectionPhase> = new Set([
  "connected",
  "reconnecting",
]);

/**
 * Every Mate's activity, keyed by environment — the left menu and the projects screen both read
 * this, so a Mate says the same thing in both (`zeropsAgentActivityOf`).
 */
export function useZeropsAgentActivity(): ReadonlyMap<EnvironmentId, ZeropsAgentActivity> {
  const threads = useThreadShells();
  const hq = useAtomValue(hqMatesAtom);
  const environments = useAtomValue(zeropsEnvironmentsAtom);
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const standing = useMemo(
    () =>
      new Set(
        environments.flatMap((environment) =>
          STANDING_PHASES.has(environment.connection.phase) ? [environment.environmentId] : [],
        ),
      ),
    [environments],
  );
  const activity = useMemo(
    () =>
      zeropsAgentActivityOf({
        hq,
        threads,
        standing,
        lastVisitedAtById: threadLastVisitedAtById,
      }),
    [hq, standing, threadLastVisitedAtById, threads],
  );
  return usePacedLiveSteps(activity);
}

/**
 * Every Mate's activity by its environment: HQ's word for each Mate it holds live; else its
 * socket's reading — a Mate or an HQ from before the overview, HQ down — at rest once the socket
 * no longer stands (a reconnecting one still does: a Mate at its first job must not fall asleep
 * because its socket blinked); else HQ's last word, at rest. An activity not at rest
 * (`remembered`) is of now.
 */
export function zeropsAgentActivityOf(input: {
  readonly hq: Pick<HqMatesView, "mates" | "current"> | null;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  /** The environments whose socket stands: up, or only blinking. */
  readonly standing: ReadonlySet<EnvironmentId>;
  readonly lastVisitedAtById: Readonly<Record<string, string>>;
}): ReadonlyMap<EnvironmentId, ZeropsAgentActivity> {
  const activity = new Map<EnvironmentId, ZeropsAgentActivity>();
  for (const [environmentId, read] of deriveZeropsAgentActivity(
    input.threads,
    input.lastVisitedAtById,
  )) {
    activity.set(environmentId, input.standing.has(environmentId) ? read : restingActivity(read));
  }
  for (const mate of input.hq?.mates?.values() ?? []) {
    if (mate.identity === undefined || mate.main === undefined) continue;
    const { environmentId } = mate.identity;
    const live = input.hq?.current === true && mate.presence.overview === "live";
    if (!live && activity.has(environmentId)) continue;
    const told = overviewAgentActivity(mate, live, input.lastVisitedAtById);
    if (told === undefined) activity.delete(environmentId);
    else activity.set(environmentId, told);
  }
  return activity;
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
