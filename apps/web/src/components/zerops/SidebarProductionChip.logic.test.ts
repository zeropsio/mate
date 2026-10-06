import type {
  DeployedVersion,
  FlowReleaseRow,
  GroupEnvironmentRowInput,
  GroupFlowProduction,
  GroupFlowStop,
} from "@t3tools/client-runtime/zerops";
import type { HqJob } from "@t3tools/client-runtime/zerops/hq";
import { describe, expect, it } from "vite-plus/test";

import {
  asLastKnown,
  buildingOf,
  chipFace,
  chipDot,
  deployedAgo,
  draftParts,
  drawnChip,
  fixProblemOf,
  productionChip,
  productionMenu,
  projectChips,
  releaseFailureOf,
  stageChip,
  stageStopChip,
  stageMenu,
  stopServing,
  type ChipView,
  type ReleasesAnswer,
  type ProductionChip,
  type ReleaseFailure,
  type StopServing,
} from "./SidebarProductionChip.logic";

const version = (label: string): DeployedVersion =>
  label.startsWith("v")
    ? { name: label, commit: "3f9c1b2", sha: undefined, taggedBy: undefined, label }
    : { name: undefined, commit: label, sha: undefined, taggedBy: undefined, label };

const stop = (over: Partial<GroupFlowStop> = {}): GroupFlowStop => ({
  projectId: "prod",
  name: "production",
  state: "deployed",
  version: version("v0.1.44"),
  source: "release",
  route: undefined,
  ...over,
});

const stage = (over: Partial<GroupFlowStop> = {}): GroupFlowStop =>
  stop({ projectId: "stage", name: "stage", source: "main", version: version("3f9c1b2"), ...over });

const live = (label: string): GroupFlowProduction => ({
  kind: "live",
  stop: stop({ version: version(label) }),
  line: label,
});

const ABSENT: GroupFlowProduction = { kind: "absent" };
const SERVING: StopServing = { kind: "serving" };
const DOWN: StopServing = { kind: "down", services: ["web"] };
const ANSWERED: ReleasesAnswer = { kind: "answered", failure: undefined };
const FAILED_RELEASE: ReleaseFailure = {
  tag: "v0.1.57",
  kind: "deploy-failed",
  at: "2026-09-29T10:41:00Z",
  error: "The build step exited with code 2 while installing packages.",
  service: "app",
};

type ChipInput = Parameters<typeof productionChip>[0];
const input = (over: Partial<ChipInput> = {}): ChipInput => ({
  production: live("v0.1.44"),
  building: undefined,
  waiting: 0,
  waitingAtLeast: false,
  untold: [],
  serving: SERVING,
  releases: ANSWERED,
  ...over,
});

/** A stage as the stage chip reads it: its name, its stop, how it serves. */
const staged = (
  name: string,
  over: Partial<GroupFlowStop> = {},
  serving: StopServing = SERVING,
) => ({ name, stop: stage({ projectId: name, name, ...over }), serving });

const chip = (view: ChipView): ProductionChip | undefined =>
  view.kind === "chip" ? view.chip : undefined;

describe("projectChips — the chips a project's heading wears", () => {
  // One for production and one for the stage or stages, each only where the
  // project has it (the owner, 2026-09-29: "you'd have two badges one for
  // prod, one for stage(s)").
  it.each([
    { name: "none: no production and no stage", production: ABSENT, stages: [], chips: [] },
    { name: "production only", production: live("v0.1.44"), stages: [], chips: ["prod"] },
    { name: "a stage only", production: ABSENT, stages: [staged("stage")], chips: ["stage"] },
    {
      name: "both",
      production: live("v0.1.44"),
      stages: [staged("stage")],
      chips: ["stage", "prod"],
    },
    {
      name: "several stages: still one stage chip",
      production: live("v0.1.44"),
      stages: [staged("stage"), staged("qa")],
      chips: ["stage", "prod"],
    },
  ])("$name", ({ production, stages, chips }) => {
    const read = projectChips({
      production,
      building: undefined,
      waiting: 0,
      waitingAtLeast: false,
      untold: [],
      serving: SERVING,
      stages,
      stagesBeingCreated: false,
      releases: ANSWERED,
    });
    expect((["stage", "prod"] as const).filter((label) => read[label].kind === "chip")).toEqual(
      chips,
    );
  });
});

