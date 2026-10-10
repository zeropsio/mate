/**
 * Which facts a Mate's faces greet with a moment (`MateFaceCue`), read from the projections the
 * surfaces already hold — nothing here reads anything remote. A cue is a fact that holds now; the
 * face plays it when it becomes true while the face is on screen (`mateFaceMoment.logic.ts`).
 */
import type { Reachability } from "@t3tools/client-runtime/zerops/environments";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

import type { MateFaceCue } from "~/components/zerops/primitives/MateFace";

/**
 * The menu row's own events beside the changes of pose its face greets (a question, a run done,
 * falling asleep): a run that failed, and a provider limit. They outrank the pose they bring — a
 * failure wears the needs face and a limit sleeps, but neither is a question nor a doze.
 */
export function mateRowCues(
  activity:
    | { readonly kind: ThreadStatusKind; readonly usageLimited?: boolean | undefined }
    | undefined,
): ReadonlyArray<MateFaceCue> {
  if (activity === undefined) return [];
  return [
    ...(activity.kind === "failed" ? [{ moment: "doubletake", key: "failed" } as const] : []),
    ...(activity.usageLimited === true ? [{ moment: "puff", key: "limit" } as const] : []),
  ];
}

/** A chat becoming durable after its first message is a hello; Mate navigation owns arrival. */
export function conversationCue(
  previous: string | null | undefined,
  current: string | null,
): MateFaceCue | undefined {
  return previous === null && current !== null
    ? { moment: "wink", key: `hello:${current}` }
    : undefined;
}

/** A Mate's project changing under a face that watched it: moved somewhere new. */
export function movedCue(
  previous: string | undefined,
  current: string | undefined,
): MateFaceCue | undefined {
  return previous === undefined || current === undefined || previous === current
    ? undefined
    : { moment: "dizzy", key: `moved:${current}` };
}

/**
 * A Mate arriving for good while watched: its arrival window gone (`mateArrivingUntil`) with its
 * container connected — somebody signed it in, or its agent needs nobody to.
 */
export function arrivedCue(
  previous: { readonly arriving: boolean; readonly connected: boolean },
  current: { readonly arriving: boolean; readonly connected: boolean },
): MateFaceCue | undefined {
  return previous.arriving && !current.arriving && current.connected
    ? { moment: "stretch", key: "arrived" }
    : undefined;
}

/** A stand-up finishing under the face that watched it: a satisfied little dance. */
export function standUpDoneCue(previous: string, next: string): MateFaceCue | undefined {
  return previous === "standing-up" && next === "question"
    ? { moment: "dance", key: "stood-up" }
    : undefined;
}

/** Whether a Mate's container is restarting, said by its link's verdict either way it can be. */
export function mateRestarting(reachability: Reachability | null): boolean {
  if (reachability === null) return false;
  if (reachability.kind === "container") return reachability.container.level === "restarting";
  return reachability.kind === "ready" && reachability.notice?.level === "restarting";
}

/** Where a restart is, for the beat it ends on: how many restarts came back while watched. */
export interface RestartBeat {
  readonly waiting: boolean;
  readonly backs: number;
}

/**
 * A restart seen while watched waits for its Mate to be reachable again — its link ready with
 * nothing left to say — and that is a "back". A reconnect between the two is still the restart.
 */
export function restartBeat(
  beat: RestartBeat,
  link: { readonly restarting: boolean; readonly ready: boolean },
): RestartBeat {
  if (link.restarting) return beat.waiting ? beat : { ...beat, waiting: true };
  if (beat.waiting && link.ready) return { waiting: false, backs: beat.backs + 1 };
  return beat;
}

/** Whether a Mate's link is up with nothing to say: reachable. */
export function mateReachable(reachability: Reachability | null): boolean {
  return reachability?.kind === "ready" && reachability.notice === null;
}

/**
 * The events a Mate's face watched, the one that wins first: the conversation a header shows, a
 * restart, its return, a move, a first arrival. A provider limit and a failure are the Mate's own
 * (`mateRowCues`), read with these wherever its face is (`mateFace`).
 */
export function mateHeaderCues(input: {
  readonly conversation: MateFaceCue | undefined;
  readonly restarting: boolean;
  /** How many restarts came back while the face watched (`restartBeat`). */
  readonly backs: number;
  readonly moved: MateFaceCue | undefined;
  readonly arrived: MateFaceCue | undefined;
}): ReadonlyArray<MateFaceCue> {
  const cues: Array<MateFaceCue | undefined> = [
    input.conversation,
    input.restarting ? { moment: "sneeze", key: "restart" } : undefined,
    input.backs === 0 ? undefined : { moment: "back", key: `back:${input.backs}` },
    input.moved,
    input.arrived,
  ];
  return cues.filter((cue): cue is MateFaceCue => cue !== undefined);
}
