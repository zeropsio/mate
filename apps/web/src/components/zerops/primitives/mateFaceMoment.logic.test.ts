import type { MateMarkState } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import {
  cueMoments,
  endMoment,
  mateFaceArrival,
  startMoments,
  type MateFaceCue,
  type MateMoment,
} from "./mateFaceMoment.logic";

const cue = (moment: MateMoment, key: string): MateFaceCue => ({ moment, key });

describe("mate face moments", () => {
  it("takes the facts a face mounts with as already seen: a reload replays nothing", () => {
    const player = startMoments([cue("doubletake", "failed")], true);
    expect(player.playing).toBeUndefined();
    expect(cueMoments(player, [cue("doubletake", "failed")], true).playing).toBeUndefined();
  });

  it("plays its own arrival on its first paint, unless it may not", () => {
    const opened: MateFaceCue = { moment: "peek", key: "open:t1", arrives: true };
    expect(startMoments([opened], true).playing).toEqual(opened);
    expect(startMoments([opened], false).playing).toBeUndefined();
  });

  it("plays a fact that becomes true while the face is watched, once", () => {
    const seen = cueMoments(startMoments([], true), [cue("boing", "q")], true);
    expect(seen.playing).toEqual(cue("boing", "q"));
    // A re-render hands the same fact again: nothing restarts.
    const ended = endMoment(cueMoments(seen, [cue("boing", "q")], true));
    expect(ended.playing).toBeUndefined();
    expect(cueMoments(ended, [cue("boing", "q")], true).playing).toBeUndefined();
    // Gone and back again is a new event.
    const gone = cueMoments(ended, [], true);
    expect(cueMoments(gone, [cue("boing", "q")], true).playing).toEqual(cue("boing", "q"));
  });

  it("greets one event per change, the first its caller names", () => {
    const player = cueMoments(
      startMoments([], true),
      [cue("doubletake", "failed"), cue("boing", "arrival")],
      true,
    );
    expect(player.playing).toEqual(cue("doubletake", "failed"));
    expect(endMoment(player).playing).toBeUndefined();
  });

  it("never interrupts a moment: the newest event waits for it, older waiting ones are dropped", () => {
    let player = cueMoments(startMoments([], true), [cue("dance", "done")], true);
    player = cueMoments(player, [cue("dance", "done"), cue("doubletake", "failed")], true);
    player = cueMoments(player, [cue("nod", "sleep")], true);
    expect(player.playing).toEqual(cue("dance", "done"));
    player = endMoment(player);
    expect(player.playing).toEqual(cue("nod", "sleep"));
    expect(endMoment(player).playing).toBeUndefined();
  });

  it("draws every start afresh, even the same moment twice", () => {
    let player = cueMoments(startMoments([], true), [cue("boing", "a")], true);
    player = cueMoments(player, [cue("boing", "b")], true);
    const first = player.runs;
    expect(endMoment(player).runs).toBe(first + 1);
  });

  // Reduced motion, or a pose that only stands in until the Mate's state is read: the face shows
  // its still after-pose, and the event is not played later either.
  it("passes over an event it may not play, and never plays it afterwards", () => {
    const passed = cueMoments(startMoments([], true), [cue("dizzy", "p2")], false);
    expect(passed.playing).toBeUndefined();
    expect(cueMoments(passed, [cue("dizzy", "p2")], true).playing).toBeUndefined();
    expect(cueMoments(passed, [cue("dizzy", "p3")], true).playing).toEqual(cue("dizzy", "p3"));
  });

  it("drops a waiting event once it may no longer play", () => {
    let player = cueMoments(startMoments([], true), [cue("dance", "done")], true);
    player = cueMoments(player, [cue("doubletake", "failed")], true);
    player = cueMoments(player, [cue("doubletake", "failed")], false);
    expect(endMoment(player).playing).toBeUndefined();
  });

  // The menu row greets the changes of pose it watches: a question raised, a run done after work
  // or a question, falling asleep while awake. Marking a Mate unread (idle to done) is no run
  // finishing, and waking to wait on a question already asked is no question raised.
  it.each<[MateMarkState, MateMarkState, MateMoment | undefined]>([
    ["working", "done", "dance"],
    ["needs", "done", "dance"],
    ["idle", "done", undefined],
    ["working", "needs", "boing"],
    ["idle", "needs", "boing"],
    ["needs", "needs", undefined],
    ["working", "sleep", "nod"],
    ["idle", "sleep", "nod"],
    ["waking", "sleep", undefined],
    ["sleep", "waking", undefined],
    ["done", "idle", undefined],
    ["idle", "working", undefined],
  ])("greets %s → %s with %s", (previous, next, moment) => {
    expect(mateFaceArrival(previous, next)).toBe(moment);
  });
});