describe("productionChip — production's chip: the word, its tone, its state in words", () => {
  // The chip is the word alone; its tone says what is wrong and its
  // accessible name says the whole state.
  it.each([
    {
      state: "healthy",
      given: input({ production: live("v0.1.0") }),
      chip: { label: "prod", state: "ok", version: "v0.1.0" },
      tone: "neutral",
      words: "Production v0.1.0, healthy",
    },
    {
      state: "changes waiting: nothing is wrong",
      given: input({ waiting: 1 }),
      chip: { label: "prod", state: "waiting", version: "v0.1.44", waiting: 1 },
      tone: "neutral",
      words: "Production v0.1.44, healthy",
    },
    {
      state: "releasing",
      given: input({
        production: { kind: "releasing", stop: stop(), line: "v0.1.44", tag: "v0.1.45" },
      }),
      chip: { label: "prod", state: "releasing", version: "v0.1.44", next: "v0.1.45" },
      tone: "neutral",
      words: "Production v0.1.44, releasing v0.1.45",
    },
    {
      state: "a deploy running with no release in flight",
      given: input({
        production: {
          kind: "deploying",
          stop: stop({ state: "deploying", version: version("v0.1.45") }),
          line: "Deploying…",
        },
        building: { from: "v0.1.44", to: "v0.1.45" },
      }),
      chip: { label: "prod", state: "releasing", version: "v0.1.44", next: "v0.1.45" },
      tone: "neutral",
      words: "Production v0.1.44, releasing v0.1.45",
    },
    {
      state: "a deploy whose target nothing names yet",
      given: input({
        production: {
          kind: "deploying",
          stop: stop({ state: "deploying", version: undefined }),
          line: "Deploying…",
        },
        building: { from: "v0.1.44", to: undefined },
      }),
      chip: { label: "prod", state: "releasing", version: "v0.1.44" },
      tone: "neutral",
      words: "Production v0.1.44, deploying",
    },
    {
      state: "the last release failed, the old one still serving",
      given: input({
        production: live("v0.1.56"),
        releases: { kind: "answered", failure: FAILED_RELEASE },
      }),
      chip: { label: "prod", state: "failed", version: "v0.1.56" },
      tone: "neutral",
      words: "Production v0.1.56, healthy",
    },
    {
      state: "its own running commit's deploy failed",
      given: input({
        production: {
          kind: "deploy-failed",
          stop: stop({ state: "failed" }),
          line: "v0.1.44",
          candidate: undefined,
        },
      }),
      chip: { label: "prod", state: "failed", version: "v0.1.44" },
      tone: "neutral",
      words: "Production v0.1.44, healthy",
    },
    {
      state: "down: production isn't serving",
      given: input({ production: live("v2.3.0"), serving: { kind: "down", services: ["app"] } }),
      chip: { label: "prod", state: "down", version: "v2.3.0" },
      tone: "red",
      words: "Production is down",
    },
    {
      state: "stopped on purpose: hollow, nothing wrong",
      given: input({ serving: { kind: "stopped" } }),
      chip: { label: "prod", state: "stopped", version: "v0.1.44" },
      tone: "off",
      words: "Production is stopped",
    },
    {
      state: "being set up",
      given: input({
        production: {
          kind: "creating",
          line: "Setting up production…",
          creation: {
            projectId: "prod",
            kind: "production",
            name: "production",
          },
        },
      }),
      chip: { label: "prod", state: "creating" },
      tone: "neutral",
      words: "Production is being set up",
    },
    {
      state: "nothing released yet",
      given: input({
        production: {
          kind: "empty",
          stop: stop({ state: "empty", version: undefined }),
          line: "Nothing deployed yet",
        },
      }),
      chip: { label: "prod", state: "empty" },
      tone: "dash",
      words: "Production, nothing released yet",
    },
    {
      state: "nothing released yet, changes waiting for the first release",
      given: input({
        production: {
          kind: "ready-to-release",
          stop: stop({ state: "empty", version: undefined }),
          line: "Nothing deployed yet",
          candidate: { tag: "v0.1.0", waiting: 3 },
        },
        waiting: 3,
      }),
      chip: { label: "prod", state: "empty", waiting: 3 },
      tone: "dash",
      words: "Production, nothing released yet",
    },
  ])("$state", ({ given, chip: expected, tone, words }) => {
    const drawn = chip(productionChip(given));
    expect(drawn).toEqual(expected);
    expect(chipFace(drawn!)).toEqual({ tone, label: "prod", words });
  });

  it("draws no production chip where the project has no production", () => {
    expect(productionChip(input({ production: { kind: "absent" } }))).toEqual({ kind: "none" });
  });

  // A reload must not paint a chip it then takes back: until what decides it
  // is read, the chip is unknown — the menu draws what it remembers, or nothing.
  it.each([
    { name: "what production runs is still being read", given: { production: checking() } },
    {
      name: "the platform has not said how its services stand",
      given: { serving: { kind: "unknown" } as const },
    },
  ])("is unknown while $name", ({ given }) => {
    expect(productionChip(input(given))).toEqual(
      given.production === undefined
        ? { kind: "unknown" }
        : {
            kind: "chip",
            chip: { label: "prod", state: "unverified", readLine: "Checking what runs here…" },
          },
    );
  });

  // HQ may keep not answering the releases. The platform alone still says
  // there is a production and what it runs: drawn where nothing is
  // remembered, never remembered itself.
  it.each([
    {
      name: "a production",
      given: input({ releases: { kind: "waiting" }, waiting: 0 }),
      partial: { label: "prod", state: "ok", version: "v0.1.44" },
    },
    {
      name: "a production nothing was deployed to",
      given: input({
        releases: { kind: "waiting" },
        production: {
          kind: "empty",
          stop: stop({ state: "empty", version: undefined }),
          line: "Nothing deployed yet",
        },
      }),
      partial: { label: "prod", state: "empty" },
    },
  ] as const)(
    "says what the platform alone says of $name until HQ answers the releases",
    ({ given, partial }) => {
      const view = productionChip(given);
      expect(view).toEqual({ kind: "unknown", partial });
      expect(drawnChip(view)).toEqual(partial);
    },
  );

  it("says down at once, whatever else is still to be read", () => {
    expect(
      chip(
        productionChip(
          input({ releases: { kind: "waiting" }, serving: { kind: "down", services: ["app"] } }),
        ),
      )?.state,
    ).toBe("down");
  });

  // What a service runs that no comparison can start from is not known to be healthy: the chip
  // says so in its words, as the stop's verdict does, whatever else it says.
  it.each([
    {
      name: "a production one of whose services cannot be told",
      given: input({ untold: ["api"] }),
      chip: { label: "prod", state: "ok", version: "v0.1.44", untold: ["api"] },
      words: "Production v0.1.44, can't tell what api runs",
    },
    {
      name: "changes waiting on a production two of whose services cannot be told",
      given: input({ waiting: 2, untold: ["api", "web"] }),
      chip: {
        label: "prod",
        state: "waiting",
        version: "v0.1.44",
        waiting: 2,
        untold: ["api", "web"],
      },
      words: "Production v0.1.44, can't tell what api and web run",
    },
    {
      name: "a release that did not go out over a service that cannot be told",
      given: input({
        releases: { kind: "answered", failure: FAILED_RELEASE },
        untold: ["api"],
      }),
      chip: { label: "prod", state: "failed", version: "v0.1.44", untold: ["api"] },
      words: "Production v0.1.44, can't tell what api runs",
    },
  ])("never says healthy over $name", ({ given, chip: expected, words }) => {
    const drawn = chip(productionChip(given));
    expect(drawn).toEqual(expected);
    expect(chipFace(drawn!).words).toBe(words);
  });

  // Down or stopped is the loudest thing the chip can say, and it says it at
  // once — but a release on its way, or changes waiting, are true as well,
  // and its accessible name says them.
  it.each([
    {
      name: "down, a release on its way",
      given: input({
        production: { kind: "releasing", stop: stop(), line: "v0.1.44", tag: "v0.1.45" },
        serving: { kind: "down", services: ["app"] },
      }),
      chip: { label: "prod", state: "down", version: "v0.1.44", next: "v0.1.45" },
      words: "Production is down, releasing v0.1.45",
    },
    {
      name: "down, a deploy running on it",
      given: input({
        production: {
          kind: "deploying",
          stop: stop({ state: "deploying", version: version("v0.1.45") }),
          line: "Deploying…",
        },
        building: { from: "v0.1.44", to: "v0.1.45" },
        serving: { kind: "down", services: ["app"] },
      }),
      chip: { label: "prod", state: "down", version: "v0.1.44", next: "v0.1.45" },
      words: "Production is down, releasing v0.1.45",
    },
    {
      name: "down, changes waiting",
      given: input({ waiting: 2, serving: { kind: "down", services: ["app"] } }),
      chip: { label: "prod", state: "down", version: "v0.1.44", waiting: 2 },
      words: "Production is down, 2 changes waiting",
    },
    {
      name: "down, more changes waiting than HQ counts",
      given: input({
        waiting: 10000,
        waitingAtLeast: true,
        serving: { kind: "down", services: ["app"] },
      }),
      chip: {
        label: "prod",
        state: "down",
        version: "v0.1.44",
        waiting: 10000,
        waitingAtLeast: true,
      },
      words: "Production is down, 10000+ changes waiting",
    },
    {
      name: "down, the last release failed too",
      given: input({
        releases: { kind: "answered", failure: FAILED_RELEASE },
        serving: { kind: "down", services: ["app"] },
      }),
      chip: { label: "prod", state: "down", version: "v0.1.44" },
      words: "Production is down",
    },
    {
      name: "stopped, a release on its way",
      given: input({
        production: { kind: "releasing", stop: stop(), line: "v0.1.44", tag: "v0.1.45" },
        serving: { kind: "stopped" },
      }),
      chip: { label: "prod", state: "stopped", version: "v0.1.44", next: "v0.1.45" },
      words: "Production is stopped, releasing v0.1.45",
    },
    {
      name: "stopped, changes waiting",
      given: input({ waiting: 1, serving: { kind: "stopped" } }),
      chip: { label: "prod", state: "stopped", version: "v0.1.44", waiting: 1 },
      words: "Production is stopped, 1 change waiting",
    },
  ])("says $name", ({ given, chip: expected, words }) => {
    const drawn = chip(productionChip(given));
    expect(drawn).toEqual(expected);
    expect(chipFace(drawn!).words).toBe(words);
  });
});

