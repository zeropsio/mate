import { describe, expect, it } from "vite-plus/test";

import {
  CHIEF_SETUP_IDLE,
  chiefProjectProgress,
  chiefSetupAfter,
  chiefSetupSteps,
  finishChiefSetup,
  type ChiefSetup,
  type ChiefSetupEvent,
} from "./chiefSetup.logic";

const running = (step: "project" | "hq", projectId: string | null = "p-chief") =>
  ({ phase: "running", step, birthId: "b1", projectId }) as const satisfies ChiefSetup;
const failed = (step: "project" | "hq", projectId: string | null = "p-chief") =>
  ({
    phase: "failed",
    step,
    birthId: "b1",
    projectId,
    reason: "No.",
  }) as const satisfies ChiefSetup;

describe("chiefSetupAfter", () => {
  it.each<[string, ChiefSetup, ChiefSetupEvent, ChiefSetup]>([
    [
      "Set up Chief starts with its project",
      CHIEF_SETUP_IDLE,
      { type: "start", birthId: "b1" },
      running("project", null),
    ],
    [
      "its project made, HQ is asked to record it",
      running("project", null),
      { type: "project-made", projectId: "p-chief" },
      running("hq"),
    ],
    [
      "HQ's registration answered, the Chief is set up",
      running("hq"),
      { type: "registered" },
      { phase: "done", birthId: "b1", projectId: "p-chief" },
    ],
    [
      "completed setup yields to HQ ownership so a later deletion can offer setup again",
      { phase: "done", birthId: "b1", projectId: "p-chief" },
      { type: "observed", projectId: "p-chief" },
      CHIEF_SETUP_IDLE,
    ],
    [
      "another Chief's observation cannot finish this setup",
      { phase: "done", birthId: "b1", projectId: "p-chief" },
      { type: "observed", projectId: "other-chief" },
      { phase: "done", birthId: "b1", projectId: "p-chief" },
    ],
    [
      "a project that stopped says why",
      running("project", null),
      { type: "failed", reason: "No." },
      failed("project", null),
    ],
    [
      "HQ refusing says why, its project kept",
      running("hq"),
      { type: "failed", reason: "No." },
      failed("hq"),
    ],
    [
      "trying the project again resumes the same creation",
      failed("project", null),
      { type: "again" },
      running("project", null),
    ],
    [
      "trying again after HQ refused asks HQ again, never makes a second project",
      failed("hq"),
      { type: "again" },
      running("hq"),
    ],
    [
      "a second Set up Chief while one runs starts nothing",
      running("hq"),
      { type: "start", birthId: "b2" },
      running("hq"),
    ],
    [
      "an answer for a step not running is ignored",
      running("project", null),
      { type: "registered" },
      running("project", null),
    ],
    ["nothing to try again while it runs", running("hq"), { type: "again" }, running("hq")],
  ])("%s", (_title, before, event, after) => {
    expect(chiefSetupAfter(before, event)).toEqual(after);
  });
});

describe("chiefSetupSteps", () => {
  it.each<[string, ChiefSetup, ReadonlyArray<string>]>([
    ["before it starts, every step waits", CHIEF_SETUP_IDLE, ["waiting", "waiting"]],
    ["the project runs first", running("project", null), ["active", "waiting"]],
    ["HQ runs once the project is made", running("hq"), ["done", "active"]],
    ["all done", { phase: "done", birthId: "b1", projectId: "p-chief" }, ["done", "done"]],
  ])("%s", (_title, setup, states) => {
    expect(chiefSetupSteps(setup).map((step) => step.state)).toEqual(states);
  });

  it("a failed step carries its reason in plain words", () => {
    expect(chiefSetupSteps(failed("hq"))[1]).toMatchObject({ state: "failed", detail: "No." });
  });
});

describe("chiefProjectProgress", () => {
  it.each<
    [string, Parameters<typeof chiefProjectProgress>[0], ReturnType<typeof chiefProjectProgress>]
  >([
    [
      "nothing yet while the creation is not seen",
      { creation: undefined, press: undefined },
      { kind: "waiting" },
    ],
    [
      "a creation that stopped says why",
      { creation: { projectId: null, failed: { reason: "Zerops refused." } }, press: undefined },
      { kind: "failed", reason: "Zerops refused." },
    ],
    [
      "a project not made yet waits",
      { creation: { projectId: null, failed: null }, press: undefined },
      { kind: "waiting" },
    ],
    [
      "a project whose container is still being added waits",
      {
        creation: { projectId: "p-chief", failed: null },
        press: {
          state: { kind: "pressing" },
          progress: [{ step: { kind: "import-container" }, state: "active" }],
        },
      },
      { kind: "waiting" },
    ],
    [
      "a project whose container was added is made",
      {
        creation: { projectId: "p-chief", failed: null },
        press: {
          state: { kind: "pressing" },
          progress: [{ step: { kind: "import-container" }, state: "done" }],
        },
      },
      { kind: "made", projectId: "p-chief" },
    ],
    [
      "a press through every step is made",
      { creation: { projectId: "p-chief", failed: null }, press: { state: { kind: "pressed" } } },
      { kind: "made", projectId: "p-chief" },
    ],
    [
      "a press that stopped says why",
      {
        creation: { projectId: "p-chief", failed: null },
        press: { state: { kind: "failed", reason: "The container did not come." } },
      },
      { kind: "failed", reason: "The container did not come." },
    ],
  ])("%s", (_title, input, expected) => {
    expect(chiefProjectProgress(input)).toEqual(expected);
  });
});

describe("finishChiefSetup", () => {
  const answer = { chief: { projectId: "p-chief", since: "2026-10-12T10:00:00.000Z" } };

  it("registers its project as my Chief at HQ, and the setup is done", async () => {
    const events: ChiefSetupEvent[] = [];
    const registered: string[] = [];
    await finishChiefSetup({
      projectId: "p-chief",
      setChief: async (projectId) => {
        registered.push(projectId);
        return answer;
      },
      dispatch: (event) => events.push(event),
    });
    expect(registered).toEqual(["p-chief"]);
    expect(events).toEqual([{ type: "registered" }]);
  });

  it.each<[string, string]>([["HQ refusing stops before anything is written", "HQ said no."]])(
    "%s",
    async (_title, words) => {
      const events: ChiefSetupEvent[] = [];
      await finishChiefSetup({
        projectId: "p-chief",
        setChief: async () => {
          throw new Error(words);
        },
        dispatch: (event) => events.push(event),
      });
      expect(events).toEqual([{ type: "failed", reason: words }]);
    },
  );

  it("resumes after a failure: HQ is asked again and the registration answered once", async () => {
    let setup: ChiefSetup = running("hq");
    let refusals = 1;
    const asked: string[] = [];
    const run = () =>
      finishChiefSetup({
        projectId: "p-chief",
        setChief: async (projectId) => {
          asked.push(projectId);
          if (refusals-- > 0) throw new Error("HQ is not answering right now.");
          return answer;
        },
        dispatch: (event) => {
          setup = chiefSetupAfter(setup, event);
        },
      });
    await run();
    expect(setup).toEqual({ ...failed("hq"), reason: "HQ is not answering right now." });
    setup = chiefSetupAfter(setup, { type: "again" });
    await run();
    expect(setup).toEqual({ phase: "done", birthId: "b1", projectId: "p-chief" });
    expect(asked).toEqual(["p-chief", "p-chief"]);
  });
});
