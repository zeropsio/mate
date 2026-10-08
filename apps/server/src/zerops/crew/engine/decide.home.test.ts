import { describe, expect, it } from "@effect/vitest";

import { CrewWorld, home, newTask, writer } from "./crewDecideFixture.ts";
import { DEPLOY_POLL_FIRST_MS, THAW_OFFER_MS } from "./decide.ts";

interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const journeys: ReadonlyArray<Journey> = [
  {
    sentence: "Remove from crew keeps a copy with unlanded work until Discard",
    journey: (w) => {
      w.apply(home(writer("backend"), writer("frontend")));
      newTask(w, "backend", "HUD");
      w.start("backend");
      w.end("backend");
      w.settle("crew.checkpoint", "backend", {
        _tag: "committed",
        stats: { ahead: 2, insertions: 10, deletions: 0, dirty: false },
      });
      w.press({ _tag: "removeCrewmate", handle: "backend", discardUnlanded: false });
      const kept = [w.rejection(), w.state.order];
      w.press({ _tag: "removeCrewmate", handle: "backend", discardUnlanded: true });
      return [
        kept,
        w.state.order,
        w.task(1).state,
        w.controls("backend").at(-1),
        w.pending("crew.lane.remove", "backend") !== undefined,
      ];
    },
    expected: [
      ["unlanded-commits", ["backend", "frontend"]],
      ["frontend"],
      "discarded",
      "Archive",
      true,
    ],
  },
  {
    sentence: "an unreadable redeploy is asked less and less, then offered to the person to thaw",
    journey: (w) => {
      w.apply(home(writer("backend")));
      w.tell({ _tag: "Deploy", host: "appdev", phase: "started" }, { kind: "engine" });
      const waits: Array<number> = [];
      for (let poll = 0; poll < 3; poll += 1) {
        const wake = w.armed("deploy-poll")[0]!;
        waits.push(wake.dueAt - w.now);
        w.advance(wake.dueAt - w.now);
        w.fire("deploy-poll", "appdev");
        w.settle("crew.deploy.poll", "appdev", { phase: "unreadable" });
      }
      w.advance(THAW_OFFER_MS);
      w.fire("thaw-offer", "appdev");
      const offered = w.state.attention.map((row) => row.id);
      w.press({ _tag: "thawHost", host: "appdev" });
      w.settle("crew.recover", "appdev", { lost: [] });
      return [waits, offered, w.state.hosts.appdev?.frozenSince, w.state.attention];
    },
    expected: [
      [DEPLOY_POLL_FIRST_MS, DEPLOY_POLL_FIRST_MS * 2, DEPLOY_POLL_FIRST_MS * 4],
      ["deploy-unreadable:appdev"],
      null,
      [],
    ],
  },
];

describe("the crew home and its services", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
