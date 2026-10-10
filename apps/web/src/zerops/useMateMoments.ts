/**
 * A Mate's face's moments: which of its facts it greets (`mateFace`), each read from what the
 * surface already holds. Transitions are remembered from one render to the next while the face
 * stays; nothing is timed.
 */
import { useAtomValue } from "@effect/atom-react";
import { shownMateLinksAtom } from "@t3tools/client-runtime/data";
import { indexDescriptors, resolveEnvironment } from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import type { MateFaceCue } from "~/components/zerops/primitives";

import type { MateFaceWatched } from "./mateFace.logic";
import {
  arrivedCue,
  conversationCue,
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

/** A Mate's link as its face reads it: restarting, or reachable with nothing to say. */
interface MateLink {
  readonly restarting: boolean;
  readonly ready: boolean;
}

const NO_LINK: MateLink = { restarting: false, ready: false };

const descriptorsAtom = Atom.make((get) => {
  const { machines, containers } = get(shownMateLinksAtom);
  return { machines, index: indexDescriptors(machines, containers) };
});

/** One Mate's link, so a face redraws when its own link turns, not on every link's word. */
const mateLinkAtom = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make((get): MateLink => {
    if (environmentId === null) return NO_LINK;
    const { machines, index } = get(descriptorsAtom);
    const reachability = resolveEnvironment(machines, index, environmentId)?.reachability ?? null;
    return { restarting: mateRestarting(reachability), ready: mateReachable(reachability) };
  }).pipe(
    Atom.withEquality(
      (left: MateLink, right: MateLink) =>
        left.restarting === right.restarting && left.ready === right.ready,
    ),
  ),
);

/**
 * What a Mate's face watches change while it is on screen, wherever it is drawn (`mateFace`): its
 * restart and its return, a move to another project, its arrival for good.
 */
export function useMateFaceWatch(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: string | undefined;
  /** Its arrival window stands (`mateArrivingUntil`). */
  readonly arriving: boolean;
  readonly connected: boolean;
}): { readonly restarting: boolean; readonly watched: MateFaceWatched } {
  const moved = useChangeCue(input.projectId, () => undefined, movedCue);
  // Its arrival window (`mateArrivingUntil`) is HQ's fact, not the clock's: it goes once somebody
  // signs the Mate in.
  const arrived = useChangeCue(
    { arriving: input.arriving, connected: input.connected },
    () => undefined,
    arrivedCue,
    (left, right) => left.arriving === right.arriving && left.connected === right.connected,
  );
  const link = useAtomValue(mateLinkAtom(input.environmentId));
  const [beat, setBeat] = useState<RestartBeat>(() =>
    restartBeat({ waiting: false, backs: 0 }, link),
  );
  const nextBeat = restartBeat(beat, link);
  if (nextBeat !== beat) setBeat(nextBeat);
  return {
    restarting: link.restarting,
    watched: { backs: nextBeat.backs, moved, arrived },
  };
}

/**
 * The header's own events, before its Mate's (`mateFace`): opening a Mate, and a chat it shows
 * becoming durable.
 */
export function useMateHeaderCues(input: {
  readonly environmentId: EnvironmentId;
  readonly currentThreadId: ThreadId | null;
}): ReadonlyArray<MateFaceCue> {
  const navigation = useChangeCue(
    input.environmentId,
    () => ({ moment: "peek", key: `mate-open:${input.environmentId}`, arrives: true }),
    (_previous, next) => ({ moment: "peek", key: `mate-open:${next}`, arrives: true }),
  );
  const conversation = useChangeCue<ThreadId | null>(
    input.currentThreadId,
    () => undefined,
    (previous, next) => conversationCue(previous, next),
  );
  return [navigation, conversation].filter((cue): cue is MateFaceCue => cue !== undefined);
}
