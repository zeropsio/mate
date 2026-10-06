import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { matesAttention, type MateAttentionRead } from "@t3tools/client-runtime/data";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { useThreadShell, useThreadShells } from "../state/entities";
import { hqMatesAtom, zeropsEnvironmentsAtom } from "../state/zerops";
import { useUiStateStore } from "../uiStateStore";
import { threadAgentActivity, type ZeropsAgentActivity } from "./agentActivity";
import { createLiveStepPacer, sameLiveStep, type ShownLiveSteps } from "./liveStep";
import { mateEnvironmentOf, matesActivityOf, type MatesActivityInput } from "./mateActivity";
import { useAccountOrgId, useProjection } from "./ZeropsAccountData";

/** The socket phases in which a conversation read through it still stands: up, or only blinking. */
const STANDING_PHASES: ReadonlySet<EnvironmentConnectionPhase> = new Set([
  "connected",
  "reconnecting",
]);

/** What each Mate is up to, found by its project or by the environment it runs in. */
export interface MatesActivity {
  readonly ofProject: (projectId: string) => ZeropsAgentActivity | undefined;
  readonly ofEnvironment: (environmentId: EnvironmentId) => ZeropsAgentActivity | undefined;
}

const NO_ATTENTION_READ: Readonly<Record<string, MateAttentionRead>> = {};
const NO_ATTENTION = Atom.make(NO_ATTENTION_READ);

/**
 * Every Mate's activity (`matesActivityOf`): the left menu, the projects screen and a
 * conversation's panel all read this, so a Mate says the same thing in each. Each Mate is read off
 * its attention as the account's store holds it (`matesAttention`) — the Mates HQ places, and those
 * this page has open.
 */
export function useMatesActivity(): MatesActivity {
  const threads = useThreadShells();
  const hq = useAtomValue(hqMatesAtom);
  const environments = useAtomValue(zeropsEnvironmentsAtom);
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const orgId = useAccountOrgId();
  const { sockets, standing } = useMemo(() => {
    const sockets = new Map<string, EnvironmentId>();
    const standing = new Set<EnvironmentId>();
    for (const environment of environments) {
      if (typeof environment.zeropsProjectId === "string")
        sockets.set(environment.zeropsProjectId, environment.environmentId);
      if (STANDING_PHASES.has(environment.connection.phase))
        standing.add(environment.environmentId);
    }
    return { sockets, standing };
  }, [environments]);
  const projectIds = useMemo(() => {
    // The Mates HQ places, where HQ named any, and those this page has open.
    const ids = new Set(sockets.keys());
    if (hq !== null) for (const projectId of hq.mates.keys()) ids.add(projectId);
    return [...ids].toSorted();
  }, [hq, sockets]);
  const attention = useProjection(
    matesAttention,
    orgId === null ? null : { orgId, projectIds },
    NO_ATTENTION,
  );
  const input = useMemo(
    () => ({
      projectIds,
      attention,
      overviews: hq?.mates ?? null,
      hqCurrent: hq?.current === true,
      threads,
      sockets,
      standing,
      lastVisitedAtById: threadLastVisitedAtById,
    }),
    [attention, hq, projectIds, sockets, standing, threadLastVisitedAtById, threads],
  );
  // Each Mate's entry stands while what it says does (`matesActivityOf`): the reading changes
  // only when some Mate's does, not on every event of a streaming chat's shell.
  const [sharer] = useState(createActivitySharer);
  const read = useMemo(() => sharer(input), [input, sharer]);
  const activity = usePacedLiveSteps(read);
  const overviews = input.overviews;
  return useMemo(() => {
    const byEnvironment = new Map<EnvironmentId, ZeropsAgentActivity>();
    for (const [projectId, entry] of activity) {
      const environmentId = mateEnvironmentOf({ attention, overviews, sockets }, projectId);
      if (environmentId !== undefined) byEnvironment.set(environmentId, entry);
    }
    return {
      ofProject: (projectId) => activity.get(projectId),
      ofEnvironment: (environmentId) => byEnvironment.get(environmentId),
    };
  }, [activity, attention, overviews, sockets]);
}

/** `matesActivityOf` over successive inputs, each read sharing what it can with the last. */
function createActivitySharer(): (
  input: MatesActivityInput,
) => ReadonlyMap<string, ZeropsAgentActivity> {
  let last: ReadonlyMap<string, ZeropsAgentActivity> | undefined;
  return (input) => {
    last = matesActivityOf(input, last);
    return last;
  };
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
