/**
 * The conversation header's moments: which of its Mate's facts its face greets
 * (`mateHeaderCues`), each read from what the header already holds. Transitions are remembered
 * from one render to the next while the header stays; nothing is timed.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useState } from "react";

import type { MateFaceCue } from "~/components/zerops/primitives";
import { useEnvironmentReachability } from "~/routes/-environmentTargets";

import {
  arrivedCue,
  conversationCue,
  mateHeaderCues,
  mateReachable,
  mateRestarting,
  movedCue,
  restartBeat,
  type RestartBeat,
} from "./mateMoments.logic";

/** The cue a value's last change gave, kept while the value holds. */
export function useChangeCue<T>(
  value: T,
  initial: () => MateFaceCue | undefined,
  cueOf: (previous: T, next: T) => MateFaceCue | undefined,
  same: (left: T, right: T) => boolean = Object.is,
): MateFaceCue | undefined {
  const [seen, setSeen] = useState(() => ({ value, cue: initial() }));
  if (same(seen.value, value)) return seen.cue;
  const cue = cueOf(seen.value, value) ?? seen.cue;
  setSeen({ value, cue });
  return cue;
}

export function useMateHeaderCues(input: {
  readonly environmentId: EnvironmentId;
  readonly currentThreadId: ThreadId | null;
  readonly mate: {
    readonly projectId?: string | undefined;
    readonly arrivingUntil?: number | undefined;
    readonly connected: boolean;
  };
  readonly chats: ReadonlyArray<EnvironmentThreadShell>;
}): { readonly cues: ReadonlyArray<MateFaceCue>; readonly restarting: boolean } {
  const { currentThreadId, mate } = input;
  const navigation = useChangeCue(
    input.environmentId,
    () => ({ moment: "peek", key: `mate-open:${input.environmentId}`, arrives: true }),
    (_previous, next) => ({ moment: "peek", key: `mate-open:${next}`, arrives: true }),
  );
  const conversation = useChangeCue<ThreadId | null>(
    currentThreadId,
    () => undefined,
    (previous, next) => conversationCue(previous, next),
  );
  const moved = useChangeCue(mate.projectId, () => undefined, movedCue);
  // Its arrival window (`mateArrivingUntil`) is HQ's fact, not the clock's: it goes once somebody
  // signs the Mate in.
  const arrived = useChangeCue(
    { arriving: mate.arrivingUntil !== undefined, connected: mate.connected },
    () => undefined,
    arrivedCue,
    (left, right) => left.arriving === right.arriving && left.connected === right.connected,
  );
  const reachability = useEnvironmentReachability(input.environmentId);
  const restarting = mateRestarting(reachability);
  const link = { restarting, ready: mateReachable(reachability) };
  const [beat, setBeat] = useState<RestartBeat>(() =>
    restartBeat({ waiting: false, backs: 0 }, link),
  );
  const nextBeat = restartBeat(beat, link);
  if (nextBeat !== beat) setBeat(nextBeat);
  const shown = input.chats.find((chat) => chat.id === currentThreadId);
  return {
    restarting,
    cues: [
      navigation,
      ...mateHeaderCues({
        conversation,
        restarting,
        backs: nextBeat.backs,
        limitedThreadId: shown?.usagePause == null ? null : shown.id,
        moved,
        arrived,
      }),
    ].filter((cue): cue is MateFaceCue => cue !== undefined),
  };
}
