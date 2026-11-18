import type { MateMarkState } from "@t3tools/shared/brand";
import type { MateFaceCue, MateMoment } from "~/zerops/mateMoments.logic";

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
