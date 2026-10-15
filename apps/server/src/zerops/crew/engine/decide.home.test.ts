import { describe, expect, it } from "@effect/vitest";

import { CrewWorld, home, newTask, reader, writer } from "./crewDecideFixture.ts";
import { DEFAULT_CREW_TIMING } from "./state.ts";

interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const journeys: ReadonlyArray<Journey> = [
  {
    sentence:
      "crew ports: Apply gives each writer one, Run and Stop its app, Add crew ports proposes more",
    journey: (w) => {
      w.tell(
        {
          _tag: "Press",
          press: { _tag: "apply" },
          door: { refusal: null },
          home: home(writer("backend"), writer("frontend")),
          hosts: { appdev: { crewPorts: [3001], integration: { branch: "main", head: "h1" } } },
        },
        { kind: "person", subject: "user-1" },
      );
      return [
        w.state.hosts.appdev?.integration,
        w.state.hosts.appdev?.crewPorts,
        w.state.members.backend?.crewPort,
        w.state.members.frontend?.crewPort,
      ];
    },
    expected: [{ branch: "main", head: "h1" }, [{ port: 3001, routed: null }], 3001, null],
  },
  {
    sentence: "a missing copy comes back at boot from its recorded branch, its work kept",
    journey: (w) => {
      w.apply(home(writer("backend")));
      w.tell({ _tag: "Recovered", bootId: "boot-2" as never }, { kind: "engine" });
      w.settle("crew.sweep", "backend", { swept: false, copy: { _tag: "missing" } });
      const missing = w.state.members.backend!.lane?.state;
      w.settle("crew.recover", "appdev", { lost: [], losses: [] });
      return [missing, w.state.members.backend!.lane?.state];
    },
    expected: ["missing", "ready"],
  },
  {
    sentence: "a crew app a redeploy stopped runs again once its copy is back, a lost copy's not",
    journey: (w) => {
      const run = { run: "npm run dev" };
      w.apply(home(writer("backend", run), writer("frontend", run), writer("api", run)));
      for (const handle of ["backend", "api"]) {
        w.press({ _tag: "appRun", handle });
        w.settle("crew.app.run", handle, { state: "running" });
      }
      w.tell({ _tag: "Deploy", host: "appdev", phase: "started" }, { kind: "engine" });
      w.tell({ _tag: "Deploy", host: "appdev", phase: "ended" }, { kind: "engine" });
      const during = w.pending("crew.app.run") !== undefined;
      w.settle("crew.recover", "appdev", { lost: ["api"], losses: [] });
      const again = w.pending("crew.app.run", "backend")?.payload;
      return [
        during,
        again?.kind === "crew.app.run" ? again.command : undefined,
        w.pending("crew.app.run", "frontend") !== undefined,
        w.pending("crew.app.run", "api") !== undefined,
      ];
    },
    expected: [false, "npm run dev", false, false],
  },
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
    sentence: "the first crewmate added to a crew whose last one was removed joins it",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      w.press({ _tag: "removeCrewmate", handle: "reviewer", discardUnlanded: false });
      const emptied = [w.rejection(), w.state.order];
      w.apply(home(reader("pip")));
      return [emptied, w.state.order];
    },
    expected: [[undefined, []], ["pip"]],
  },
  {
    sentence: "an unreadable redeploy is asked less and less, then offered to the person to thaw",
    journey: (w) => {
      w.apply(home(writer("backend")));
      w.tell({ _tag: "Deploy", host: "appdev", phase: "started" }, { kind: "engine" });
      // A restart cut the redeploy off: its end is read at boot, then again, backing off.
      w.tell({ _tag: "Recovered", bootId: "boot-2" as never }, { kind: "engine" });
      w.settle("crew.deploy.poll", "appdev", { phase: "unreadable" });
      const waits: Array<number> = [];
      for (let poll = 0; poll < 3; poll += 1) {
        const wake = w.armed("deploy-poll")[0]!;
        waits.push(wake.dueAt - w.now);
        w.advance(wake.dueAt - w.now);
        w.fire("deploy-poll", "appdev");
        w.settle("crew.deploy.poll", "appdev", { phase: "unreadable" });
      }
      w.advance(DEFAULT_CREW_TIMING.thawOfferMs);
      w.fire("deploy-poll", "appdev");
      w.settle("crew.deploy.poll", "appdev", { phase: "unreadable" });
      const offered = w.state.attention.map((row) => row.id);
      w.press({ _tag: "thawHost", host: "appdev" });
      w.settle("crew.recover", "appdev", { lost: [] });
      return [waits, offered, w.state.hosts.appdev?.frozenSince, w.state.attention];
    },
    expected: [
      [
        DEFAULT_CREW_TIMING.deployPollFirstMs,
        DEFAULT_CREW_TIMING.deployPollFirstMs * 2,
        DEFAULT_CREW_TIMING.deployPollFirstMs * 4,
      ],
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

  it.each(["wake", "receipt"] as const)(
    "thawing a host stops deploy polls before recovery finishes: %s",
    (arrives) => {
      const w = new CrewWorld();
      w.apply(home(writer("backend")));
      w.tell({ _tag: "Deploy", host: "appdev", phase: "started" }, { kind: "engine" });
      w.tell({ _tag: "Recovered", bootId: "boot-2" as never }, { kind: "engine" });
      w.settle("crew.deploy.poll", "appdev", { phase: "unreadable" });
      w.advance(DEFAULT_CREW_TIMING.thawOfferMs);
      w.fire("deploy-poll", "appdev");
      w.settle("crew.deploy.poll", "appdev", { phase: "unreadable" });
      if (arrives === "receipt") w.fire("deploy-poll", "appdev");

      w.press({ _tag: "thawHost", host: "appdev" });
      expect(w.pending("crew.recover", "appdev")).toBeDefined();
      // Either input can already be in flight when the person asks to thaw.
      if (arrives === "receipt") {
        w.settle("crew.deploy.poll", "appdev", { phase: "unreadable" });
      } else {
        w.fire("deploy-poll", "appdev");
      }

      expect(w.armed("deploy-poll")).toEqual([]);
      expect(w.pending("crew.deploy.poll", "appdev")).toBeUndefined();
      w.settle("crew.recover", "appdev", { lost: [] });
      expect(w.state.hosts.appdev?.frozenSince).toBeNull();
      expect(w.state.attention).toEqual([]);
    },
  );
});