describe("stageChip — one chip for the project's stage or stages", () => {
  const read = (
    stages: ReturnType<typeof staged>[],
    over: Partial<Parameters<typeof stageChip>[0]> = {},
  ) => stageChip({ stages, beingCreated: false, releases: ANSWERED, ...over });

  it.each([
    {
      name: "healthy, by the branch it follows",
      stages: [staged("stage")],
      chip: { label: "stage", state: "ok", version: "main" },
      tone: "neutral",
      words: "Stage main, healthy",
    },
    {
      name: "deploying",
      stages: [staged("stage", { state: "deploying" })],
      chip: { label: "stage", state: "releasing", version: "main" },
      tone: "neutral",
      words: "Stage main, deploying",
    },
    {
      name: "its last deploy failed",
      stages: [staged("stage", { state: "failed" })],
      chip: { label: "stage", state: "failed", version: "main" },
      tone: "amber",
      words: "Stage main, the last deploy failed",
    },
    {
      name: "down",
      stages: [staged("stage", {}, DOWN)],
      chip: { label: "stage", state: "down", version: "main" },
      tone: "red",
      words: "Stage is down",
    },
    {
      name: "stopped",
      stages: [staged("stage", {}, { kind: "stopped" })],
      chip: { label: "stage", state: "stopped", version: "main" },
      tone: "off",
      words: "Stage is stopped",
    },
    {
      name: "nothing deployed yet",
      stages: [staged("stage", { state: "empty", version: undefined, source: undefined })],
      chip: { label: "stage", state: "empty" },
      tone: "dash",
      words: "Stage, nothing deployed yet",
    },
    {
      name: "running a deploy somebody named, by its name",
      stages: [
        staged("stage", {
          version: {
            name: "hotfix-cache",
            commit: undefined,
            sha: undefined,
            taggedBy: undefined,
            label: "hotfix-cache",
          },
        }),
      ],
      chip: { label: "stage", state: "ok", version: "hotfix-cache" },
      tone: "neutral",
      words: "Stage hotfix-cache, healthy",
    },
  ])("one stage: $name", ({ stages, chip: expected, tone, words }) => {
    const drawn = chip(read(stages));
    expect(drawn).toEqual(expected);
    expect(chipFace(drawn!)).toEqual({ tone, label: "stage", words });
  });

  // Several stages are one chip, in the worst state any of them is in — red
  // for one down, amber for one whose last deploy failed — and hollow only
  // where every one is stopped. Its accessible name names each.
  it.each([
    {
      name: "every stage healthy",
      stages: [staged("stage"), staged("qa")],
      state: "ok",
      tone: "neutral",
      words: "Stages: stage is healthy, qa is healthy",
    },
    {
      name: "one down: red, whatever the others",
      stages: [staged("stage", { state: "failed" }), staged("qa", {}, DOWN)],
      state: "down",
      tone: "red",
      words: "Stages: stage's last deploy failed, qa is down",
    },
    {
      name: "one whose last deploy failed: amber",
      stages: [staged("stage"), staged("qa", { state: "failed" })],
      state: "failed",
      tone: "amber",
      words: "Stages: stage is healthy, qa's last deploy failed",
    },
    {
      name: "one deploying",
      stages: [staged("stage", { state: "deploying" }), staged("qa")],
      state: "releasing",
      tone: "neutral",
      words: "Stages: stage is deploying, qa is healthy",
    },
    {
      name: "one stopped beside one serving: nothing wrong, nothing all off",
      stages: [staged("stage"), staged("qa", {}, { kind: "stopped" })],
      state: "ok",
      tone: "neutral",
      words: "Stages: stage is healthy, qa is stopped",
    },
    {
      name: "every stage stopped",
      stages: [staged("stage", {}, { kind: "stopped" }), staged("qa", {}, { kind: "stopped" })],
      state: "stopped",
      tone: "off",
      words: "Stages: stage is stopped, qa is stopped",
    },
    {
      name: "nothing deployed to either yet",
      stages: [
        staged("stage", { state: "empty", version: undefined }),
        staged("qa", { state: "empty", version: undefined }),
      ],
      state: "empty",
      tone: "dash",
      words: "Stages: nothing is deployed to stage yet, nothing is deployed to qa yet",
    },
  ])("several stages: $name", ({ stages, state, tone, words }) => {
    const drawn = chip(read(stages));
    expect(drawn?.state).toBe(state);
    expect(chipFace(drawn!)).toEqual({ tone, label: "stage", words });
  });

  it("is being set up where the first stage is on its way", () => {
    const drawn = chip(read([], { beingCreated: true }));
    expect(drawn).toEqual({ label: "stage", state: "creating" });
    expect(chipFace(drawn!)).toEqual({
      tone: "neutral",
      label: "stage",
      words: "Stage is being set up",
    });
  });

  it("draws no stage chip where the project has no stage", () => {
    expect(read([])).toEqual({ kind: "none" });
  });

  it.each([
    { name: "its last deploy is unread", stages: [staged("stage", { state: "checking" })] },
    {
      name: "the platform has not said how it stands",
      stages: [staged("stage", {}, { kind: "unknown" })],
    },
    {
      name: "one of several is unread",
      stages: [staged("stage"), staged("qa", { state: "checking", version: undefined })],
    },
  ])("is unknown while $name", ({ stages }) => {
    if (stages.every(({ stop }) => stop.state !== "checking"))
      expect(read(stages)).toEqual({ kind: "unknown" });
    else expect(chip(read(stages))?.state).toBe("unverified");
  });

  it("says a stage down at once, even while another is unread", () => {
    const drawn = chip(
      read([staged("stage", { state: "checking", version: undefined }), staged("qa", {}, DOWN)]),
    );
    expect(drawn?.state).toBe("down");
    expect(chipFace(drawn!).tone).toBe("red");
  });

  it("says what the platform alone says of a stage until HQ answers", () => {
    const view = read([staged("stage")], { releases: { kind: "waiting" } });
    expect(view).toEqual({
      kind: "unknown",
      partial: { label: "stage", state: "ok", version: "main" },
    });
  });
});

