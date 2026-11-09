import {
  canonicalEnvironmentRow,
  canonicalEnvironmentRowInputsOf,
  groupFlow,
  placeAddresses,
  putLiveHasChange,
  type GroupFlowProduction,
  type GroupFlowStop,
  type RecipeReach,
} from "@t3tools/client-runtime/zerops";
import { HqEnvironmentId } from "@t3tools/contracts";
import type { HqGitNavigationEnvironment } from "@t3tools/shared/hqStream";
import { describe, expect, it } from "vite-plus/test";

import type { ProductionChip } from "../SidebarProductionChip.logic";
import type { MateRowView } from "../SidebarMateRow.logic";
import { entry, pull, WREN } from "./flowTestFixtures";
import { groupFlowInputOf } from "./projectsView.logic";
import {
  cardChanges,
  cardMateReading,
  cardSecondWords,
  cardReady,
  foldMates,
  mateChangeForReview,
  mateChangesForReview,
  historyOffered,
  productionBuilding,
  releaseProductionRuns,
  placeLines,
  rollBackTarget,
  siteOf,
  setupChangeWords,
  sinceWords,
  soleSite,
} from "./projectCard.logic";

const NOW = Date.parse("2026-10-10T12:00:00Z");

function stop(over: Partial<GroupFlowStop> = {}): GroupFlowStop {
  return {
    projectId: "prod",
    name: "production",
    state: "deployed",
    version: {
      name: "v2.3.1",
      commit: undefined,
      sha: undefined,
      taggedBy: undefined,
      label: "v2.3.1",
    },
    source: "release",
    addresses: [{ service: "app", url: "https://shop.acme.com/" }],
    ...over,
  };
}

const LIVE: GroupFlowProduction = { kind: "live", stop: stop(), line: "v2.3.1" };

function chip(over: Partial<ProductionChip>): ProductionChip {
  return { label: "prod", state: "ok", version: "v2.3.1", ...over };
}

const words = (flow: Parameters<typeof placeLines>[0]) =>
  placeLines(flow).map((line) => ({
    dot: line.dot,
    words: line.words.join(" · "),
    name: line.name,
  }));

