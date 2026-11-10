/**
 * One travel for everything a change of a run's card moves (2026-11-10: a
 * line landing grew the history at once while the slot under it eased shut,
 * and the card's bottom edge went 112 px down and 45 back; its rows glided on
 * one curve while its heights eased on another, and a pill went down, up and
 * down again). What changes in one draw — the slot's room, the history's, the
 * card's own, the rows a landing moves — is known before anything moves, and
 * all of it goes by one share of its way (`travelProgress`): its time and its
 * curve are set by the farthest any of it goes (`travelTiming`), so every edge
 * travels once, the same way throughout, and none faster than a frame shows.
 *
 * A travel is open while the draw that started it is still being heard — its
 * layout effects, and the observers' turn after them — and timed once that
 * turn ends, before the frame. Its share is read once a frame, by the frame's
 * own time: a box eased by the page's code and a row's glide, which the
 * browser draws, stand at the same share in every frame, and a frame that
 * comes late moves them no further than one on time would (`travelElapsed`).
 */
import { travelElapsed, travelProgress, travelTiming } from "./runMotion.logic";

export interface Travel {
  /**
   * A box of it grows by `px` (shrinks, below zero). The farthest any goes sets
   * its time and its curve — and so does what they come to together: a card's
   * bottom edge goes by the sum of its history's and its slot's.
   */
  readonly reach: (px: number) => void;
  /**
   * A glide the browser draws goes `px` far by its share: `glide` runs over
   * `RIDE_MS` on a straight line, and stands where the travel puts it.
   */
  readonly ride: (glide: Animation, px: number) => void;
  /**
   * Something it moves goes `px` far on screen in all, by more than one of its
   * moves: a row gliding up as the scroll that holds it gives the slot room.
   */
  readonly far: (px: number) => void;
  /** The share of its way it has gone in the frame at `now`: 0 at its first, 1 once there. */
  readonly progress: (now: number) => number;
}

export interface Travels {
  /** The travel of what changes in this draw. */
  readonly current: () => Travel;
}

/** How long a glide that rides a travel says it runs: the travel sets where in it it stands. */
export const RIDE_MS = 1000;

export function createTravels(): Travels {
  let open: Travel | null = null;
  return {
    current: () => {
      if (open !== null) return open;
      let farthest = 0;
      let together = 0;
      let timing: ReturnType<typeof travelTiming> | null = null;
      // Its time so far, the frame it was last read in, and its share then.
      let elapsed = 0;
      let last: number | null = null;
      let share = 0;
      let riders: Animation[] = [];
      let frame = 0;
      const progress = (now: number) => {
        // Read before its turn ended (a frame that came first): it has not set off.
        if (timing === null) return 0;
        if (last === now) return share;
        if (last !== null) elapsed = travelElapsed(elapsed, now - last);
        last = now;
        share = travelProgress(elapsed / timing.durationMs, timing.steepness);
        // A glide stopped since (a new move took its row over) is no longer its.
        riders = riders.filter((glide) => glide.playState !== "idle");
        for (const glide of riders) {
          if (share >= 1) glide.finish();
          else glide.currentTime = share * RIDE_MS;
        }
        if (share >= 1) riders = [];
        return share;
      };
      // Its glides move in every frame, whether or not a box asks where it stands.
      const tick = (now: number) => {
        frame = 0;
        progress(now);
        if (riders.length > 0) frame = requestAnimationFrame(tick);
      };
      const travel: Travel = {
        reach: (px) => {
          farthest = Math.max(farthest, Math.abs(px));
          together += px;
        },
        ride: (glide, px) => {
          farthest = Math.max(farthest, Math.abs(px));
          glide.pause();
          glide.currentTime = share * RIDE_MS;
          riders.push(glide);
          if (frame === 0) frame = requestAnimationFrame(tick);
        },
        far: (px) => {
          farthest = Math.max(farthest, Math.abs(px));
        },
        progress,
      };
      open = travel;
      queueMicrotask(() => {
        open = null;
        timing = travelTiming(Math.max(farthest, Math.abs(together)));
      });
      return travel;
    },
  };
}
