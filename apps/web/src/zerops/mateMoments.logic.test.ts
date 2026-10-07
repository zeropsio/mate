import type { Reachability } from "@t3tools/client-runtime/zerops/environments";
import { describe, expect, it } from "vite-plus/test";

import {
  arrivedCue,
  conversationCue,
  mateHeaderCues,
  mateRestarting,
  mateRowCues,
  movedCue,
  restartBeat,
  standUpDoneCue,
} from "./mateMoments.logic";

describe("which events a Mate's faces greet", () => {
  it.each([
    [{ kind: "failed" as const }, ["doubletake"]],
    [{ kind: "working" as const, usageLimited: true }, ["puff"]],
    [{ kind: "failed" as const, usageLimited: true }, ["doubletake", "puff"]],
    [{ kind: "done" as const }, []],
    [undefined, []],
  ])("greets the menu row's %o with %o", (activity, moments) => {
    expect(mateRowCues(activity).map((cue) => cue.moment)).toEqual(moments);
  });

  it.each([
    // A chat being started that its first message makes real: hello.
    [null, "t1", true, { moment: "wink", key: "hello:t1" }],
    // Another chat opened under the same header.
    ["t1", "t2", true, { moment: "peek", key: "open:t2", arrives: true }],
    // A header drawn after the page's first one opens onto its chat.
    [undefined, "t1", true, { moment: "peek", key: "open:t1", arrives: true }],
    // The page's first header is a reload landing: no flourish.
    [undefined, "t1", false, undefined],
    // A chat being started is no opening yet.
    ["t1", null, true, undefined],
  ] as const)(
    "greets the conversation %s → %s (a header before: %s) with %o",
    (previous, current, before, cue) => {
      expect(conversationCue(previous, current, before)).toEqual(cue);
    },
  );

  it.each([
    ["p1", "p2", { moment: "dizzy", key: "moved:p2" }],
    [undefined, "p2", undefined],
    ["p1", "p1", undefined],
    ["p1", undefined, undefined],
  ] as const)("greets a project %s → %s with %o", (previous, current, cue) => {
    expect(movedCue(previous, current)).toEqual(cue);
  });

  it.each([
    [true, true, false, true, "stretch"],
    // Its window gone while its container is not up is no arrival.
    [true, true, false, false, undefined],
    [false, true, false, true, undefined],
  ])(
    "greets arriving %s (connected %s) → arriving %s (connected %s) with %s",
    (wasArriving, wasConnected, arriving, connected, moment) => {
      expect(
        arrivedCue({ arriving: wasArriving, connected: wasConnected }, { arriving, connected })
          ?.moment,
      ).toBe(moment);
    },
  );

  it.each<[Reachability | null, boolean]>([
    [{ kind: "container", container: { level: "restarting", by: "you", overdue: false } }, true],
    [{ kind: "ready", notice: { level: "restarting", by: "platform", overdue: false } }, true],
    [{ kind: "ready", notice: { level: "updating", overdue: false } }, false],
    [{ kind: "ready", notice: null }, false],
    [null, false],
  ])("reads %o as restarting: %s", (reachability, restarting) => {
    expect(mateRestarting(reachability)).toBe(restarting);
  });

  it("orders the header's events, the conversation first", () => {
    expect(
      mateHeaderCues({
        conversation: { moment: "peek", key: "open:t1", arrives: true },
        restarting: true,
        backs: 2,
        limitedThreadId: "t1",
        moved: { moment: "dizzy", key: "moved:p2" },
        arrived: { moment: "stretch", key: "arrived" },
      }).map((cue) => cue.moment),
    ).toEqual(["peek", "sneeze", "back", "puff", "dizzy", "stretch"]);
    expect(
      mateHeaderCues({
        conversation: undefined,
        restarting: false,
        backs: 0,
        limitedThreadId: null,
        moved: undefined,
        arrived: undefined,
      }),
    ).toEqual([]);
  });

  it("counts a restart back only once its Mate is reachable again", () => {
    let beat = { waiting: false, backs: 0 };
    beat = restartBeat(beat, { restarting: false, ready: true });
    expect(beat.backs).toBe(0);
    beat = restartBeat(beat, { restarting: true, ready: false });
    // Reconnecting after the restart is still the restart.
    beat = restartBeat(beat, { restarting: false, ready: false });
    expect(beat.backs).toBe(0);
    beat = restartBeat(beat, { restarting: false, ready: true });
    expect(beat.backs).toBe(1);
    expect(restartBeat(beat, { restarting: false, ready: true })).toBe(beat);
  });

  it.each([
    ["standing-up", "question", "dance"],
    ["standing-up", "standing-up", undefined],
    ["sign-in", "question", undefined],
  ])("greets a stand-up %s → %s with %s", (previous, next, moment) => {
    expect(standUpDoneCue(previous, next)?.moment).toBe(moment);
  });
});