describe("production's line at a card's foot", () => {
  it("A card calls confirmed Git delivery pushed without claiming that production runs it.", () => {
    const at = "2026-10-13T10:00:00Z";
    const sha = "a".repeat(40);
    const target = { kind: "git", branch: "main", delivery: "direct" } as const;
    const attachment = { environmentId: HqEnvironmentId.make("git-prod"), createdAt: at, target };
    const remote = {
      url: "https://github.com/acme/app.git",
      repositoryId: "1",
      keptAt: at,
      keptBy: "custodian",
      expiresAt: null,
      invalidSince: null,
    };
    const environment: HqGitNavigationEnvironment = {
      id: attachment.environmentId,
      target,
      tier: "production",
      name: "Production",
      sources: ["release"],
      order: 1,
      keyHeld: false,
      keyInvalid: false,
      birth: null,
      release: {
        id: "rollout",
        target: "git",
        releaseTarget: attachment,
        tag: "v2.0.0",
        planned: true,
        ended: true,
        endedAt: at,
        landed: false,
        leftOut: [],
      },
      jobs: [
        {
          id: "push",
          kind: "push",
          service: "app",
          sha,
          state: "pushed",
          cause: "release",
          ref: "v2.0.0",
          reason: null,
          appVersionId: null,
          processId: null,
          requestedBy: "releaser",
          at,
          endedAt: at,
          supersededBy: null,
          evidence: {
            confirmed: {
              remote,
              ref: "refs/heads/main",
              before: null,
              after: sha,
              at,
              via: "answer",
            },
            nextActor: "none",
            nextAction: "",
          },
        },
      ],
    };
    const [input] = canonicalEnvironmentRowInputsOf({
      environments: [environment],
      projectNames: new Map(),
      services: [],
      versions: new Map(),
      git: {
        releases: [
          {
            tag: "v2.0.0",
            sha,
            entries: [{ service: "app", sha }],
            target: "git",
            releaseTarget: attachment,
            by: "releaser",
            at,
            state: "approved",
            reason: null,
            rollbackOf: null,
          },
        ],
      },
    });
    const { flow } = entry([WREN], {
      stops: [
        {
          projectId: "",
          name: "Production",
          tier: "production",
          row: canonicalEnvironmentRow(input!),
          deployment: undefined,
          addresses: [],
        },
      ],
    });
    expect(placeLines({ flow, nowMs: NOW })).toMatchObject([
      {
        dot: "none",
        words: ["Pushed v2.0.0"],
        name: "prod",
        trouble: false,
        addresses: [],
      },
    ]);
  });

  it("An application whose environments deliver to Git says each environment's push on its card, never Not released yet", () => {
    const at = "2026-10-13T10:00:00Z";
    const sha = "a".repeat(40);
    const remote = {
      url: "https://github.com/acme/app.git",
      repositoryId: "1",
      keptAt: at,
      keptBy: "custodian",
      expiresAt: null,
      invalidSince: null,
    };
    const gitEnvironment = (
      id: string,
      tier: "stage" | "production",
      name: string,
      branch: string,
      order: number,
      tag: string,
    ): HqGitNavigationEnvironment => {
      const target = { kind: "git", branch, delivery: "direct" } as const;
      const attachment = { environmentId: HqEnvironmentId.make(id), createdAt: at, target };
      return {
        id: attachment.environmentId,
        target,
        tier,
        name,
        sources: tier === "production" ? ["release"] : ["main"],
        order,
        keyHeld: false,
        keyInvalid: false,
        birth: null,
        release: {
          id: `rollout-${id}`,
          target: "git",
          releaseTarget: attachment,
          tag,
          planned: true,
          ended: true,
          endedAt: at,
          landed: false,
          leftOut: [],
        },
        jobs: [
          {
            id: `push-${id}`,
            kind: "push",
            service: "app",
            sha,
            state: "pushed",
            cause: "release",
            ref: tag,
            reason: null,
            appVersionId: null,
            processId: null,
            requestedBy: "releaser",
            at,
            endedAt: at,
            supersededBy: null,
            evidence: {
              confirmed: {
                remote,
                ref: `refs/heads/${branch}`,
                before: null,
                after: sha,
                at,
                via: "answer",
              },
              nextActor: "none",
              nextAction: "",
            },
          },
        ],
      };
    };
    const rows = canonicalEnvironmentRowInputsOf({
      environments: [
        gitEnvironment("git-prod", "production", "Production", "main", 1, "v2.0.0"),
        gitEnvironment("git-stage", "stage", "Stage", "mate-stage", 2, "v2.1.0-rc"),
      ],
      projectNames: new Map(),
      services: [],
      versions: new Map(),
    }).map((input) => canonicalEnvironmentRow(input));
    const flow = groupFlow(
      groupFlowInputOf({
        groupId: "g",
        members: [],
        flow: {
          environments: rows,
          pullRequests: [],
          merged: [],
          release: {
            gate: { allowed: false, reason: "" },
            suggestion: "",
            untold: [],
            contents: [],
          },
        },
        deployments: new Map(),
        pending: [],
      }),
    );
    const lines = placeLines({ flow, nowMs: NOW });
    const lineOf = (tier: "stage" | "production") =>
      rows.find((row) => row.tier === tier)?.git?.line;
    expect(lines.map((line) => [line.name, line.git?.line])).toEqual([
      ["Stage", lineOf("stage")],
      ["prod", lineOf("production")],
    ]);
    expect(lines.flatMap((line) => line.words)).not.toContain("Not released yet");
    expect(lines).toHaveLength(2);
  });

  const since = sinceWords("2026-10-09T08:00:00Z", NOW);
  it.each([
    {
      case: "running, since when",
      flow: { production: LIVE, stages: [] },
      chip: undefined,
      lines: [{ dot: "running", words: `Running · v2.3.1 · ${since}`, name: "prod" }],
    },
    {
      case: "a failed release, and what still runs",
      flow: { production: LIVE, stages: [] },
      chip: chip({ state: "failed", version: "v1.8.2" }),
      lines: [{ dot: "failed", words: "Release failed · still runs v1.8.2", name: "prod" }],
    },
    {
      case: "a release on its way",
      flow: { production: LIVE, stages: [] },
      chip: chip({ state: "releasing", next: "v0.5.0" }),
      lines: [{ dot: "releasing", words: "Releasing v0.5.0", name: "prod" }],
    },
    {
      case: "down, and its cause",
      flow: { production: LIVE, stages: [] },
      chip: chip({ state: "down" }),
      lines: [{ dot: "down", words: "Down · app failed", name: "prod" }],
    },
    {
      case: "nothing released yet",
      flow: { production: { kind: "empty", stop: stop(), line: "" } as const, stages: [] },
      chip: undefined,
      lines: [{ dot: "none", words: "Not released yet", name: "prod" }],
    },
    {
      case: "no production at all",
      flow: { production: { kind: "absent" } as const, stages: [stop({ name: "stage" })] },
      chip: undefined,
      lines: [
        { dot: "running", words: "Running · v2.3.1", name: "stage" },
        { dot: "none", words: "Not added", name: "prod" },
      ],
    },
    {
      case: "no production, and a stage in trouble: the stage's line, by name",
      flow: {
        production: { kind: "absent" } as const,
        stages: [stop({ name: "stage", projectId: "stage", state: "failed" })],
      },
      chip: undefined,
      lines: [
        { dot: "failed", words: "Deploy failed", name: "stage" },
        { dot: "none", words: "Not added", name: "prod" },
      ],
    },
  ] as const)("says $case", ({ flow, chip: read, lines }) => {
    expect(
      words({
        flow,
        chip: read,
        since: "2026-10-09T08:00:00Z",
        down: new Map([["prod", ["app"]]]),
        nowMs: NOW,
      }),
    ).toEqual(lines);
  });

  // The onboarding run: a new production read "Running" for a minute while nothing ran there yet.
  it.each([
    {
      case: "nothing released there yet, with a release offered",
      production: {
        kind: "ready-to-release",
        stop: stop({ state: "empty", version: undefined, addresses: [] }),
        line: "",
        candidate: { tag: "v0.1.0", waiting: 1 },
      },
      lines: [{ dot: "none", words: "Not released yet", name: "prod" }],
    },
    {
      case: "a first deploy still building there, with a release offered",
      production: {
        kind: "ready-to-release",
        stop: stop({ state: "deploying", version: undefined, addresses: [] }),
        line: "",
        candidate: { tag: "v0.1.0", waiting: 1 },
      },
      lines: [{ dot: "releasing", words: "Deploying…", name: "prod" }],
    },
  ] as const)(
    "says Running only where something runs, where no chip was read: $case",
    ({ production, lines }) => {
      expect(words({ flow: { production, stages: [] }, nowMs: NOW })).toEqual(lines);
    },
  );

  it("says what the flow says where no chip was read: a failed deploy, and what still runs", () => {
    const failed: GroupFlowProduction = {
      kind: "deploy-failed",
      stop: stop({ version: { ...stop().version!, label: "v1.8.2" } }),
      line: "",
      candidate: undefined,
    };
    expect(words({ flow: { production: failed, stages: [] }, nowMs: NOW })).toEqual([
      { dot: "failed", words: "Release failed · still runs v1.8.2", name: "prod" },
    ]);
  });
});

