import type { MateMarkState } from "@t3tools/shared/brand";

/**
 * A moment: a one-shot piece of body language a Mate's face plays for an event it watched
 * happen, then stands exactly as its state draws it again. How each one moves is the
 * stylesheet's (`MateFaceMoments.css`); which event plays which is its caller's.
 */
export const MATE_MOMENTS = [
  /** Hello: a little hop, a head tilt, a wink. */
  "wink",
  /** A conversation opening: it rises from below its box, looks about, finds you, pops up. */
  "peek",
  /** A question raised: a high jump that lands with a splat and pops back. */
  "boing",
  /** Done, merged, deployed: a hop left, a hop right, a pirouette. */
  "dance",
  /** An error: a casual glance, then a snapped second look and a jump back. */
  "doubletake",
  /** Moved to another project: three blurred turns, a stagger with crossed eyes. */
  "dizzy",
  /** A restart: two inhales, a sneeze that blows it backwards, a hop home. */
  "sneeze",
  /** Back from a restart: a blink, eyes wide, one bright hop. */
  "back",
  /** A first start: stretched far too tall, twanging back like a rubber band. */
  "stretch",
  /** A provider limit: it deflates with a sigh and one last comic puff. */
  "puff",
  /** Falling asleep or not answering: it nods off as a zzz drifts up. */
  "nod",
] as const;

export type MateMoment = (typeof MATE_MOMENTS)[number];

/**
 * A fact a face greets when it becomes true while the face is on screen: the moment it plays and
 * the fact's identity. A fact the face mounts with, or keeps holding, plays nothing — so a reload,
 * a remount or a re-render replays nothing. `arrives`: the fact is the face's own arrival (a
 * conversation opened), which plays on the face's first paint too.
 */
export interface MateFaceCue {
  readonly moment: MateMoment;
  readonly key: string;
  readonly arrives?: true;
}

export interface MateMomentPlayer {
  /** The facts the face was last handed. */
  readonly present: ReadonlySet<string>;
  readonly playing: MateFaceCue | undefined;
  /** The newest event that arrived while another moment played. */
  readonly next: MateFaceCue | undefined;
  /** How many moments have started: each start is drawn afresh, even the same moment again. */
  readonly runs: number;
}

/**
 * A face's first paint. Facts it mounts with happened before anyone watched; only its own
 * arrival plays, when it may (`live`: motion allowed and the state read, not standing in).
 */
export function startMoments(cues: ReadonlyArray<MateFaceCue>, live: boolean): MateMomentPlayer {
  const arrival = live ? cues.find((cue) => cue.arrives === true) : undefined;
  return {
    present: new Set(cues.map((cue) => cue.key)),
    playing: arrival,
    next: undefined,
    runs: arrival === undefined ? 0 : 1,
  };
}

/**
 * The facts a face is handed now. The first one that was not there before is an event: it plays
 * when it may — never interrupting the moment already playing: it waits, and a newer event
 * replaces it. One it may not play is passed over, and a fact that only holds on plays nothing.
 */
export function cueMoments(
  player: MateMomentPlayer,
  cues: ReadonlyArray<MateFaceCue>,
  live: boolean,
): MateMomentPlayer {
  const fresh = cues.find((cue) => !player.present.has(cue.key));
  const present = new Set(cues.map((cue) => cue.key));
  if (fresh === undefined || !live)
    return { ...player, present, next: live ? player.next : undefined };
  if (player.playing) return { ...player, present, next: fresh };
  return { present, playing: fresh, next: undefined, runs: player.runs + 1 };
}

/** The moment playing has run its course; the event waiting, if any, plays next. */
export function endMoment(player: MateMomentPlayer): MateMomentPlayer {
  return player.next === undefined
    ? { ...player, playing: undefined }
    : { ...player, playing: player.next, next: undefined, runs: player.runs + 1 };
}

const AWAKE: ReadonlySet<MateMarkState> = new Set(["idle", "working", "needs", "done"]);

/**
 * The moment a change of pose a face watches is greeted with: a question raised, a run done
 * after work or a question, falling asleep while awake. Marking a Mate unread (idle to done) is
 * no run finishing, and waking to wait on a question already asked is no question raised.
 */
export function mateFaceArrival(
  previous: MateMarkState,
  next: MateMarkState,
): MateMoment | undefined {
  if (next === "done") return previous === "working" || previous === "needs" ? "dance" : undefined;
  if (next === "needs") return previous === "needs" ? undefined : "boing";
  if (next === "sleep") return AWAKE.has(previous) ? "nod" : undefined;
  return undefined;
}