function checking(): GroupFlowProduction {
  return {
    kind: "checking",
    stop: stop({ state: "checking", version: undefined }),
    line: "Checking what runs here…",
  };
}

describe("drawnChip — what the menu draws of a chip", () => {
  const NOW: ProductionChip = { label: "prod", state: "waiting", version: "v0.1.44", waiting: 1 };
  it.each([
    { view: { kind: "chip", chip: NOW } as const, drawn: NOW },
    { view: { kind: "unknown", partial: NOW } as const, drawn: NOW },
    { view: { kind: "unknown" } as const, drawn: undefined },
    { view: { kind: "none" } as const, drawn: undefined },
  ])("$view.kind", ({ view, drawn }) => {
    expect(drawnChip(view)).toEqual(drawn);
  });
});

describe("stopServing — whether what serves the stop's routes stands", () => {
  const runtime = (hostname: string, status: string) => ({ hostname, status, runtime: true });
  const managed = (hostname: string, status: string) => ({ hostname, status, runtime: false });
  const routes = (...services: ReadonlyArray<string>) => services.map((service) => ({ service }));
  it.each([
    {
      name: "every service up",
      projectStatus: "ACTIVE",
      services: [runtime("app", "ACTIVE"), managed("db", "RUNNING")],
      routes: routes("app"),
      serving: { kind: "serving" },
    },
    {
      name: "the service behind its routes failed",
      projectStatus: "ACTIVE",
      services: [runtime("app", "CONTAINER_FAILED"), managed("db", "ACTIVE")],
      routes: routes("app"),
      serving: { kind: "down", services: ["app"] },
    },
    {
      name: "one of the services behind its routes failed",
      projectStatus: "ACTIVE",
      services: [runtime("admin", "CONTAINER_FAILED"), runtime("app", "ACTIVE")],
      routes: routes("admin", "app"),
      serving: { kind: "down", services: ["admin"] },
    },
    {
      name: "a database whose upgrade failed — no route goes through it",
      projectStatus: "ACTIVE",
      services: [runtime("app", "ACTIVE"), managed("db", "UPGRADE_FAILED")],
      routes: routes("app"),
      serving: { kind: "serving" },
    },
    {
      name: "a worker that failed, no route going through it",
      projectStatus: "ACTIVE",
      services: [runtime("app", "ACTIVE"), runtime("worker", "CONTAINER_FAILED")],
      routes: routes("app"),
      serving: { kind: "serving" },
    },
    {
      name: "a runtime that failed where no route is public",
      projectStatus: "ACTIVE",
      services: [runtime("app", "CONTAINER_FAILED"), managed("db", "ACTIVE")],
      routes: routes(),
      serving: { kind: "down", services: ["app"] },
    },
    {
      name: "every service behind its routes stopped",
      projectStatus: "ACTIVE",
      services: [runtime("app", "SERVICE_STOPPED"), managed("db", "ACTIVE")],
      routes: routes("app"),
      serving: { kind: "stopped" },
    },
    {
      name: "one of the services behind its routes stopped, the other serving",
      projectStatus: "ACTIVE",
      services: [runtime("admin", "STOPPED"), runtime("app", "ACTIVE")],
      routes: routes("admin", "app"),
      serving: { kind: "serving" },
    },
    {
      name: "a stopped database beside a serving app",
      projectStatus: "ACTIVE",
      services: [runtime("app", "ACTIVE"), managed("db", "STOPPED")],
      routes: routes("app"),
      serving: { kind: "serving" },
    },
    {
      name: "the whole project stopped",
      projectStatus: "STOPPED",
      services: undefined,
      routes: routes(),
      serving: { kind: "stopped" },
    },
    {
      name: "services not read yet",
      projectStatus: "ACTIVE",
      services: undefined,
      routes: routes(),
      serving: { kind: "unknown" },
    },
    {
      name: "no runtime yet — nothing says it does not serve",
      projectStatus: "ACTIVE",
      services: [managed("db", "ACTIVE")],
      routes: routes(),
      serving: { kind: "serving" },
    },
    {
      name: "a project in another state",
      projectStatus: "DELETING",
      services: [runtime("app", "ACTIVE")],
      routes: routes("app"),
      serving: { kind: "unknown" },
    },
  ])("$name", ({ projectStatus, services, routes: routed, serving }) => {
    expect(stopServing({ projectStatus, services, routes: routed })).toEqual(serving);
  });
});