describe("a card's places", () => {
  it("says every stage by its name before production, each with its address", () => {
    const lines = placeLines({
      flow: {
        production: LIVE,
        stages: [
          stop({
            projectId: "stage",
            name: "stage",
            addresses: [{ service: "app", url: "https://stage.acme.com/" }],
          }),
          stop({ projectId: "qa", name: "qa", state: "deploying", addresses: [] }),
        ],
      },
      stageChips: new Map([["stage", chip({ label: "stage", version: "v2.4.0" })]]),
      nowMs: NOW,
    });
    expect(
      lines.map((line) => [
        line.name,
        line.dot,
        line.words.join(" · "),
        line.addresses.map((address) => address.url),
      ]),
    ).toEqual([
      ["stage", "running", "Running · v2.4.0", ["https://stage.acme.com/"]],
      ["qa", "releasing", "Deploying…", []],
      ["prod", "running", "Running · v2.3.1", ["https://shop.acme.com/"]],
    ]);
  });

  // A pending publication retains address progress; published stages keep their running label.
  it.each([
    {
      case: "while HQ still brings it up",
      birth: { ended: false },
      pending: true,
      published: false,
      words: "Turning its address on…",
    },
    {
      case: "once HQ has brought it up",
      birth: { ended: true },
      pending: false,
      published: true,
      words: "Running",
    },
    {
      case: "once HQ has brought it up, while the address its app serves is still being turned on",
      birth: { ended: true },
      pending: true,
      published: false,
      words: "Turning its address on…",
    },
    // Without public-access evidence, a finished birth and an open port promise no publication.
    {
      case: "once HQ has brought it up, its address still off: running, never turning it on for ever",
      birth: { ended: true },
      pending: undefined,
      published: false,
      words: "Running",
    },
    {
      case: "once HQ has brought it up, serving nothing an address would open",
      birth: { ended: true },
      pending: false,
      published: true,
      words: "Running",
    },
    {
      case: "while HQ still brings it up, serving nothing an address would open",
      birth: { ended: false },
      pending: false,
      published: true,
      words: "Running",
    },
    {
      case: "where HQ did not bring it up",
      birth: undefined,
      pending: false,
      published: true,
      words: "Running",
    },
  ])(
    "says a stage runs only with its address, $case",
    ({ birth, pending, published, words: said }) => {
      const lines = placeLines({
        addressPending: pending === undefined ? new Map() : new Map([["stage", pending]]),
        flow: {
          production: { kind: "absent" },
          stages: [
            stop({
              projectId: "stage",
              name: "stage",
              source: "main",
              addresses: published ? [{ service: "app", url: "https://stage.example.com/" }] : [],
              ...(birth === undefined ? {} : { birth }),
            }),
          ],
        },
        stageChips: new Map([["stage", chip({ label: "stage", version: "main" })]]),
        nowMs: NOW,
      });
      expect(lines[0]?.words.join(" · ")).toBe(said);
    },
  );
});

describe("since when production runs what it runs", () => {
  it.each([
    { at: "2026-10-10T09:05:00Z", expected: "since " },
    { at: "2026-10-07T09:05:00Z", expected: "since " },
    { at: "2026-09-18T09:05:00Z", expected: "since " },
  ])("is said as a time today, a weekday this week, a date before: $at", ({ at, expected }) => {
    expect(sinceWords(at, NOW)?.startsWith(expected)).toBe(true);
  });

  it("says nothing of an unknown time", () => {
    expect(sinceWords(undefined, NOW)).toBeUndefined();
    expect(sinceWords("not a date", NOW)).toBeUndefined();
  });
});

describe("a release ready to go", () => {
  const stage = stop({ projectId: "stage", name: "stage", source: "main" });

  it.each([
    {
      case: "a release is on its way",
      production: { kind: "releasing", stop: stop(), line: "", tag: "v2.4.0" },
    },
    { case: "nothing waits", production: LIVE },
  ] as const)("is absent while $case", ({ production }) => {
    expect(
      cardReady({
        production,
        stages: [stage],
        main: { head: undefined, hasCode: true, notLive: 1, notLiveAtLeast: false },
      }),
    ).toBeUndefined();
  });
});

// The run's card said a release on its way twice: "Releasing v0.1.0" on production's line and
// "Putting v0.1.0 live" in a block of its own (the owner, 2026-10-16: one place per fact).
describe("a release on its way", () => {
  const main = { head: undefined, hasCode: true, notLive: 1, notLiveAtLeast: false };
  it.each([
    {
      case: "is said once, on production's line, and offers no release beside it",
      production: { kind: "releasing", stop: stop(), line: "", tag: "v2.4.0" },
      words: ["Releasing v2.4.0"],
    },
    {
      // The run's roll back read as a release of a tag nobody asked for.
      case: "is said as the roll back it is, by the release it goes back to",
      production: { kind: "releasing", stop: stop(), line: "", tag: "v2.4.1" },
      rollsBackTo: "v2.3.0",
      words: ["Rolling back to v2.3.0"],
    },
    {
      case: "is absent while none is on its way",
      production: LIVE,
      words: ["Running", "v2.3.1"],
    },
  ] as const)("$case", ({ production, words, ...rest }) => {
    const flow = { production, stages: [], main };
    const rollsBackTo = "rollsBackTo" in rest ? rest.rollsBackTo : undefined;
    const [line] = placeLines({ flow, rollsBackTo, nowMs: 0 });
    // The menu's chip says it the same way.
    const [chipped] = placeLines({
      flow,
      rollsBackTo,
      chip: chip(
        production.kind === "releasing"
          ? { state: "releasing", next: production.tag }
          : { state: "releasing" },
      ),
      nowMs: 0,
    });
    if (production.kind === "releasing") expect(chipped?.words).toEqual(words);
    expect(line?.words).toEqual(words);
    expect(cardReady(flow)).toBeUndefined();
  });
});

// The onboarding run: production offered "Put it live" while the Mate was still creating its
// services and nothing was there to put live.
describe("Put it live on a card", () => {
  const open = (kind: "code" | "recipe") => pull({ kind, number: 3, title: "Add the tea list" });
  it.each([
    { case: "nothing merged and no change open", merged: [], open: [], offered: false },
    {
      case: "only the Mate's setup files open",
      merged: [],
      open: [open("recipe")],
      offered: false,
    },
    { case: "a change of the app open", merged: [], open: [open("code")], offered: true },
    { case: "the app's code merged", merged: [open("code")], open: [], offered: true },
  ])(
    "is offered only once there is a change to put live: $case",
    ({ merged, open: pulls, offered }) => {
      expect(putLiveHasChange({ merged, pullRequests: pulls })).toBe(offered);
    },
  );
});

