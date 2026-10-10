/**
 * A Mate's face, one reading for every place that draws it — its row in the menu, the top bar of
 * its chat, the menu's waiting stack: what it wears, the events it greets, whether it plays a
 * restart, and whether what it wears is read or stands in. The face is the state ("no status
 * words"), so one Mate wears the same face everywhere at the same moment; a surface keeps only its
 * size and shape.
 */
import type { MatePoseFacts } from "@t3tools/client-runtime/zerops";
import type { MateMarkState } from "@t3tools/shared/brand";

import type { MateFaceCue } from "~/components/zerops/primitives/MateFace";

import { mateFaceOf, type ZeropsAgentActivity } from "./agentActivity";
import { mateHeaderCues, mateRowCues } from "./mateMoments.logic";

/** What a face watched change while it was on screen (`useMateFaceWatch`). */
export interface MateFaceWatched {
  /** How many restarts came back while watched (`restartBeat`). */
  readonly backs: number;
  readonly moved: MateFaceCue | undefined;
  readonly arrived: MateFaceCue | undefined;
}

export interface MateFaceFacts {
  /** It is up (`mateAwake`): its container runs, or HQ holds its link open. */
  readonly connected: boolean;
  /** What the Mate does, across its chats (`mateActivityAtom`): HQ's word, or its socket's. */
  readonly activity: ZeropsAgentActivity | undefined;
  /** Its own change waits on the person's review (`mateReviewWaits`). */
  readonly reviewWaits: boolean;
  /** The viewer's own Mate (HQ's `waitsOnViewer`). */
  readonly mine: boolean;
  /** Where it is in its life (`mateFaceFor`): waking while it arrives, asleep while it goes. */
  readonly pose?: MatePoseFacts | undefined;
  /** Its container is restarting (`mateRestarting`). */
  readonly restarting: boolean;
  readonly watched?: MateFaceWatched | undefined;
}

export interface MateFaceRead {
  readonly state: MateMarkState;
  /** The events it greets, the one that wins first. */
  readonly cues: ReadonlyArray<MateFaceCue>;
  readonly restarting: boolean;
  /** Its state is read, not a stand-in until it is: only then does it greet a change. */
  readonly known: boolean;
}

const UNWATCHED: MateFaceWatched = { backs: 0, moved: undefined, arrived: undefined };

export function mateFace(facts: MateFaceFacts): MateFaceRead {
  const { activity } = facts;
  const watched = facts.watched ?? UNWATCHED;
  return {
    state: mateFaceOf(facts),
    cues: [
      ...mateHeaderCues({
        conversation: undefined,
        restarting: facts.restarting,
        backs: watched.backs,
        moved: watched.moved,
        arrived: watched.arrived,
      }),
      ...mateRowCues(activity),
    ],
    restarting: facts.restarting,
    known: activity !== undefined && activity.remembered !== true,
  };
}