describe("releaseFailureOf — the release that did not go through, newer than what serves", () => {
  const release = (over: Partial<FlowReleaseRow>): FlowReleaseRow => ({
    tag: "v0.1.56",
    verdict: "approved",
    detail: undefined,
    line: "app 3f9c1b2",
    entries: [],
    taggedAt: "2026-09-25T07:00:00Z",
    standing: undefined,
    word: "Approved",
    rollBack: false,
    failedEntry: undefined,
    ...over,
  });
  const failedSha = "a".repeat(40);
  const record = (over: Partial<HqJob>): HqJob => ({
    id: "1",
    kind: "deploy",
    service: "app",
    sha: "b".repeat(40),
    state: "live",
    cause: "release",
    ref: "v0.1.56",
    reason: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: "2026-09-28T09:00:00Z",
    endedAt: "2026-09-28T09:04:00Z",
    supersededBy: null,
    ...over,
  });
  const environments: ReadonlyArray<GroupEnvironmentRowInput> = [
    {
      projectId: "stage",
      name: "stage",
      tier: "stage",
      sources: ["main"],
      environment: "shop-stage",
      keyHeld: true,
      keyInvalid: false,
      services: [{ hostname: "app", appVersionName: failedSha }],
    },
    {
      projectId: "prod",
      name: "production",
      tier: "production",
      sources: "release",
      environment: "shop-production",
      keyHeld: true,
      keyInvalid: false,
      services: [
        {
          hostname: "app",
          appVersionName: `${"b".repeat(40)} v0.1.56 ada`,
          deploy: {
            latest: record({
              id: "2",
              sha: failedSha,
              state: "failed",
              cause: "release",
              ref: "v0.1.57",
              reason: "The build step exited with code 2 while installing packages.",
              at: "2026-09-29T10:37:00Z",
              endedAt: "2026-09-29T10:41:00Z",
            }),
            live: record({}),
          },
        },
      ],
    },
  ];

  it("names the newest release whose production deploy failed, with HQ's words and time", () => {
    expect(
      releaseFailureOf({
        releases: [
          release({
            tag: "v0.1.57",
            standing: "deploy-failed",
            word: "Deploy failed",
            failedEntry: { service: "app", commit: failedSha },
          }),
          release({ tag: "v0.1.56", standing: "live", word: "Live" }),
        ],
        environmentInputs: environments,
      }),
    ).toEqual({
      tag: "v0.1.57",
      kind: "deploy-failed",
      at: "2026-09-29T10:41:00Z",
      error: "The build step exited with code 2 while installing packages.",
      service: "app",
    });
  });

  it("reads HQ's words for a release that lists the commit short", () => {
    expect(
      releaseFailureOf({
        releases: [
          release({
            tag: "v0.1.57",
            standing: "deploy-failed",
            word: "Deploy failed",
            failedEntry: { service: "app", commit: failedSha.slice(0, 7) },
          }),
        ],
        environmentInputs: environments,
      }),
    ).toMatchObject({
      tag: "v0.1.57",
      error: "The build step exited with code 2 while installing packages.",
    });
  });

  it("names a release whose production deploy HQ refused", () => {
    const refused = environments.map((environment) =>
      environment.tier !== "production"
        ? environment
        : {
            ...environment,
            services: environment.services.map((service) => ({
              ...service,
              deploy: {
                latest: record({
                  id: "2",
                  sha: failedSha,
                  state: "refused",
                  reason: "Zerops did not answer: timeout",
                  endedAt: "2026-09-29T11:20:00Z",
                }),
                live: record({}),
              },
            })),
          },
    );
    expect(
      releaseFailureOf({
        releases: [
          release({
            tag: "v0.1.57",
            standing: "deploy-failed",
            word: "Deploy failed",
            failedEntry: { service: "app", commit: failedSha },
          }),
        ],
        environmentInputs: refused,
      }),
    ).toMatchObject({
      at: "2026-09-29T11:20:00Z",
      error: "Zerops did not answer: timeout",
    });
  });

  it("names a release the old broker refused, from its kept record, with its reason", () => {
    expect(
      releaseFailureOf({
        releases: [
          release({
            tag: "v0.1.57",
            verdict: "refused",
            detail: "the tag's commit failed its checks",
            taggedAt: "2026-09-29T10:40:00Z",
            word: "Refused",
          }),
          release({ tag: "v0.1.56", standing: "live", word: "Live" }),
        ],
        environmentInputs: environments,
      }),
    ).toEqual({
      tag: "v0.1.57",
      kind: "refused",
      at: "2026-09-29T10:40:00Z",
      error: "the tag's commit failed its checks",
      service: undefined,
    });
  });

  it.each([
    { name: "nothing failed", releases: [release({ standing: "live", word: "Live" })] },
    {
      name: "a failure older than what production runs is history",
      releases: [
        release({ tag: "v0.1.58", standing: "live", word: "Live" }),
        release({
          tag: "v0.1.57",
          standing: "deploy-failed",
          failedEntry: { service: "app", commit: failedSha },
        }),
      ],
    },
    { name: "no release at all", releases: [] },
  ])("says nothing when $name", ({ releases }) => {
    expect(releaseFailureOf({ releases, environmentInputs: environments })).toBeUndefined();
  });

  it("keeps the failure when HQ records no failed deploy of its commit", () => {
    expect(
      releaseFailureOf({
        releases: [
          release({
            tag: "v0.1.57",
            standing: "deploy-failed",
            failedEntry: { service: "app", commit: "c".repeat(40) },
          }),
        ],
        environmentInputs: environments,
      }),
    ).toEqual({
      tag: "v0.1.57",
      kind: "deploy-failed",
      at: undefined,
      error: undefined,
      service: "app",
    });
  });
});