function view(over: Partial<MateRowView>): Pick<MateRowView, "state" | "ask" | "reply"> {
  return { state: "idle", ask: "Add a cart", reply: undefined, ...over };
}

describe("a Mate on a card", () => {
  it.each([
    {
      case: "lifts the viewer's plan with Approve plan",
      input: {
        view: view({
          state: "needs",
          reply: { kind: "words", text: "Plan: move search", tone: "ink" },
        }),
        status: "planReady",
        mine: true,
        review: undefined,
      },
      expected: { text: "Plan: move search", tone: "ink", lift: { kind: "plan" } },
    },
    {
      case: "lifts the viewer's question with Answer…",
      input: {
        view: view({
          state: "needs",
          reply: { kind: "words", text: "Stripe or Adyen?", tone: "ink" },
        }),
        status: "input",
        mine: true,
        review: undefined,
      },
      expected: { text: "Stripe or Adyen?", tone: "ink", lift: { kind: "question" } },
    },
    {
      case: "leaves another's question at rest",
      input: {
        view: view({
          state: "needs",
          reply: { kind: "words", text: "Stripe or Adyen?", tone: "muted" },
        }),
        status: "input",
        mine: false,
        review: undefined,
      },
      expected: { text: "Stripe or Adyen?", tone: "muted", lift: undefined },
    },
    {
      case: "lifts the viewer's failed Mate with its fix",
      input: {
        view: view({
          state: "failed",
          reply: { kind: "words", text: "EXPO_TOKEN is missing", tone: "failed" },
        }),
        status: "failed",
        mine: true,
        review: undefined,
      },
      expected: { text: "EXPO_TOKEN is missing", tone: "failed", lift: { kind: "fix" } },
    },
    {
      case: "lifts the viewer's change waiting for review",
      input: {
        view: view({ state: "needs", reply: { kind: "words", text: "#41 is ready", tone: "ink" } }),
        status: "idle",
        mine: true,
        review: pull({ number: 41 }),
      },
      expected: {
        text: "Greet with a fuller line",
        tone: "ink",
        lift: { kind: "review", pull: pull({ number: 41 }) },
      },
    },
    {
      // Its last words are of another moment, a limit it hit: the menu's row names the change.
      case: "names the change it lifts for review, not what the Mate said last",
      input: {
        view: view({
          reply: { kind: "words", text: "Usage limit reached until Friday", tone: "muted" },
        }),
        status: "idle",
        mine: true,
        review: pull({ number: 7, title: "Build a reading list" }),
      },
      expected: {
        text: "Build a reading list",
        tone: "ink",
        lift: { kind: "review", pull: pull({ number: 7, title: "Build a reading list" }) },
      },
    },
    {
      case: "says what was asked where the Mate has not answered",
      input: { view: view({ reply: undefined }), status: "idle", mine: true, review: undefined },
      expected: { text: "Add a cart", tone: "muted", lift: undefined },
    },
  ] as const)("$case", ({ input, expected }) => {
    expect(cardMateReading(input)).toEqual(expected);
  });

  it.each([
    { case: "its conversations read", read: true, text: "Nothing asked yet" },
    { case: "its conversations not read yet", read: false, text: undefined },
  ])("says nothing was asked of a Mate only once it knows: $case", ({ read, text }) => {
    const never = view({ ask: undefined, reply: undefined });
    expect(
      cardMateReading({ view: never, status: "idle", mine: true, review: undefined, read }).text,
    ).toBe(text);
  });

  it.each([
    {
      case: "a colleague's Mate waiting on its person: whom it waits on",
      second: { kind: "waits-on", text: "Waits on Alex" },
      expected: { text: "Waits on Alex", tone: "muted" },
    },
    {
      case: "the viewer's change waiting: its title, in ink",
      second: { kind: "change", title: "Spring banner", mine: true },
      expected: { text: "Spring banner", tone: "ink" },
    },
    {
      case: "a colleague's open change: its title, in review",
      second: { kind: "change", title: "Spring banner", mine: false },
      expected: { text: "Spring banner · in review", tone: "muted" },
    },
    {
      case: "at its limit: when it picks up",
      second: { kind: "paused", until: "2026-10-10T13:00:00Z" },
      expected: { text: "Paused until 1:00 PM", tone: "muted" },
    },
    {
      case: "its words in the tone the menu chose",
      second: { kind: "reply", tone: "failed" },
      expected: { text: "EXPO_TOKEN is missing", tone: "failed" },
    },
    {
      case: "what was asked",
      second: { kind: "ask", pending: false },
      expected: { text: "Add a cart", tone: "muted" },
    },
    {
      case: "an automated Mate's task, in ink",
      second: { kind: "task", text: "#12 Fix the checkout total", on: true },
      expected: { text: "#12 Fix the checkout total", tone: "ink" },
    },
    {
      case: "an automated Mate waiting for a task, muted",
      second: { kind: "task", text: "Waiting for a task", on: false },
      expected: { text: "Waiting for a task", tone: "muted" },
    },
    { case: "nothing", second: { kind: "none" }, expected: { text: undefined, tone: "muted" } },
  ] as const)("says the menu row's line 2: $case", ({ second, expected }) => {
    expect(
      cardSecondWords({
        second,
        reply: { kind: "words", text: "EXPO_TOKEN is missing", tone: "muted" },
        askLine: { kind: "ask", text: "Add a cart" },
        pausedUntil: () => "1:00 PM",
      }),
    ).toEqual(expected);
  });

  it("names the task an automated Mate works on before its step, as the menu row does", () => {
    expect(
      cardSecondWords({
        second: { kind: "reply", tone: undefined, task: "#12 Fix the checkout total" },
        reply: { kind: "live", words: "Running the tests" },
        askLine: undefined,
        pausedUntil: () => "1:00 PM",
      }),
    ).toEqual({ text: "#12 Fix the checkout total · Running the tests", tone: "muted" });
  });

  it.each([
    { case: "the viewer's", by: "You", text: "You: Add a cart" },
    { case: "a colleague's", by: "Jan", text: "Jan: Add a cart" },
    { case: "nobody named yet", by: undefined, text: "Add a cart" },
  ])("says whose words the ask is, as the menu row does: $case", ({ by, text }) => {
    expect(
      cardSecondWords({
        second: { kind: "ask", pending: false },
        reply: undefined,
        askLine: { kind: "ask", text: "Add a cart", by },
        pausedUntil: () => "1:00 PM",
      }).text,
    ).toBe(text);
  });

  it("says the menu row's line where nothing lifts it, and its own fuller words where it is lifted", () => {
    const line = { text: "Waits on Alex", tone: "muted" as const };
    const asking = view({
      state: "needs",
      reply: { kind: "words", text: "Stripe or Adyen?", tone: "ink" },
    });
    expect(
      cardMateReading({ view: asking, status: "input", mine: false, review: undefined, line }).text,
    ).toBe("Waits on Alex");
    expect(
      cardMateReading({ view: asking, status: "input", mine: true, review: undefined, line }).text,
    ).toBe("Stripe or Adyen?");
  });

  it("says what a working Mate is on", () => {
    const working = view({
      state: "working",
      reply: { kind: "live", words: "Running the cart tests" },
    });
    expect(
      cardMateReading({ view: working, status: "working", mine: true, review: undefined }),
    ).toEqual({
      text: "Running the cart tests",
      tone: "muted",
      lift: undefined,
    });
  });

  it("says how many of a Mate's changes wait for review, where several do", () => {
    expect(
      cardSecondWords({
        second: { kind: "change", title: "Cart page", mine: true, count: 2 },
        reply: undefined,
        askLine: undefined,
        pausedUntil: () => "1:00 PM",
      }),
    ).toEqual({ text: "2 changes in review", tone: "ink" });
    const resting = view({ state: "idle" });
    expect(
      cardMateReading({ view: resting, status: undefined, mine: true, review: pull(), reviews: 2 })
        .text,
    ).toBe("2 changes in review");
  });

  it("finds every change of a Mate's that waits for review, one per task", () => {
    const flow = {
      pullRequests: [
        { pull: pull(), blocked: null, state: undefined, review: true },
        { pull: pull({ number: 2 }), blocked: null, state: undefined, review: true },
        {
          pull: pull({ number: 3, mateProjectId: "kai-dev" }),
          blocked: null,
          state: undefined,
          review: true,
        },
      ],
    };
    expect(mateChangesForReview(flow, "wren-dev").map((each) => each.number)).toEqual([1, 2]);
    expect(mateChangeForReview(flow, "wren-dev")?.number).toBe(1);
  });

  // The project's card asks for a recipe change once, as a setup change (`cardChanges`).
  it("leaves a Mate's recipe change out of its overview row, which reviews its code", () => {
    const recipe = pull({ number: 7, kind: "recipe", title: "Mate: the group's import files" });
    const flow = {
      pullRequests: [
        { pull: recipe, blocked: null, state: undefined, review: true },
        { pull: pull({ number: 2 }), blocked: null, state: undefined, review: true },
      ],
    };
    expect(mateChangesForReview(flow, "wren-dev").map((each) => each.number)).toEqual([2]);
    expect(mateChangeForReview(flow, "wren-dev")?.number).toBe(2);
    expect(mateChangeForReview({ pullRequests: [flow.pullRequests[0]!] }, "wren-dev")).toBe(
      undefined,
    );
  });

  // D7, one rule with the menu (`changeShowsReview`): while Wren works, its changes show no Review.
  it.each([
    { case: "at work", review: false, expected: undefined },
    { case: "at rest", review: true, expected: 1 },
  ])(
    "shows its changes' Review by the rule the menu reads, its Mate $case",
    ({ review, expected }) => {
      const flow = { pullRequests: [{ pull: pull(), blocked: null, state: undefined, review }] };
      expect(mateChangeForReview(flow, "wren-dev")?.number).toBe(expected);
    },
  );
});

