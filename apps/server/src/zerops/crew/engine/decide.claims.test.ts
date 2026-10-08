import { describe, expect, it } from "@effect/vitest";

import { CrewWorld, OPTIONS, OTHER, home, newTask, writer } from "./crewDecideFixture.ts";

const DEV = { port: 3000, command: "npm run dev" } as const;
const READ = { served: { by: "tree" }, devServer: DEV, workDir: ".crew/backend" } as const;

const claim = (w: CrewWorld) => w.state.claims.appdev?.state ?? "none";

/** A writer at work on its first task, its turn running. */
const working = (w: CrewWorld) => {
  w.apply(home(writer("backend")));
  newTask(w, "backend", "HUD");
  w.start("backend");
};

const asks = (w: CrewWorld) => w.tool("backend", { tool: "show-on-dev", reason: "See the HUD" });

/** The crewmate's turn ends and its copy is saved. */
const turnEnds = (w: CrewWorld) => {
  w.end("backend");
  w.checkpoint("backend");
};

interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const journeys: ReadonlyArray<Journey> = [
  {
    sentence:
      "Show on dev: request, Allow sends the claim turn, dev serving the copy holds it, Back to my tree releases",
    journey: (w) => {
      working(w);
      asks(w);
      const states = [claim(w)];
      turnEnds(w);
      w.press({ _tag: "claimGrant", host: "appdev" });
      w.settle("crew.claim.read", "appdev", READ);
      states.push(claim(w));
      w.run("backend");
      turnEnds(w);
      w.settle("crew.claim.read", "appdev", {
        ...READ,
        served: { by: "crewmate", handle: "backend" },
      });
      states.push(claim(w));
      w.press({ _tag: "claimRelease", host: "appdev" });
      states.push(claim(w));
      w.run("backend");
      turnEnds(w);
      w.settle("crew.claim.read", "appdev", READ);
      states.push(claim(w));
      return [states, w.turns("backend")];
    },
    expected: [
      ["requested", "starting", "held", "releasing", "none"],
      ["task", "claim-start", "claim-release"],
    ],
  },
  {
    sentence: "Allow pressed while the crewmate's turn runs is kept and sent when the turn ends",
    journey: (w) => {
      working(w);
      asks(w);
      w.press({ _tag: "claimGrant", host: "appdev" });
      w.settle("crew.claim.read", "appdev", READ);
      const kept = [claim(w), w.state.claims.appdev?.grantWaiting, w.turns("backend")];
      turnEnds(w);
      return [kept, claim(w), w.turns("backend")];
    },
    expected: [["requested", true, ["task"]], "starting", ["task", "claim-start"]],
  },
  {
    sentence: "Show on dev pressed by you asks and allows at once, as you",
    journey: (w) => {
      working(w);
      turnEnds(w);
      w.press({ _tag: "showOnDev", handle: "backend" }, OTHER);
      w.settle("crew.claim.read", "appdev", READ);
      return [claim(w), w.turns("backend"), w.lastTurnAs("backend")];
    },
    expected: ["starting", ["task", "claim-start"], OTHER],
  },
  {
    sentence: "a run that lets the crew show work on dev allows a request when its turn ends",
    journey: (w) => {
      working(w);
      w.press({ _tag: "start", ...OPTIONS, devGrant: true }, OTHER);
      w.quiet();
      asks(w);
      const asked = w.pending("crew.claim.read", "appdev");
      turnEnds(w);
      w.settle("crew.claim.read", "appdev", READ);
      return [asked, claim(w), w.lastTurnAs("backend")];
    },
    expected: [undefined, "starting", { kind: "crew", startedBy: "user-2" }],
  },
  {
    sentence: "an Allow with no dev server of the Mate's says the way out, in the section too",
    journey: (w) => {
      working(w);
      asks(w);
      turnEnds(w);
      w.press({ _tag: "claimGrant", host: "appdev" });
      w.settle("crew.claim.read", "appdev", { ...READ, devServer: null });
      return [claim(w), w.state.lastError, w.turns("backend")];
    },
    expected: [
      "requested",
      "No dev server of this Mate runs on appdev: start it in a chat with Fen, then Allow again.",
      ["task"],
    ],
  },
];

describe("crew show on dev", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