describe("productionMenu — what production's menu says, per state", () => {
  const NOW = Date.parse("2026-09-29T10:53:00Z");
  const ROUTES = [
    { service: "app", port: 80, host: "shop.example.com", url: "https://shop.example.com" },
  ];
  const menu = (over: Partial<Parameters<typeof productionMenu>[0]>) =>
    productionMenu({
      chip: { label: "prod", state: "ok", version: "v0.1.0" },
      projectId: "shop-prod",
      failure: undefined,
      down: [],
      routes: ROUTES,
      nowMs: NOW,
      ...over,
    });

  it.each([
    {
      name: "healthy",
      chip: { label: "prod", state: "ok", version: "v0.1.0" },
      row: { version: "v0.1.0", dot: "ok", word: "Healthy", tone: "muted" },
      fixes: false,
    },
    {
      name: "serving what one service runs, which cannot be told",
      chip: { label: "prod", state: "ok", version: "v0.1.0", untold: ["api"] },
      row: { version: "v0.1.0", dot: "off", word: "Can't tell what api runs", tone: "muted" },
      fixes: false,
    },
    {
      name: "release failed",
      chip: { label: "prod", state: "failed", version: "v0.1.56" },
      row: { version: "v0.1.56", dot: "attention", word: "Release failed", tone: "amber" },
      fixes: true,
    },
    {
      name: "down",
      chip: { label: "prod", state: "down", version: "v2.3.0" },
      row: { version: "v2.3.0", dot: "failed", word: "Down", tone: "red" },
      fixes: true,
    },
    {
      name: "releasing",
      chip: { label: "prod", state: "releasing", version: "v0.1.44", next: "v0.1.45" },
      row: { version: "v0.1.44", dot: "spinner", word: "Releasing v0.1.45", tone: "muted" },
      fixes: false,
    },
    {
      name: "stopped on purpose — no fix to offer",
      chip: { label: "prod", state: "stopped", version: "v0.1.44" },
      row: { version: "v0.1.44", dot: "hollow", word: "Stopped", tone: "muted" },
      fixes: false,
    },
    {
      name: "being set up",
      chip: { label: "prod", state: "creating" },
      row: { version: undefined, dot: "spinner", word: "Setting up…", tone: "muted" },
      fixes: false,
    },
  ] as const)(
    "$name: the state in words, where the version now lives",
    ({ chip: shown, row, fixes }) => {
      const model = menu({ chip: shown });
      // Production alone: the stages have a chip and a menu of their own.
      expect(model.stops).toHaveLength(1);
      const [only] = model.stops;
      expect(only).toMatchObject({
        projectId: "shop-prod",
        name: "production",
        routes: ROUTES,
        ...row,
      });
      expect(only?.fix !== undefined).toBe(fixes);
    },
  );

  it("says what failed, when, HQ's words, and what still serves", () => {
    expect(
      menu({
        chip: { label: "prod", state: "failed", version: "v0.1.56" },
        failure: FAILED_RELEASE,
      }).stops[0]?.note,
    ).toBe(
      "Release v0.1.57 failed 12 min ago: The build step exited with code 2 while installing packages. v0.1.56 is still serving.",
    );
  });

  it("says a release the old broker refused was refused, and why", () => {
    expect(
      menu({
        chip: { label: "prod", state: "failed", version: "v0.1.56" },
        failure: {
          tag: "v0.1.57",
          kind: "refused",
          at: undefined,
          error: "the tag's commit failed its checks",
          service: undefined,
        },
      }).stops[0]?.note,
    ).toBe(
      "Release v0.1.57 was refused: the tag's commit failed its checks. v0.1.56 is still serving.",
    );
  });

  it("says which services the platform marks failed while production is down", () => {
    expect(
      menu({ chip: { label: "prod", state: "down", version: "v2.3.0" }, down: ["app", "api"] })
        .stops[0]?.note,
    ).toBe("Down: app and api failed on the platform. v2.3.0 was the last release.");
  });

  it.each([
    {
      name: "down, and the last release failed",
      chip: { label: "prod", state: "down", version: "v2.3.0" },
      failure: FAILED_RELEASE,
      note: "Down: app failed on the platform. v2.3.0 was the last release. Release v0.1.57 failed 12 min ago: The build step exited with code 2 while installing packages.",
      fixes: true,
    },
    {
      name: "down, a release on its way",
      chip: { label: "prod", state: "down", version: "v2.3.0", next: "v2.3.1" },
      failure: undefined,
      note: "Down: app failed on the platform. v2.3.0 was the last release. Releasing v2.3.1.",
      fixes: true,
    },
    {
      name: "stopped, and the last release failed",
      chip: { label: "prod", state: "stopped", version: "v0.1.56" },
      failure: FAILED_RELEASE,
      note: "Release v0.1.57 failed 12 min ago: The build step exited with code 2 while installing packages.",
      fixes: true,
    },
    {
      name: "stopped, a release on its way",
      chip: { label: "prod", state: "stopped", version: "v0.1.56", next: "v0.1.57" },
      failure: undefined,
      note: "Releasing v0.1.57.",
      fixes: false,
    },
  ] as const)("says every true thing while $name", ({ chip: shown, failure, note, fixes }) => {
    const [only] = menu({
      chip: shown,
      failure,
      down: shown.state === "down" ? ["app"] : [],
    }).stops;
    expect(only?.note).toBe(note);
    expect(only?.fix !== undefined).toBe(fixes);
  });

  it("says nothing more where nothing is wrong", () => {
    expect(menu({}).stops[0]?.note).toBeUndefined();
  });
});