describe("a card's Mates", () => {
  it("fold the quiet ones past four, keeping the loud ones and the person's order", () => {
    const mates = ["a", "B", "c", "d", "E", "f"];
    const { shown, folded } = foldMates(mates, (mate) => mate === mate.toUpperCase());
    expect(shown).toEqual(["a", "B", "c", "E"]);
    expect(folded).toEqual(["d", "f"]);
  });

  it("all stand when there are four or fewer", () => {
    expect(foldMates(["a", "b", "c", "d"], () => false).folded).toEqual([]);
  });
});

describe("a card's header", () => {
  it("names production's address as a person reads it", () => {
    expect(siteOf("https://shop.acme.com/")).toBe("shop.acme.com");
    expect(siteOf(undefined)).toBeUndefined();
  });

  // The owner, 2026-10-11, of one preview standing for several services: "preview of what? there
  // are multiple services, backend, frontend, how do you know?" A production serving a backend and
  // a storefront opened whichever sorted first, the backend.
  const served = (service: string, port: number, url: string) => ({
    service,
    port,
    url,
    host: url.replace(/^https?:\/\//u, ""),
  });
  it.each([
    { case: "none", routes: [], addresses: [], site: undefined },
    {
      case: "one service: its address, said whole",
      routes: [served("app", 3000, "https://shop.acme.com")],
      addresses: [{ service: "app", url: "https://shop.acme.com" }],
      site: "shop.acme.com",
    },
    {
      case: "a backend and a storefront: a door each, by its service, and no one address",
      routes: [
        served("api", 9000, "https://api.acme.com"),
        served("shop", 3000, "https://shop.acme.com"),
      ],
      addresses: [
        { service: "api", url: "https://api.acme.com" },
        { service: "shop", url: "https://shop.acme.com" },
      ],
      site: undefined,
    },
    {
      case: "a service's second port: the same page, not another door",
      routes: [
        served("app", 3000, "https://app-3000.acme.dev"),
        served("app", 8080, "https://app-8080.acme.dev"),
      ],
      addresses: [{ service: "app", url: "https://app-3000.acme.dev" }],
      site: "app-3000.acme.dev",
    },
  ])("opens a place by each service it serves: $case", ({ routes, addresses, site }) => {
    expect(placeAddresses(routes)).toEqual(addresses);
    expect(soleSite(placeAddresses(routes))).toBe(site);
  });
});

describe("a stage's line on a card", () => {
  // The run's stage read "Running · main": a branch is no version a person knows, nor is a commit.
  it.each([
    { case: "the branch it follows", version: "main", said: "Running" },
    { case: "a commit", version: "f1b66ee", said: "Running" },
    { case: "a release's tag", version: "v2.4.0", said: "Running · v2.4.0" },
  ])("names what a stage runs only by a release's tag, never by $case", ({ version, said }) => {
    const lines = placeLines({
      flow: {
        production: { kind: "absent" },
        stages: [
          stop({
            projectId: "stage",
            name: "stage",
            source: "main",
            version: {
              name: undefined,
              branch: "main",
              commit: "f1b66ee",
              sha: "f1b66ee0",
              taggedBy: undefined,
              label: "f1b66ee",
            },
          }),
        ],
      },
      stageChips: new Map([["stage", chip({ label: "stage", version })]]),
      nowMs: NOW,
    });
    expect(lines[0]?.words.join(" · ")).toBe(said);
  });
});

describe("production's actions", () => {
  // The run: History came 6 s into the first release and pushed the domain door 72 px aside.
  it.each([
    { case: "nothing released yet", releases: 0, runs: false, offered: false },
    { case: "its first release on its way", releases: 1, runs: false, offered: false },
    { case: "a release it runs", releases: 1, runs: true, offered: true },
  ])("offers production's history only once it runs a release: $case", (input) => {
    expect(historyOffered(input)).toBe(input.offered);
  });
});

describe("production's room while a release is on its way", () => {
  const BUILD = { from: "v1.0.0", to: "v1.1.0" };
  it.each([
    { case: "the flow says production deploys", kind: "deploying", building: BUILD, read: BUILD },
    {
      case: "the flow still offers the release",
      kind: "ready-to-release",
      building: BUILD,
      read: undefined,
    },
    { case: "the flow says it runs", kind: "live", building: BUILD, read: undefined },
    { case: "no build", kind: "deploying", building: undefined, read: undefined },
  ] as const)(
    "the card's chip reads a build only where its flow says production deploys: $case",
    (input) => {
      expect(productionBuilding(input.kind, input.building)).toEqual(input.read);
    },
  );
});

describe("the version production runs", () => {
  const row = (tag: string, standing?: "live" | "deploy-failed") => ({ tag, standing });
  it.each([
    { case: "no release", releases: [], inFlight: undefined, names: undefined },
    {
      case: "a first release still building",
      releases: [row("v1.0.0")],
      inFlight: "v1.0.0",
      names: undefined,
    },
    {
      case: "a first release on its way that production's services already name",
      releases: [row("v1.0.0", "live")],
      inFlight: "v1.0.0",
      names: undefined,
    },
    {
      case: "a first release whose deploy failed",
      releases: [row("v1.0.0", "deploy-failed")],
      names: undefined,
    },
    {
      case: "a first release that landed",
      releases: [row("v1.0.0", "live")],
      inFlight: undefined,
      names: "v1.0.0",
    },
    {
      case: "a second release still building",
      releases: [row("v1.1.0"), row("v1.0.0", "live")],
      inFlight: "v1.1.0",
      names: "v1.0.0",
    },
  ])(
    "A card names the version production runs only from a release that has landed: $case",
    (input) => {
      expect(releaseProductionRuns(input.releases, input.inFlight)).toBe(input.names);
    },
  );
});

describe("production's panel", () => {
  const release = (tag: string, taggedAt: string, standing?: "live", rollBack = true) => ({
    tag,
    taggedAt,
    standing,
    rollBack,
  });
  const releases = [
    release("v2.4.0", "2026-10-09T10:00:00Z", undefined),
    release("v2.3.1", "2026-10-07T10:00:00Z", "live"),
    release("v2.3.0", "2026-10-01T10:00:00Z", undefined, false),
    release("v2.2.0", "2026-09-20T10:00:00Z"),
  ];

  it("offers going back to the newest release before it that may be rolled back to", () => {
    expect(rollBackTarget(releases)).toBe("v2.2.0");
    expect(rollBackTarget([release("v1.0.0", "2026-09-01T00:00:00Z", "live")])).toBeUndefined();
  });
});

describe("a card's latest changes", () => {
  const release = (tag: string, taggedAt: string, standing?: "live" | "deploy-failed") => ({
    tag,
    taggedAt,
    standing,
  });
  // Newest first, as the flow lists them.
  const releases = [
    release("v1.0.4", "2026-10-08T10:00:00Z", "live"),
    release("v1.0.3", "2026-10-01T10:00:00Z"),
  ];
  /** Change `number`'s squash on main, whole. */
  const squash = (number: number) => String(number).padStart(40, "0");
  const merged = (number: number, mergedAt: string) =>
    pull({
      number,
      title: `Change ${String(number)}`,
      merged: true,
      mergedAt,
      mergeCommitSha: squash(number),
    });
  /** A stage running `runs`, deploying `deploying`; main's head the newest squash. */
  const stageOn = (runs: number | undefined, deploying?: number) => ({
    runs: runs === undefined ? [] : [squash(runs)],
    deploying: deploying === undefined ? [] : [squash(deploying)],
    mainHeads: new Map<string, string>(),
  });

  // The owner (2026-10-11): "quick history of latest PRs" — open ones with what stops them, and
  // merged ones with where they went.
  it.each([
    {
      case: "an open change: what stops it, or that it is ready",
      open: [pull({ number: 7, title: "Open one", updatedAt: "2026-10-10T09:00:00Z" })],
      merged: [],
      stage: stageOn(undefined),
      rows: [["Open one", true, "Ready to merge"]],
    },
    {
      case: "merged since the release production runs: on stage",
      open: [],
      merged: [merged(6, "2026-10-09T09:00:00Z")],
      stage: stageOn(6),
      rows: [["Change 6", false, "On stage"]],
    },
    {
      case: "merged since the release production runs, and no stage: not released yet",
      open: [],
      merged: [merged(6, "2026-10-09T09:00:00Z")],
      stage: undefined,
      rows: [["Change 6", false, "Merged · waits for production"]],
    },
    // The onboarding run: production, the release and the change each said "Not released yet".
    {
      case: "merged where production runs no release yet: merged, production's line says the rest",
      open: [],
      merged: [merged(6, "2026-10-09T09:00:00Z")],
      stage: undefined,
      noReleases: true,
      rows: [["Change 6", false, "Merged"]],
    },
    {
      case: "merged where nothing is released anywhere: merged",
      open: [],
      merged: [merged(6, "2026-10-09T09:00:00Z")],
      stage: undefined,
      production: false,
      rows: [["Change 6", false, "Merged"]],
    },
    {
      case: "merged before a release: in the release that took it",
      open: [],
      merged: [merged(5, "2026-10-07T09:00:00Z"), merged(4, "2026-09-30T09:00:00Z")],
      stage: stageOn(5),
      rows: [
        ["Change 5", false, "Live in v1.0.4"],
        ["Change 4", false, "Live in v1.0.3"],
      ],
    },
    {
      case: "open ones first, then the merged, newest first, five at most",
      open: [
        pull({ number: 9, title: "Older open", updatedAt: "2026-10-09T09:00:00Z" }),
        pull({ number: 10, title: "Newer open", updatedAt: "2026-10-10T09:00:00Z" }),
      ],
      merged: [
        merged(3, "2026-09-20T09:00:00Z"),
        merged(6, "2026-10-09T09:00:00Z"),
        merged(5, "2026-10-07T09:00:00Z"),
        merged(4, "2026-09-30T09:00:00Z"),
      ],
      stage: stageOn(6),
      rows: [
        ["Newer open", true, "Ready to merge"],
        ["Older open", true, "Ready to merge"],
        ["Change 6", false, "On stage"],
        ["Change 5", false, "Live in v1.0.4"],
        ["Change 4", false, "Live in v1.0.3"],
      ],
    },
    // The onboarding run: both changes read "On stage" for two minutes while the stage was not
    // deployed yet.
    {
      case: "merged while the stage runs nothing yet: not on stage",
      open: [],
      merged: [merged(6, "2026-10-09T09:00:00Z")],
      stage: stageOn(undefined),
      rows: [["Change 6", false, "Merged · waits for production"]],
    },
    {
      case: "merged while the stage still runs an older change: not on stage",
      open: [],
      merged: [merged(7, "2026-10-09T10:00:00Z"), merged(6, "2026-10-09T09:00:00Z")],
      stage: stageOn(6),
      rows: [
        ["Change 7", false, "Merged · waits for production"],
        ["Change 6", false, "On stage"],
      ],
    },
    {
      case: "merged while the stage deploys it: deploying to stage",
      open: [],
      merged: [merged(6, "2026-10-09T09:00:00Z")],
      stage: stageOn(undefined, 6),
      rows: [["Change 6", false, "Deploying to stage…"]],
    },
    {
      case: "merged while the stage runs main's head: on stage",
      open: [],
      merged: [merged(6, "2026-10-09T09:00:00Z")],
      stage: {
        ...stageOn(undefined),
        runs: ["f".repeat(40)],
        mainHeads: new Map([["app", "f".repeat(40)]]),
      },
      rows: [["Change 6", false, "On stage"]],
    },
    // The onboarding run: the Mate's setup files read "On stage" beside the reviewed change, as if
    // they were code that went there.
    {
      case: "the Mate's setup files: what they are, never a place they went",
      open: [],
      merged: [
        pull({
          repository: "group",
          kind: "recipe",
          number: 1,
          title: "Mate: the group's import files",
          merged: true,
          mergedAt: "2026-10-09T09:00:00Z",
        }),
      ],
      stage: stageOn(6),
      rows: [["Mate: the group's import files", false, "Setup files, not part of a release"]],
    },
    {
      case: "any other change to the setup repository: setup files too, as the release notes leave it out",
      open: [],
      merged: [
        pull({
          repository: "group",
          kind: "recipe",
          number: 2,
          title: "Raise the stage's memory",
          merged: true,
          mergedAt: "2026-10-09T09:00:00Z",
        }),
      ],
      stage: stageOn(6),
      rows: [["Raise the stage's memory", false, "Setup files, not part of a release"]],
    },
    // Larkspur, 2026-10-28: Core held a Mate's setup files for a person, as their merge
    // would change the stage and production built from them. Its Mate's Review leaves it out; its
    // row says what it changes once its review's files are read (`setupChangeWords`).
    {
      case: "a setup change waiting for a person: the project's setup, until its files are read",
      open: [
        pull({
          repository: "group",
          kind: "recipe",
          number: 2,
          title: "Mate: the group's import files",
        }),
      ],
      merged: [],
      stage: stageOn(6),
      rows: [["Mate: the group's import files", true, "Changes the project's setup"]],
    },
    {
      case: "a setup change waiting where no environment stands: the project's setup",
      open: [pull({ repository: "group", kind: "recipe", number: 2, title: "Add storage" })],
      merged: [],
      stage: undefined,
      production: false,
      rows: [["Add storage", true, "Changes the project's setup"]],
    },
    {
      case: "a setup change that does not merge: what stops it",
      open: [
        pull({
          repository: "group",
          kind: "recipe",
          number: 2,
          title: "Add storage",
          mergeability: "conflicting",
        }),
      ],
      merged: [],
      stage: stageOn(6),
      rows: [["Add storage", true, "Conflicts with main"]],
    },
  ])("says $case", ({ open, merged: landed, stage, production = true, noReleases, rows }) => {
    expect(
      cardChanges({
        open,
        merged: landed,
        releases: noReleases === true ? [] : releases,
        stage,
        production,
        limit: 5,
      }).map((change) => [change.pull.title, change.open, change.words]),
    ).toEqual(rows);
  });
});

// What its review reads of its files (`recipeReach`), never which environments the project has.
describe("setupChangeWords", () => {
  const reach = (over: Partial<RecipeReach> = {}): RecipeReach => ({
    stages: 0,
    production: false,
    later: [],
    unused: [],
    ...over,
  });
  it.each([
    { case: "its files unread", reach: undefined, words: "Changes the project's setup" },
    {
      case: "the stage's recipe and production's",
      reach: reach({ stages: 1, production: true }),
      words: "Changes how Stage and Production are built",
    },
    {
      case: "the stage's recipe, where two stages are made from it",
      reach: reach({ stages: 2 }),
      words: "Changes how the stages are built",
    },
    {
      case: "only production's recipe, where a stage stands too",
      reach: reach({ production: true }),
      words: "Changes how Production is built",
    },
    {
      case: "only recipes nothing in the project is made from",
      reach: reach({ unused: ["Remote (CDE)", "Local"] }),
      words: "Changes the project's setup",
    },
    {
      case: "only the recipe new Mates are made from",
      reach: reach({ later: ["mate"] }),
      words: "Changes the project's setup",
    },
  ])(
    "says what a waiting setup change does by the recipes it changes: $case",
    ({ reach, words }) => {
      expect(setupChangeWords(reach)).toBe(words);
    },
  );
});

describe("a card's unread places", () => {
  it.each([
    {
      case: "an unreadable production",
      flow: { production: { kind: "unread", line: "Could not be read by this version" } },
      lines: [{ name: "prod", words: "Could not be read by this version" }],
    },
    {
      case: "an unreadable stage beside no production",
      flow: { production: { kind: "absent" }, unreadStages: ["stage"] },
      lines: [
        { name: "stage", words: "Could not be read by this version" },
        { name: "prod", words: "Not added" },
      ],
    },
  ] as const)(
    "An environment this build cannot read shows as unread, never as an application without it: $case",
    ({ flow, lines }) => {
      expect(
        placeLines({ flow: { stages: [], ...flow }, nowMs: 0 }).map((line) => ({
          name: line.name,
          words: line.words.join(" · "),
        })),
      ).toEqual(lines);
    },
  );
});

// The live audit (2026-10-28): Larkspur's production and stage existed with their services and
// ran nothing, and their panels stood like live ones — green service dots, *Manage addresses*.
describe("a place with nothing deployed", () => {
  const empty = stop({ state: "empty", version: undefined, addresses: [] });
  it.each([
    {
      case: "an empty production, as its chip says it",
      input: {
        flow: { production: LIVE, stages: [] },
        chip: { label: "prod", state: "empty" },
      },
      name: "prod",
      nothing: true,
    },
    {
      case: "an empty production, as the flow says it",
      input: { flow: { production: { kind: "empty", stop: empty, line: "" }, stages: [] } },
      name: "prod",
      nothing: true,
    },
    {
      case: "an empty stage, as the flow says it",
      input: {
        flow: { production: LIVE, stages: [{ ...empty, projectId: "stage", name: "stage" }] },
      },
      name: "stage",
      nothing: true,
    },
    {
      case: "an empty stage, as its chip says it",
      input: {
        flow: { production: LIVE, stages: [{ ...empty, projectId: "stage", name: "stage" }] },
        stageChips: new Map([["stage", { label: "stage", state: "empty" } as const]]),
      },
      name: "stage",
      nothing: true,
    },
    {
      case: "a production that does not exist",
      input: { flow: { production: { kind: "absent" }, stages: [] } },
      name: "prod",
      nothing: true,
    },
    {
      case: "a running production",
      input: { flow: { production: LIVE, stages: [] } },
      name: "prod",
      nothing: false,
    },
    {
      case: "a production whose first release is on its way",
      input: {
        flow: { production: LIVE, stages: [] },
        chip: { label: "prod", state: "releasing", next: "v0.1.0" },
      },
      name: "prod",
      nothing: false,
    },
  ] as const)(
    "A place says it runs nothing only where nothing was deployed there: $case",
    ({ input, name, nothing }) => {
      const line = placeLines({ ...input, nowMs: NOW }).find((each) => each.name === name);
      expect(line?.nothingDeployed === true).toBe(nothing);
    },
  );
});

it.each([
  {
    publication: "pending",
    addressPending: true,
    addresses: [],
    dot: "unknown",
    words: ["Turning its address on…"],
  },
  {
    publication: "none",
    addressPending: false,
    addresses: [],
    dot: "running",
    words: ["No public address yet"],
  },
  {
    publication: "present",
    addressPending: false,
    addresses: [{ service: "app", url: "https://stage.example.com/" }],
    dot: "running",
    words: ["Running", "v2.3.1"],
  },
] as const)(
  "a finished stage's card reflects its address publication: $publication",
  ({ addressPending, addresses, dot, words }) => {
    const [line] = placeLines({
      flow: {
        production: { kind: "absent" },
        stages: [stop({ name: "stage", projectId: "stage", birth: { ended: true }, addresses })],
      },
      addressPending: new Map([["stage", addressPending]]),
      nowMs: NOW,
    });
    expect(line?.words).toEqual(words);
    expect(line?.dot).toBe(dot);
  },
);
