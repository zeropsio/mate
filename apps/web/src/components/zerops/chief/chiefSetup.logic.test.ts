import { describe, expect, it } from "vite-plus/test";

import {
  CHIEF_SETUP_IDLE,
  chiefProjectProgress,
  chiefServiceOf,
  chiefSetupAfter,
  chiefSetupSteps,
  chiefVariableWrites,
  chiefVariables,
  finishChiefSetup,
  type ChiefSetup,
  type ChiefSetupEvent,
} from "./chiefSetup.logic";

const running = (step: "project" | "hq" | "variables", projectId: string | null = "p-chief") =>
  ({ phase: "running", step, birthId: "b1", projectId }) as const satisfies ChiefSetup;
const failed = (step: "project" | "hq" | "variables", projectId: string | null = "p-chief") =>
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
      "a Chief left without its access by a reload resumes at HQ, its project kept",
      CHIEF_SETUP_IDLE,
      { type: "resume", projectId: "p-chief" },
      { phase: "running", step: "hq", birthId: "resume:p-chief", projectId: "p-chief" },
    ],
    [
      "a resume while a setup runs changes nothing",
      running("project", null),
      { type: "resume", projectId: "p-chief" },
      running("project", null),
    ],
    [
      "its project made, HQ is asked to record it",
      running("project", null),
      { type: "project-made", projectId: "p-chief" },
      running("hq"),
    ],
    [
      "HQ's answer hands its zcp the access",
      running("hq"),
      { type: "hq-answered" },
      running("variables"),
    ],
    [
      "its access written, the Chief is set up",
      running("variables"),
      { type: "variables-written" },
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
      "a refused write says why, its project kept",
      running("variables"),
      { type: "failed", reason: "No." },
      failed("variables"),
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
      "trying again after the write failed asks HQ for a fresh credential, none being kept",
      failed("variables"),
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
      { type: "variables-written" },
      running("project", null),
    ],
    ["nothing to try again while it runs", running("hq"), { type: "again" }, running("hq")],
  ])("%s", (_title, before, event, after) => {
    expect(chiefSetupAfter(before, event)).toEqual(after);
  });
});

describe("chiefSetupSteps", () => {
  it.each<[string, ChiefSetup, ReadonlyArray<string>]>([
    ["before it starts, every step waits", CHIEF_SETUP_IDLE, ["waiting", "waiting", "waiting"]],
    ["the project runs first", running("project", null), ["active", "waiting", "waiting"]],
    ["HQ runs once the project is made", running("hq"), ["done", "active", "waiting"]],
    ["a stopped write says its own step failed", failed("variables"), ["done", "done", "failed"]],
    ["all done", { phase: "done", birthId: "b1", projectId: "p-chief" }, ["done", "done", "done"]],
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

describe("chiefVariables", () => {
  it("hands its zcp HQ's proxy in the open and the credential as a secret", () => {
    expect(chiefVariables({ proxyUrl: "https://hq/api/chief/zerops", credential: "c" })).toEqual([
      { key: "ZCP_ORG_API", value: "https://hq/api/chief/zerops", sensitive: false },
      { key: "ZCP_ORG_TOKEN", value: "c", sensitive: true },
    ]);
  });
});

describe("finishChiefSetup", () => {
  const answer = {
    chief: { projectId: "p-chief", since: "2026-10-12" },
    credential: "c",
    proxyUrl: "https://hq/api/chief/zerops",
  };

  it("records the Chief at HQ, then writes its access onto its zcp", async () => {
    const events: ChiefSetupEvent[] = [];
    const written: unknown[] = [];
    await finishChiefSetup({
      projectId: "p-chief",
      setChief: async (projectId) => {
        written.push(["hq", projectId]);
        return answer;
      },
      writeVariables: async (values) => {
        written.push(["zcp", values.map((value) => value.key)]);
      },
      dispatch: (event) => events.push(event),
    });
    expect(written).toEqual([
      ["hq", "p-chief"],
      ["zcp", ["ZCP_ORG_API", "ZCP_ORG_TOKEN"]],
    ]);
    expect(events.map((event) => event.type)).toEqual(["hq-answered", "variables-written"]);
  });

  it.each<[string, "hq" | "zcp", string]>([
    ["HQ refusing stops before anything is written", "hq", "HQ said no."],
    ["a refused write stops the setup", "zcp", "Zerops said no."],
  ])("%s", async (_title, refuses, words) => {
    const events: ChiefSetupEvent[] = [];
    const wrote: string[] = [];
    await finishChiefSetup({
      projectId: "p-chief",
      setChief: async () => {
        if (refuses === "hq") throw new Error(words);
        return answer;
      },
      writeVariables: async () => {
        if (refuses === "zcp") throw new Error(words);
        wrote.push("zcp");
      },
      dispatch: (event) => events.push(event),
    });
    expect(events.at(-1)).toEqual({ type: "failed", reason: words });
    expect(wrote).toEqual([]);
  });

  it("resumes after a failure: HQ is asked again and the access written once", async () => {
    let setup: ChiefSetup = running("hq");
    let refusals = 1;
    const run = () =>
      finishChiefSetup({
        projectId: "p-chief",
        setChief: async () => {
          if (refusals-- > 0) throw new Error("HQ is not answering right now.");
          return answer;
        },
        writeVariables: async () => undefined,
        dispatch: (event) => {
          setup = chiefSetupAfter(setup, event);
        },
      });
    await run();
    expect(setup).toEqual({ ...failed("hq"), reason: "HQ is not answering right now." });
    setup = chiefSetupAfter(setup, { type: "again" });
    await run();
    expect(setup).toEqual({ phase: "done", birthId: "b1", projectId: "p-chief" });
  });
});

describe("chiefVariableWrites", () => {
  const values = chiefVariables({ proxyUrl: "https://hq/api/chief/zerops", credential: "c" });

  it("adds what its zcp holds none of", () => {
    expect(chiefVariableWrites(values, {}).map((write) => write.kind)).toEqual(["add", "add"]);
  });

  it("writes over what a stopped setup left, so a revoked credential is replaced", () => {
    expect(chiefVariableWrites(values, { ZCP_ORG_TOKEN: "ud-1" })[1]).toEqual({
      kind: "update",
      id: "ud-1",
      key: "ZCP_ORG_TOKEN",
      value: "c",
      sensitive: true,
    });
  });
});

describe("chiefServiceOf", () => {
  const service = (id: string, type: string) => ({
    id,
    serviceStackTypeInfo: { serviceStackTypeVersionName: type },
  });
  it.each<[string, Parameters<typeof chiefServiceOf>[0], string | undefined]>([
    ["its zcp, among its project's services", [service("s-zcp", "zcp@1")], "s-zcp"],
    ["none while its services are not read", undefined, undefined],
    ["none while its zcp is not listed yet", [service("s-db", "postgresql@17")], undefined],
    ["none where two claim it", [service("a", "zcp@1"), service("b", "zcp@1")], undefined],
  ])("hands the access to %s", (_title, services, id) => {
    expect(chiefServiceOf(services)).toBe(id);
  });
});
