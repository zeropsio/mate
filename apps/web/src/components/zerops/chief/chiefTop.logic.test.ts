import { describe, expect, it } from "vite-plus/test";

import type { MateRowSecond, MateRowState } from "../SidebarMateRow.logic";
import type { ChiefSetup } from "./chiefSetup.logic";
import {
  chiefNameParts,
  chiefPageView,
  chiefRowLine,
  chiefRowOpens,
  chiefTopShown,
  type ChiefPageView,
} from "./chiefTop.logic";
import { chiefSetupLine, type OrgChief } from "~/zerops/chief";

const mate = (state: MateRowState, second: MateRowSecond) => ({ state, second });

describe("chiefRowLine", () => {
  it.each<[string, Parameters<typeof chiefRowLine>[0], ReturnType<typeof chiefRowLine>]>([
    [
      "says nothing of a Chief at rest: the row is its name alone",
      {
        setup: null,
        unfinished: false,
        mate: mate("idle", { kind: "reply", tone: "muted" }),
      },
      undefined,
    ],
    [
      "says nothing where the person has no Chief and none is being set up",
      { setup: "offer", unfinished: false, mate: undefined },
      undefined,
    ],
    [
      "says what it works on while it works",
      {
        setup: null,
        unfinished: false,
        mate: mate("working", { kind: "reply", tone: undefined }),
      },
      { kind: "mate", second: { kind: "reply", tone: undefined } },
    ],
    [
      "says what it asks the person, in ink",
      { setup: null, unfinished: false, mate: mate("needs", { kind: "reply", tone: "ink" }) },
      { kind: "mate", second: { kind: "reply", tone: "ink" } },
    ],
    [
      "says it waits for the person's sign-in",
      { setup: null, unfinished: false, mate: mate("idle", { kind: "sign-in" }) },
      { kind: "mate", second: { kind: "sign-in" } },
    ],
    [
      "says it is coming up while its container comes up",
      { setup: null, unfinished: false, mate: mate("idle", { kind: "coming" }) },
      { kind: "mate", second: { kind: "coming" } },
    ],
    [
      "says nothing of its last error, an unread answer or what was last asked",
      { setup: null, unfinished: false, mate: mate("failed", { kind: "reply", tone: "failed" }) },
      undefined,
    ],
    [
      "says it is being set up while its setup runs",
      { setup: "running", unfinished: false, mate: undefined },
      { kind: "setup", state: "running" },
    ],
    [
      "says its setup stopped",
      { setup: "stopped", unfinished: false, mate: undefined },
      { kind: "setup", state: "stopped" },
    ],
    [
      "says its setup waits to be finished where its access never reached it",
      {
        setup: null,
        unfinished: true,
        mate: mate("idle", { kind: "reply", tone: "muted" }),
      },
      { kind: "setup", state: "unfinished" },
    ],
  ])("%s", (_title, input, line) => {
    expect(chiefRowLine(input)).toEqual(line);
  });
});

describe("chiefRowOpens", () => {
  it.each<[string, Parameters<typeof chiefRowOpens>[0], ReturnType<typeof chiefRowOpens>]>([
    ["opens its conversation once the Chief is listed", { listed: true, line: undefined }, "mate"],
    ["opens the Chief page while the person has none", { listed: false, line: undefined }, "page"],
    [
      "opens the Chief page while its setup runs, stopped or waits to be finished",
      { listed: true, line: { kind: "setup", state: "unfinished" } },
      "page",
    ],
  ])("%s", (_title, input, opens) => {
    expect(chiefRowOpens(input)).toBe(opens);
  });
});

const RUNNING: ChiefSetup = { phase: "running", step: "hq", birthId: "b1", projectId: "p-chief" };
const FAILED: ChiefSetup = {
  phase: "failed",
  step: "project",
  birthId: "b1",
  projectId: null,
  reason: "No room.",
};
const ready = { hq: "official", mayCreate: true, unfinished: false } as const;

