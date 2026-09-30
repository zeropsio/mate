import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { CrewRun, CrewTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewAccess, type CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";

import {
  crewGoalTitle,
  crewModeLine,
  crewModePressLock,
  type CrewModeInput,
  type CrewModePressKind,
} from "./CrewHead.logic";

const fixture = crewSnapshotFixture();
const run = fixture.run!;
const at = (fields: Partial<CrewRun>): CrewRun => ({ ...run, ...fields });
const task = (state: CrewTask["state"]): Pick<CrewTask, "state"> => ({ state });

/** A crew with nobody at work, nothing queued. */
const QUIET: Omit<CrewModeInput, "run"> = { workingCount: 0, tasks: [task("landed")] };
/** A crew someone works in. */
const BUSY: Omit<CrewModeInput, "run"> = { workingCount: 1, tasks: [task("working")] };
/** A crew with work queued and nobody at it. */
const QUEUED: Omit<CrewModeInput, "run"> = { workingCount: 0, tasks: [task("queued")] };

describe("crewModeLine", () => {
  it.each<[string, CrewModeInput, string, string | null]>([
    [
      "no run, nobody at work",
      { run: null, ...QUIET },
      "Works when you give it something to do",
      null,
    ],
    [
      "no run, someone at work",
      { run: null, ...BUSY },
      "Working with you · finished work waits for your review",
      "letItWork",
    ],
    [
      "no run, a task being checked with no turn running",
      { run: null, workingCount: 0, tasks: [task("checking")] },
      "Working with you · finished work waits for your review",
      "letItWork",
    ],
    [
      "a run over is no run",
      { run: at({ state: "finished" }), ...QUIET },
      "Works when you give it something to do",
      null,
    ],
    [
      "a stopped run is no run",
      { run: at({ state: "stopped" }), ...BUSY },
      "Working with you · finished work waits for your review",
      "letItWork",
    ],
    [
      "running",
      { run: at({ state: "running" }), ...BUSY },
      "Working on its own · $6.40 of $20 · 1 h 12 m of 8 h",
      "stop",
    ],
    [
      "running with nobody at work: it still runs",
      { run: at({ state: "running" }), ...QUIET },
      "Working on its own · $6.40 of $20 · 1 h 12 m of 8 h",
      "stop",
    ],
    [
      "stopped by its budget",
      { run: at({ state: "paused", reason: "budget", spentUsd: 20 }), ...QUIET },
      "Stopped working on its own: it spent its $20",
      "keepGoing",
    ],
    [
      "stopped by its time, with work queued",
      { run: at({ state: "paused", reason: "time", spentUsd: 6.4 }), ...QUEUED },
      "Stopped working on its own: its 8 hours are up. It spent $6.40.",
      "keepGoing",
    ],
    [
      "stopped by its time, with nothing left to do and nothing spent",
      { run: at({ state: "paused", reason: "time", spentUsd: 0 }), ...QUIET },
      "Stopped working on its own: its 8 hours are up",
      null,
    ],
    [
      "stopped by the usage stop",
      { run: at({ state: "paused", reason: "usage" }), ...QUIET },
      "Stopped working on its own: your Claude plan is at 80 %",
      "keepGoing",
    ],
    [
      "stopped by a refusal",
      {
        run: at({
          state: "paused",
          reason: "refused",
          reasonDetail: "Backend's login is signed out",
        }),
        ...QUIET,
      },
      "Stopped working on its own: Backend's login is signed out",
      "tryAgain",
    ],
    [
      "paused by an older client's Pause",
      { run: at({ state: "paused", reason: "person" }), ...QUIET },
      "Stopped working on its own",
      "keepGoing",
    ],
    ["wrapping up", { run: at({ state: "finishing" }), ...BUSY }, "Wrapping up", null],
  ])("%s", (_, input, words, press) => {
    const line = crewModeLine(input);
    expect([line.words, line.press?.kind ?? null]).toEqual([words, press]);
  });

  it("labels each press and says what it does", () => {
    const presses = [
      crewModeLine({ run: null, ...BUSY }),
      crewModeLine({ run: at({ state: "running" }), ...BUSY }),
      crewModeLine({ run: at({ state: "paused", reason: "budget" }), ...QUIET }),
      crewModeLine({ run: at({ state: "paused", reason: "refused" }), ...QUIET }),
    ].map((line) => [line.press?.label, line.press?.line]);
    expect(presses).toEqual([
      ["Let it work on its own…", "It carries on without asking, within your limits."],
      ["Stop", "Everyone stops where they are. Their work is kept."],
      ["Keep going…", "More money or time, and it carries on."],
      ["Try again", "It carries on where it stopped."],
    ]);
  });
});

describe("crewGoalTitle", () => {
  it.each([
    [
      "the goal's own title, its first lines on hover",
      {
        briefTitle: "Letopis — shared persistent world",
        briefExcerpt: "A world built by players.\n## Done when",
      },
      {
        title: "Letopis — shared persistent world",
        placeholder: false,
        hover: "A world built by players.",
      },
    ],
    [
      "no title yet: the question it answers",
      { briefTitle: "  ", briefExcerpt: "" },
      { title: "What's the crew for?", placeholder: true, hover: null },
    ],
    [
      "the template's own words are no goal",
      {
        briefTitle: "New brief",
        briefExcerpt: "Describe what the crew builds and why.\n\n## Binding decisions",
      },
      { title: "What's the crew for?", placeholder: true, hover: null },
    ],
  ])("%s", (_, crew, title) => {
    expect(crewGoalTitle(crew)).toEqual(title);
  });
});

describe("crewModePressLock — the mode line's press for a viewer who may not run the crew (D6)", () => {
  const lock = (login: string): CrewLock => ({
    login,
    agentId: "claude-code",
    ownership: "someone-else",
  });
  const accessOf = (closed: boolean) =>
    crewAccess({
      snapshot: fixture,
      lockOf: (login) => (closed ? lock(login) : null),
      defaultLogin: "claudeAgent",
      reading: false,
    });

  it.each<{
    readonly kind: CrewModePressKind;
    readonly run: CrewRun | null;
    readonly offered: boolean;
    readonly says: string;
  }>([
    // A colleague stops what they may not start: a runaway crew never waits for its signer.
    { kind: "stop", run, offered: true, says: "Stop, a running crew's" },
    {
      kind: "keepGoing",
      run: at({ state: "paused", reason: "budget" }),
      offered: false,
      says: "no Keep going…, which resumes it",
    },
    {
      kind: "tryAgain",
      run: at({ state: "paused", reason: "refused" }),
      offered: false,
      says: "no Try again, which resumes it",
    },
    { kind: "letItWork", run: null, offered: false, says: "no Let it work, which starts one" },
  ])("offers a viewer who may not run the crew $says", ({ kind, run: current, offered }) => {
    expect(crewModePressLock(kind, current, accessOf(true)) === null).toBe(offered);
  });

  it.each<CrewModePressKind>(["stop", "keepGoing", "tryAgain", "letItWork"])(
    "offers %s to the person who runs it",
    (kind) => {
      expect(crewModePressLock(kind, run, accessOf(false))).toBeNull();
    },
  );
});