describe("stageMenu — each stage, as production's menu says production", () => {
  const NOW = Date.parse("2026-09-29T10:53:00Z");
  const routes = (host: string) => [{ service: "app", port: 80, host, url: `https://${host}` }];
  const entry = (
    name: string,
    over: Partial<Parameters<typeof stageMenu>[0]["stages"][number]> = {},
  ): Parameters<typeof stageMenu>[0]["stages"][number] => ({
    projectId: `shop-${name}`,
    name,
    stop: stage({ projectId: `shop-${name}`, name }),
    chip: { label: "stage", state: "ok", version: "main" },
    deployedAt: "2026-09-29T10:13:00Z",
    down: [],
    routes: routes(`${name}.example.app`),
    ...over,
  });
  const menu = (over: Partial<Parameters<typeof stageMenu>[0]>) =>
    stageMenu({ stages: [entry("stage")], creating: [], nowMs: NOW, ...over });

  it("says a stage being set up as the stages being created, whatever runs there is unread", () => {
    for (const state of ["empty", "checking"] as const) {
      const making = {
        ...stage({ projectId: "shop-stage", state }),
        version: undefined,
        firstDeploy: { kind: "setting-up", step: "app" } as const,
      };
      for (const chip of [undefined, { label: "stage", state: "empty" } as const]) {
        expect(menu({ stages: [entry("stage", { stop: making, chip })] }).stops[0]).toMatchObject({
          word: "Setting up…",
          dot: "spinner",
        });
      }
    }
  });

  it.each([
    { case: "nothing asked for", firstDeploy: undefined, word: "Not deployed yet" },
    {
      case: "on its way",
      firstDeploy: { kind: "on-its-way" } as const,
      word: "First deploy on its way",
    },
    { case: "failed", firstDeploy: { kind: "failed" } as const, word: "First deploy failed" },
    {
      case: "held for a deploy key",
      firstDeploy: { kind: "held" } as const,
      word: "Stage awaits a deploy key",
    },
  ])("says an empty stage's first deploy as its cell does: $case", ({ firstDeploy, word }) => {
    const empty = {
      ...stage({ projectId: "shop-stage", state: "empty" }),
      version: undefined,
      firstDeploy,
    };
    for (const chip of [undefined, { label: "stage", state: "empty" } as const]) {
      const [row] = menu({ stages: [entry("stage", { stop: empty, chip })] }).stops;
      expect(row?.word).toBe(word);
    }
  });

  it("says one stage's state in words, its version, when it was deployed, and its links", () => {
    expect(menu({}).stops).toEqual([
      {
        projectId: "shop-stage",
        name: "stage",
        version: "3f9c1b2",
        dot: "ok",
        word: "Deployed 40 min ago",
        tone: "muted",
        note: undefined,
        fix: undefined,
        routes: routes("stage.example.app"),
      },
    ]);
  });

  it.each([
    {
      name: "deploying",
      stage: entry("stage", {
        stop: stage({ projectId: "shop-stage", state: "deploying" }),
        chip: { label: "stage", state: "releasing", version: "main" },
      }),
      row: { dot: "spinner", word: "Deploying…", tone: "muted", note: undefined, fix: undefined },
    },
    {
      name: "its last deploy failed",
      stage: entry("stage", {
        stop: stage({ projectId: "shop-stage", state: "failed" }),
        chip: { label: "stage", state: "failed", version: "main" },
      }),
      row: {
        dot: "attention",
        word: "Deploy failed",
        tone: "amber",
        note: "The last deploy failed. 3f9c1b2 is still serving.",
        fix: {
          what: "The stage's last deploy failed",
          at: undefined,
          error: undefined,
          ask: "3f9c1b2 is still serving. Find out why and fix it.",
        },
      },
    },
    {
      name: "down",
      stage: entry("stage", {
        chip: { label: "stage", state: "down", version: "main" },
        down: ["web"],
      }),
      row: {
        dot: "failed",
        word: "Down",
        tone: "red",
        note: "Down: web failed on the platform.",
        fix: {
          what: "The stage is down: web failed on the platform",
          at: undefined,
          error: undefined,
          ask: "Find out why and bring it back.",
        },
      },
    },
    {
      name: "stopped on purpose",
      stage: entry("stage", { chip: { label: "stage", state: "stopped", version: "main" } }),
      row: { dot: "hollow", word: "Stopped", tone: "muted", note: undefined, fix: undefined },
    },
    {
      name: "not read yet",
      stage: entry("stage", {
        stop: stage({ projectId: "shop-stage", state: "checking", version: undefined }),
        chip: undefined,
      }),
      row: {
        dot: "off",
        word: "Checking what runs here…",
        tone: "muted",
        note: undefined,
        fix: undefined,
      },
    },
  ] as const)("says a stage $name", ({ stage: shown, row }) => {
    expect(menu({ stages: [shown] }).stops[0]).toMatchObject(row);
  });

  it("holds several stages, each its own group, the fix naming which", () => {
    const model = menu({
      stages: [
        entry("stage"),
        entry("qa", {
          stop: stage({ projectId: "shop-qa", name: "qa", state: "failed" }),
          chip: { label: "stage", state: "failed", version: "main" },
        }),
      ],
    });
    expect(model.stops.map((each) => [each.name, each.word])).toEqual([
      ["stage", "Deployed 40 min ago"],
      ["qa", "Deploy failed"],
    ]);
    expect(model.stops[1]?.fix?.what).toBe("The qa stage's last deploy failed");
    expect(model.stops[1]?.routes).toEqual(routes("qa.example.app"));
  });

  it("says a stage still being set up", () => {
    expect(
      menu({ stages: [], creating: [{ projectId: "shop-stage", name: "stage" }] }).stops,
    ).toEqual([
      {
        projectId: undefined,
        name: "stage",
        version: undefined,
        dot: "spinner",
        word: "Setting up…",
        tone: "muted",
        note: undefined,
        fix: undefined,
        routes: [],
      },
    ]);
  });
});

describe("a last-known chip's menu — what HQ last said, never said as current", () => {
  const NOW = Date.parse("2026-09-29T10:53:00Z");
  it("says production's row as last known", () => {
    const chip = asLastKnown({ label: "prod", state: "ok", version: "v0.1.0" });
    const menu = productionMenu({
      chip,
      projectId: "shop-prod",
      failure: undefined,
      down: [],
      routes: [],
      nowMs: NOW,
    });
    expect(menu.stops[0]).toMatchObject({ word: "Last known: Healthy", dot: "off" });
  });

  it("says each stage's row as last known", () => {
    const menu = stageMenu({
      stages: [
        {
          projectId: "shop-stage",
          name: "stage",
          stop: stage({ projectId: "shop-stage", name: "stage" }),
          chip: asLastKnown({ label: "stage", state: "ok", version: "main" }),
          deployedAt: "2026-09-29T10:13:00Z",
          down: [],
          routes: [],
        },
      ],
      creating: [],
      nowMs: NOW,
    });
    expect(menu.stops[0]?.word).toBe("Last known: Deployed 40 min ago");
  });
});