describe("chiefPageView", () => {
  it.each<[string, Parameters<typeof chiefPageView>[0], ChiefPageView]>([
    [
      "holds its place while whose Chief it is is not known",
      { ...ready, own: undefined, setup: { phase: "idle" } },
      { kind: "reading" },
    ],
    [
      "offers Set up Chief to a person who has none",
      { ...ready, own: null, setup: { phase: "idle" } },
      { kind: "offer", blocked: undefined },
    ],
    [
      "offers it held while the organization's HQ is not reached yet",
      { ...ready, hq: "reading", own: null, setup: { phase: "idle" } },
      { kind: "offer", blocked: "Reaching your organization's HQ…" },
    ],
    [
      "says why where the organization has no HQ to record a Chief",
      { ...ready, hq: "none", own: null, setup: { phase: "idle" } },
      { kind: "offer", blocked: "Your organization has no HQ to record a Chief." },
    ],
    [
      "explains the missing HQ without waiting for a Chief ownership record",
      { ...ready, hq: "none", own: undefined, setup: { phase: "idle" } },
      { kind: "offer", blocked: "Your organization has no HQ to record a Chief." },
    ],
    [
      "says why where the organization's HQ runs an older Core than this app carries",
      { ...ready, hq: "behind", own: null, setup: { phase: "idle" } },
      {
        kind: "offer",
        blocked: "Your organization's HQ needs its update before it can record a Chief.",
      },
    ],
    [
      "says why where the person may not make the project it lives in",
      { ...ready, mayCreate: false, own: null, setup: { phase: "idle" } },
      {
        kind: "offer",
        blocked: "Only someone who may create projects in this organization can set one up.",
      },
    ],
    [
      "shows the setup's steps while they run",
      { ...ready, own: null, setup: RUNNING },
      { kind: "steps", setup: RUNNING },
    ],
    [
      "shows the step that stopped, with why",
      { ...ready, own: null, setup: FAILED },
      { kind: "steps", setup: FAILED },
    ],
    [
      "waits for its container once it is set up",
      { ...ready, own: null, setup: { phase: "done", birthId: "b1", projectId: "p-chief" } },
      { kind: "coming", projectId: "p-chief" },
    ],
    [
      "waits for the person's own Chief to answer, then hands over to its conversation",
      { ...ready, own: "p-chief", setup: { phase: "idle" } },
      { kind: "coming", projectId: "p-chief" },
    ],
    [
      "offers to finish a Chief whose access never reached it",
      { ...ready, own: "p-chief", unfinished: true, setup: { phase: "idle" } },
      { kind: "finish", projectId: "p-chief" },
    ],
  ])("%s", (_title, input, view) => {
    expect(chiefPageView(input)).toEqual(view);
  });
});

describe("chiefNameParts", () => {
  it.each([
    ["Ada's Chief Mate", { head: "Ada's", noun: "Chief Mate" }],
    ["Set up your Chief", { head: "Set up your", noun: "Chief" }],
    ["Chief Mate", { head: "", noun: "Chief Mate" }],
  ])("keeps the Chief's noun whole in %s: the words before it give way first", (title, parts) => {
    expect(chiefNameParts(title)).toEqual(parts);
  });
});

describe("chiefTopShown", () => {
  it("the Chief's row stays from setup until HQ reports it", () => {
    const steps: ReadonlyArray<[OrgChief, "running" | "done" | "idle"]> = [
      [null, "running"],
      [null, "done"],
      [undefined, "done"],
      ["chief-project", "done"],
      ["chief-project", "idle"],
    ];
    expect(
      steps.map(([own, setup]) =>
        chiefTopShown({ own, setup: chiefSetupLine({ own, mayCreate: true, setup }) }),
      ),
    ).toEqual(steps.map(() => true));
  });

  it.each<[string, Parameters<typeof chiefTopShown>[0], boolean]>([
    ["the menu holds no Chief row before one exists", { own: null, setup: "offer" }, false],
    [
      "the menu holds no Chief row while whose Chief is not known",
      { own: undefined, setup: null },
      false,
    ],
    ["the Chief is a menu row while it is being set up", { own: null, setup: "running" }, true],
    [
      "the Chief is a menu row once its setup stopped, to try again",
      { own: null, setup: "stopped" },
      true,
    ],
    ["the Chief is a menu row once it exists", { own: "chief-project", setup: null }, true],
  ])("%s", (_title, input, shown) => {
    expect(chiefTopShown(input)).toBe(shown);
  });
});
