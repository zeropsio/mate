import { describe, expect, it } from "vite-plus/test";

import { jobLost, LIVE_JOB_GRACE_MS, lingerLiveJobs, liveJobsOf } from "./liveJobs.logic";

const ids = (...values: string[]) => ({ ids: new Set(values) });

describe("liveJobsOf", () => {
  it.each([
    {
      name: "the server names its live tasks",
      taskIds: ["b1"],
      liveness: "monitoring",
      working: false,
      live: ["b1"],
    },
    { name: "it names none: nothing lives", taskIds: [], liveness: null, working: true, live: [] },
    {
      name: "an old server, idle and nothing live",
      taskIds: undefined,
      liveness: null,
      working: false,
      live: [],
    },
    {
      name: "an old server, something lives",
      taskIds: undefined,
      liveness: "monitoring",
      working: false,
      live: null,
    },
    {
      name: "an old server, a turn running",
      taskIds: undefined,
      liveness: null,
      working: true,
      live: null,
    },
  ] as const)("$name", ({ taskIds, liveness, working, live }) => {
    const judged = liveJobsOf({
      backgroundTaskIds: taskIds,
      backgroundLiveness: liveness,
      isWorking: working,
    });
    expect(judged === null ? null : [...judged.ids]).toEqual(live);
  });

  it("an engine conversation's job runs on after its turn until its own record ends it: the V1 shell beside it holds no live task", () => {
    const live = liveJobsOf({
      backgroundTaskIds: [],
      backgroundLiveness: null,
      isWorking: false,
      engine: true,
    });
    expect(jobLost({ id: "s1.w1", ofLiveTurn: false }, live)).toBe(false);
  });
});

describe("jobLost", () => {
  it.each([
    { name: "held live", id: "b1", live: ids("b1"), ofLiveTurn: false, lost: false },
    {
      name: "a dead session's job beside a newer live one",
      id: "b1",
      live: ids("b9"),
      ofLiveTurn: false,
      lost: true,
    },
    { name: "the server says nothing", id: "b1", live: null, ofLiveTurn: false, lost: false },
    { name: "of a turn still running", id: "b1", live: ids(), ofLiveTurn: true, lost: false },
    {
      name: "no id known, nothing lives",
      id: undefined,
      live: ids(),
      ofLiveTurn: false,
      lost: true,
    },
    {
      name: "no id known, something lives",
      id: undefined,
      live: ids("b9"),
      ofLiveTurn: false,
      lost: false,
    },
  ])("$name", ({ id, live, ofLiveTurn, lost }) => {
    expect(jobLost({ id, ofLiveTurn }, live)).toBe(lost);
  });
});

// Review of pass 39: the grace ran only once per page; it is per job.
describe("lingerLiveJobs", () => {
  it("keeps a job the server stopped naming live a moment, then lets it go, every time", () => {
    let shown = lingerLiveJobs(null, ids("b1", "b2"), 0);
    const live = (at: number, next: ReturnType<typeof ids>) => {
      shown = lingerLiveJobs(shown, next, at);
      return [...(shown.live?.ids ?? [])].toSorted();
    };
    expect(live(1000, ids("b2"))).toEqual(["b1", "b2"]);
    expect(live(1000 + LIVE_JOB_GRACE_MS, ids("b2"))).toEqual(["b2"]);
    // A later turn's job leaves the same way.
    expect(live(20_000, ids())).toEqual(["b2"]);
    expect(live(20_000 + LIVE_JOB_GRACE_MS, ids())).toEqual([]);
  });

  it("lets nothing linger on first sight", () => {
    expect([...(lingerLiveJobs(null, ids(), 0).live?.ids ?? [])]).toEqual([]);
  });
});