describe("fixProblemOf — what 'Ask <your Mate> to fix it' writes (S6)", () => {
  it("hands over a failed release: what, when, the error, and the ask", () => {
    expect(
      fixProblemOf({
        chip: { label: "prod", state: "failed", version: "v0.1.56" },
        failure: FAILED_RELEASE,
        down: [],
      }),
    ).toEqual({
      what: "Production's release v0.1.57 failed deploying app",
      at: "2026-09-29T10:41:00Z",
      error: "The build step exited with code 2 while installing packages.",
      ask: "v0.1.56 is still serving. Find out why, fix it, and release again.",
    });
  });

  it("hands over production down, naming the services the platform marks failed", () => {
    expect(
      fixProblemOf({
        chip: { label: "prod", state: "down", version: "v2.3.0" },
        failure: undefined,
        down: ["app"],
      }),
    ).toEqual({
      what: "Production is down: app failed on the platform",
      at: undefined,
      error: undefined,
      ask: "v2.3.0 was the last release. Find out why and bring it back.",
    });
  });

  it("hands over production down and the release that failed, both at once", () => {
    expect(
      fixProblemOf({
        chip: { label: "prod", state: "down", version: "v2.3.0" },
        failure: FAILED_RELEASE,
        down: ["app"],
      }),
    ).toEqual({
      what: "Production is down: app failed on the platform, and its release v0.1.57 failed deploying app",
      at: "2026-09-29T10:41:00Z",
      error: "The build step exited with code 2 while installing packages.",
      ask: "v2.3.0 was the last release. Find out why, bring it back, and release again.",
    });
  });

  it("hands over a release that failed while production is stopped", () => {
    expect(
      fixProblemOf({
        chip: { label: "prod", state: "stopped", version: "v0.1.56" },
        failure: FAILED_RELEASE,
        down: [],
      }),
    ).toEqual({
      what: "Production's release v0.1.57 failed deploying app",
      at: "2026-09-29T10:41:00Z",
      error: "The build step exited with code 2 while installing packages.",
      ask: "Production is stopped. Find out why, fix it, and release again.",
    });
  });

  it.each([
    {
      name: "the stage",
      input: { name: "stage", serving: "3f9c1b2" },
      what: "The stage's last deploy failed",
      ask: "3f9c1b2 is still serving. Find out why and fix it.",
    },
    {
      name: "a stage by its own name",
      input: { name: "qa", serving: undefined },
      what: "The qa stage's last deploy failed",
      ask: "Find out why and fix it.",
    },
  ])("hands over $name whose last deploy failed", ({ input: given, what, ask }) => {
    expect(
      fixProblemOf({
        chip: { label: "stage", state: "failed" },
        failure: FAILED_RELEASE,
        down: [],
        ...given,
      }),
    ).toEqual({ what, at: undefined, error: undefined, ask });
  });

  it.each([
    { state: "ok" },
    { state: "waiting" },
    { state: "releasing" },
    { state: "stopped" },
    { state: "creating" },
    { state: "empty" },
  ] as const)("offers no fix for $state", ({ state }) => {
    expect(
      fixProblemOf({ chip: { label: "prod", state, version: "v1" }, failure: undefined, down: [] }),
    ).toBeUndefined();
  });
});

describe("deployedAgo", () => {
  const NOW = Date.parse("2026-09-29T12:00:00Z");
  it.each([
    { at: "2026-09-29T11:59:40Z", words: "just now" },
    { at: "2026-09-29T11:20:00Z", words: "40 min ago" },
    { at: "2026-09-29T09:00:00Z", words: "3 h ago" },
    { at: "2026-09-26T12:00:00Z", words: "3 days ago" },
    { at: "not a time", words: undefined },
  ])("$at reads $words", ({ at, words }) => {
    expect(deployedAgo(at, NOW)).toBe(words);
  });
});

describe("draftParts — the fix request as its preview shows it", () => {
  it("splits the words into paragraphs and a log's lines into a code box", () => {
    expect(
      draftParts(
        "Production's release v0.1.57 failed at 10:41, 12 minutes ago.\n\nThe error: Build failed\n\nBuild log · v0.1.57:\n```\nERR one\nERR two\n```\n\nFind out why, fix it, and release again.",
      ),
    ).toEqual([
      { kind: "words", text: "Production's release v0.1.57 failed at 10:41, 12 minutes ago." },
      { kind: "words", text: "The error: Build failed" },
      { kind: "words", text: "Build log · v0.1.57:" },
      { kind: "code", text: "ERR one\nERR two" },
      { kind: "words", text: "Find out why, fix it, and release again." },
    ]);
  });
});

describe("buildingOf — a deploy running on a stop: what served before it, what it builds", () => {
  const running = (label: string) => ({
    kind: "running" as const,
    activatedAt: null,
    version: version(label),
  });
  it.each([
    {
      name: "a build with what ran before it",
      deployment: {
        state: "known" as const,
        value: {
          kind: "deploying" as const,
          version: version("v0.1.45"),
          previous: running("v0.1.44"),
        },
      },
      building: { from: "v0.1.44", to: "v0.1.45" },
    },
    {
      name: "a first build, nothing before it",
      deployment: {
        state: "known" as const,
        value: {
          kind: "deploying" as const,
          version: version("v0.1.0"),
          previous: { kind: "none" as const },
        },
      },
      building: { from: undefined, to: "v0.1.0" },
    },
    {
      name: "nothing building",
      deployment: { state: "known" as const, value: running("v0.1.44") },
      building: undefined,
    },
    { name: "nothing read", deployment: undefined, building: undefined },
  ])("$name", ({ deployment, building }) => {
    expect(buildingOf(deployment as Parameters<typeof buildingOf>[0])).toEqual(building);
  });
});

it("an unread production says the shared read line", () => {
  const view = productionChip(input({ production: checking() }));
  const drawn = drawnChip(view)!;
  expect(chipFace(drawn).words).toBe("Production, Checking what runs here…");
  expect(chipDot(drawn)).toBe("off");
});

it("keeps unread stops unknown while their serving status is also unread", () => {
  const serving = { kind: "unknown" } as const;
  expect(productionChip(input({ production: checking(), serving }))).toEqual({ kind: "unknown" });
  expect(
    stageStopChip({
      stop: stop({ state: "checking", version: undefined }),
      serving,
      releases: { kind: "waiting" },
    }),
  ).toEqual({ kind: "unknown" });
});

it("shows a failed runtime attempt even while serving metadata is unread", () => {
  const readLine = "Couldn't read what runs here. Zerops didn't answer.";
  const failed = stop({ state: "checking", version: undefined, readLine, readFailed: true });
  const serving = { kind: "unknown" } as const;
  const production = productionChip(
    input({ production: { kind: "checking", stop: failed, line: readLine }, serving }),
  );
  expect(production).toEqual({
    kind: "chip",
    chip: { label: "prod", state: "unverified", readLine },
  });
  expect(stageStopChip({ stop: failed, serving, releases: { kind: "waiting" } })).toEqual({
    kind: "chip",
    chip: { label: "stage", state: "unverified", readLine },
  });
});
