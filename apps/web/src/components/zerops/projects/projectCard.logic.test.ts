import {
  canonicalEnvironmentRow,
  canonicalEnvironmentRowInputsOf,
  groupFlow,
  placeAddresses,
  type GroupFlowProduction,
  type GroupFlowStop,
} from "@t3tools/client-runtime/zerops";
import type { AddressDomain, DomainFace, PlaceAddresses } from "@t3tools/client-runtime/data";
import { HqEnvironmentId } from "@t3tools/contracts";
import type { HqGitNavigationEnvironment } from "@t3tools/shared/hqStream";
import { describe, expect, it } from "vite-plus/test";

import type { ProductionChip } from "../SidebarProductionChip.logic";
import type { MateRowView } from "../SidebarMateRow.logic";
import { entry, pull, WREN } from "./flowTestFixtures";
import { groupFlowInputOf } from "./projectsView.logic";
import {
  broughtBy,
  cardChangeRows,
  cardChanges,
  cardMateReading,
  cardSecondWords,
  cardPeople,
  cardReady,
  foldMates,
  foldWords,
  mateChangeForReview,
  mateChangesForReview,
  panelAddresses,
  historyHeld,
  historyOffered,
  productionBuilding,
  releaseProductionRuns,
  placeLines,
  putLiveHasChange,
  readyLine,
  readyTitle,
  rollBackTarget,
  siteOf,
  sinceWords,
  soleSite,
  releaseLineOpens,
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
      can: {},
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
        can: {},
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
        { dot: "none", words: "Not released yet", name: "prod" },
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
        { dot: "none", words: "Not released yet", name: "prod" },
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

  // The onboarding run: "Running · main" stood two seconds with nowhere to go before the stage's
  // address came. HQ brings a stage up until its address is on (`EnvironmentBirth`) — and marks it
  // up as its first deploy ends, the address coming ~0.8 s later in the platform's next read: a
  // stage that serves a port its address opens still turns it on. One serving none runs as is.
  it.each([
    {
      case: "while HQ still brings it up",
      birth: { ended: false },
      offered: undefined,
      words: "Turning its address on…",
    },
    {
      case: "once HQ has brought it up",
      birth: { ended: true },
      offered: undefined,
      words: "Running",
    },
    {
      case: "once HQ has brought it up, while the address its app serves is still being turned on",
      birth: { ended: true },
      offered: true,
      words: "Turning its address on…",
    },
    {
      case: "once HQ has brought it up, serving nothing an address would open",
      birth: { ended: true },
      offered: false,
      words: "Running",
    },
    {
      case: "while HQ still brings it up, serving nothing an address would open",
      birth: { ended: false },
      offered: false,
      words: "Running",
    },
    { case: "where HQ did not bring it up", birth: undefined, offered: true, words: "Running" },
  ])("says a stage runs only with its address, $case", ({ birth, offered, words: said }) => {
    const lines = placeLines({
      ...(offered === undefined ? {} : { addressOffered: new Map([["stage", offered]]) }),
      flow: {
        production: { kind: "absent" },
        stages: [
          stop({
            projectId: "stage",
            name: "stage",
            source: "main",
            addresses: [],
            ...(birth === undefined ? {} : { birth }),
          }),
        ],
      },
      stageChips: new Map([["stage", chip({ label: "stage", version: "main" })]]),
      nowMs: NOW,
    });
    expect(lines[0]?.words.join(" · ")).toBe(said);
  });
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

  // D28: releasing the fix is how a broken production is mended, so the release stays offered.
  it("is offered beside a production whose last release failed, and says so plainly", () => {
    const ready = cardReady({
      production: {
        kind: "deploy-failed",
        stop: stop({ version: { ...stop().version!, label: "v1.8.2" } }),
        line: "",
        candidate: { tag: "v1.9.1", waiting: 2 },
      },
      stages: [stage],
      main: { head: undefined, hasCode: true, notLive: 2, notLiveAtLeast: false },
    });
    expect(ready === undefined ? undefined : [readyTitle(ready), readyLine(ready, true)]).toEqual([
      "2 changes ready to release",
      "On stage. Production's last release failed; it still runs v1.8.2.",
    ]);
  });
  it("says how many changes, where they were tested and what production runs", () => {
    const ready = cardReady({
      production: {
        kind: "ready-to-release",
        stop: stop(),
        line: "",
        candidate: { tag: "v2.4.0", waiting: 3 },
      },
      stages: [stage],
      main: { head: undefined, hasCode: true, notLive: 3, notLiveAtLeast: false },
    });
    expect(ready === undefined ? undefined : [readyTitle(ready), readyLine(ready, true)]).toEqual([
      "3 changes ready to release",
      "On stage. Production runs v2.3.1.",
    ]);
  });

  // The onboarding run: "On stage, tested" while nobody had tried the stage, and before it ran them.
  it.each([
    { case: "the stage runs them all", onStage: true, line: "On stage. Production runs v2.3.1." },
    {
      case: "the stage does not run them all yet",
      onStage: false,
      line: "Not on stage yet. Production runs v2.3.1.",
    },
    {
      case: "what the stage runs is unread",
      onStage: undefined,
      line: "Merged. Production runs v2.3.1.",
    },
  ])("says only what the stage runs, never that anyone tested it: $case", ({ onStage, line }) => {
    const ready = cardReady({
      production: {
        kind: "ready-to-release",
        stop: stop(),
        line: "",
        candidate: { tag: "v2.4.0", waiting: 3 },
      },
      stages: [stage],
      main: { head: undefined, hasCode: true, notLive: 3, notLiveAtLeast: false },
    });
    expect(ready === undefined ? undefined : readyLine(ready, onStage)).toBe(line);
  });

  // The onboarding run: "Merged. Nothing is released yet." under "2 changes ready to release",
  // beside production's "Not released yet" — the title says they are merged, production the rest.
  it("says nothing more where no stage runs them and production runs no release yet", () => {
    const ready = cardReady({
      production: {
        kind: "ready-to-release",
        stop: stop({ state: "empty", version: undefined }),
        line: "",
        candidate: { tag: "v0.1.0", waiting: 1 },
      },
      stages: [],
      main: { head: undefined, hasCode: true, notLive: 1, notLiveAtLeast: false },
    });
    expect(ready === undefined ? null : readyLine(ready, undefined)).toBeUndefined();
  });

  it("names the stage main feeds, the one whose deploys say whether it runs them, never another", () => {
    const ready = cardReady({
      production: {
        kind: "ready-to-release",
        stop: stop(),
        line: "",
        candidate: { tag: "v2.4.0", waiting: 3 },
      },
      stages: [
        stop({ projectId: "qa", name: "qa", source: "release" }),
        stop({ projectId: "stage", name: "stage", source: "main", state: "deploying" }),
      ],
      main: { head: undefined, hasCode: true, notLive: 3, notLiveAtLeast: false },
    });
    expect(ready === undefined ? undefined : readyLine(ready, false)).toBe(
      "Not on stage yet. Production runs v2.3.1.",
    );
  });

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

// With the "Putting v2.4.0 live" block gone, nothing on the card opened a release on its way:
// production's line that says it now opens it, as the block's door did.
describe("production's line while a release is on its way", () => {
  const main = { head: undefined, hasCode: true, notLive: 1, notLiveAtLeast: false };
  const releasing = { kind: "releasing", stop: stop(), line: "", tag: "v2.4.1" } as const;
  it.each([
    { case: "opens the release's review", production: releasing, opens: { kind: "release" } },
    {
      case: "opens a roll back's review by the release it goes back to",
      production: releasing,
      rollsBackTo: "v2.3.0",
      opens: { kind: "rollback", tag: "v2.3.0" },
    },
    { case: "opens nothing while none is on its way", production: LIVE, opens: undefined },
    {
      case: "opens nothing while production is down: its trouble is said, and its fix",
      production: releasing,
      chip: chip({ state: "down", next: "v2.4.1" }),
      opens: undefined,
    },
  ] as const)("$case", ({ production, opens, ...rest }) => {
    const rollsBackTo = "rollsBackTo" in rest ? rest.rollsBackTo : undefined;
    const flow = { production, stages: [], main };
    const [line] = placeLines({
      flow,
      rollsBackTo,
      ...("chip" in rest ? { chip: rest.chip } : {}),
      nowMs: 0,
    });
    if (line === undefined) throw new Error("production has a line");
    expect(releaseLineOpens(line, production, rollsBackTo)).toEqual(opens);
  });
});

// The onboarding run: production offered "Put it live" while the Mate was still creating its
// services and nothing was there to put live.
describe("Put it live on a card", () => {
  const main = (hasCode: boolean | undefined) => ({
    head: undefined,
    hasCode,
    notLive: 0,
    notLiveAtLeast: false,
  });
  const open = (kind: "code" | "recipe") => ({
    pull: pull({ kind, number: 3, title: "Add the tea list" }),
    blocked: null,
    state: undefined,
    review: true,
  });
  it.each([
    { case: "nothing merged and no change open", hasCode: undefined, open: [], offered: false },
    {
      case: "only the Mate's setup files open",
      hasCode: undefined,
      open: [open("recipe")],
      offered: false,
    },
    { case: "a change of the app open", hasCode: undefined, open: [open("code")], offered: true },
    { case: "the app's code merged", hasCode: true, open: [], offered: true },
  ])(
    "is offered only once there is a change to put live: $case",
    ({ hasCode, open: pulls, offered }) => {
      expect(putLiveHasChange({ main: main(hasCode), pullRequests: pulls })).toBe(offered);
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
    expect(foldWords(folded.length)).toBe("2 more Mates");
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

  it("draws the people on it only when more than one, each once", () => {
    const ada = { userId: "ada" };
    const kai = { userId: "kai" };
    expect(cardPeople([ada, null, ada])).toEqual([]);
    expect(cardPeople([ada, kai, ada, undefined])).toEqual([ada, kai]);
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
  // CI's held card: the platform's build said Deploying with no History room at 248 px, then HQ's
  // accepted release said Releasing with it at 292 px; one release on its way keeps one height.
  it.each([
    {
      case: "the platform's build, before HQ names it",
      kind: "deploying",
      dot: "releasing",
      runsNamed: false,
      held: true,
    },
    {
      case: "HQ's accepted release",
      kind: "releasing",
      dot: "releasing",
      runsNamed: false,
      held: true,
    },
    { case: "a version it runs", kind: "live", dot: "running", runsNamed: true, held: true },
    {
      case: "running nothing it can name",
      kind: "live",
      dot: "running",
      runsNamed: false,
      held: false,
    },
    { case: "nothing released yet", kind: "empty", dot: "none", runsNamed: false, held: false },
  ] as const)("holds History's room whatever names the release first: $case", (input) => {
    expect(historyHeld(input)).toBe(input.held);
  });

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

  it("says what the version production runs brought: what was merged since the release before", () => {
    const merged = [
      pull({ number: 1, mergedAt: "2026-09-30T10:00:00Z" }),
      pull({ number: 2, mergedAt: "2026-10-03T10:00:00Z" }),
      pull({ number: 3, mergedAt: "2026-10-08T10:00:00Z" }),
    ];
    expect(broughtBy(merged, releases).map((entry) => entry.number)).toEqual([2]);
    expect(broughtBy(merged, [])).toEqual([]);
  });

  it("leaves the group's own setup out of what a release brought: only the app's changes", () => {
    const merged = [
      pull({ number: 1, mergedAt: "2026-10-03T10:00:00Z" }),
      pull({ number: 1, mergedAt: "2026-10-04T10:00:00Z", kind: "recipe", repository: "recipe" }),
    ];
    expect(broughtBy(merged, releases).map((entry) => entry.kind)).toEqual(["code"]);
  });

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
      rows: [["Change 6", false, "Not released yet"]],
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
        ["Change 5", false, "In v1.0.4"],
        ["Change 4", false, "In v1.0.3"],
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
        ["Change 5", false, "In v1.0.4"],
        ["Change 4", false, "In v1.0.3"],
      ],
    },
    // The onboarding run: both changes read "On stage" for two minutes while the stage was not
    // deployed yet.
    {
      case: "merged while the stage runs nothing yet: not on stage",
      open: [],
      merged: [merged(6, "2026-10-09T09:00:00Z")],
      stage: stageOn(undefined),
      rows: [["Change 6", false, "Not released yet"]],
    },
    {
      case: "merged while the stage still runs an older change: not on stage",
      open: [],
      merged: [merged(7, "2026-10-09T10:00:00Z"), merged(6, "2026-10-09T09:00:00Z")],
      stage: stageOn(6),
      rows: [
        ["Change 7", false, "Not released yet"],
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

describe("cardChangeRows", () => {
  // The owner (2026-10-12): the changes "should show where tags were marked, where the prod is".
  const merged = (number: number, mergedAt: string) =>
    ({
      pull: pull({ number, merged: true, mergedAt }),
      open: false,
      words: "Merged",
      tone: "off",
      at: mergedAt,
    }) as const;
  const open = {
    pull: pull({ number: 9 }),
    open: true,
    words: "Ready to merge",
    tone: "off",
    at: undefined,
  } as const;
  const shown = (rows: ReturnType<typeof cardChangeRows>) =>
    rows.map((row) =>
      row.kind === "change"
        ? `#${String(row.change.pull.number)}`
        : `${row.tag}${row.live ? " (production)" : ""}`,
    );
  it.each([
    {
      case: "each release over the merged changes it took, open ones first",
      changes: [open, merged(4, "2026-10-04"), merged(3, "2026-10-03"), merged(2, "2026-10-02")],
      releases: [
        { tag: "v3", taggedAt: "2026-10-03T12", live: true },
        { tag: "v2", taggedAt: "2026-10-02T12", live: false },
      ],
      rows: ["#9", "#4", "v3 (production)", "#3", "v2", "#2"],
    },
    {
      case: "production's release older than every change shown closes the list",
      changes: [merged(4, "2026-10-04"), merged(3, "2026-10-03")],
      releases: [
        { tag: "v2", taggedAt: "2026-10-02", live: true },
        { tag: "v1", taggedAt: "2026-10-01", live: false },
      ],
      rows: ["#4", "#3", "v2 (production)"],
    },
    {
      case: "a release with no change shown after it stands over the newest",
      changes: [merged(4, "2026-10-04")],
      releases: [{ tag: "v5", taggedAt: "2026-10-05", live: true }],
      rows: ["v5 (production)", "#4"],
    },
    {
      case: "a release that took no change shown is left out, production's stays",
      changes: [merged(4, "2026-10-04"), merged(2, "2026-10-02")],
      releases: [
        { tag: "v4", taggedAt: "2026-10-03T18", live: false },
        { tag: "v3", taggedAt: "2026-10-03T12", live: true },
        { tag: "v2b", taggedAt: "2026-10-03T06", live: false },
        { tag: "v2", taggedAt: "2026-10-02T12", live: false },
      ],
      rows: ["#4", "v3 (production)", "v2", "#2"],
    },
    {
      case: "no release, the changes alone",
      changes: [open, merged(4, "2026-10-04")],
      releases: [],
      rows: ["#9", "#4"],
    },
    {
      case: "no change shown, production's release alone",
      changes: [],
      releases: [{ tag: "v1", taggedAt: "2026-10-01", live: true }],
      rows: ["v1 (production)"],
    },
  ])("places releases among a card's changes: $case", ({ changes, releases, rows }) => {
    expect(shown(cardChangeRows(changes, releases))).toEqual(rows);
  });
});

describe("a place's addresses on its panel", () => {
  const domain = (
    domainName: string,
    service: string,
    face: DomainFace = "live",
  ): AddressDomain => ({
    routingId: `r-${domainName}`,
    domainName,
    routingDomains: [domainName],
    targets: [{ serviceId: service, serviceName: service, port: 3000, path: "/" }],
    sslEnabled: true,
    face,
    url: `https://${domainName}`,
    resolvedIps: [],
    nameServers: [],
  });
  const subdomain = (service: string, on = true) => ({
    serviceId: service,
    serviceName: service,
    on,
    hosts: on
      ? [
          {
            port: 3000,
            url: `https://${service}-1a2b-3000.prg1.zerops.app`,
            host: `${service}-1a2b-3000.prg1.zerops.app`,
          },
        ]
      : [],
    port: 3000,
  });
  const place = (
    domains: ReadonlyArray<AddressDomain>,
    zerops: PlaceAddresses["zerops"],
    state: PlaceAddresses["state"] = "ready",
  ): PlaceAddresses => ({
    state,
    domains,
    zerops,
    ips: { zoneHasSharedV4: false },
    portsState: "ready",
    ports: [],
    webTargets: [],
    portTargets: [],
    waitingDomains: [],
    waitingPorts: [],
    readsProject: false,
  });
  const listed = [{ service: "app", url: "https://app-1a2b-3000.prg1.zerops.app" }];

  it.each([
    {
      case: "its own domain, live, over its zerops.app address",
      place: place([domain("shop.acme.com", "app")], [subdomain("app")]),
      head: "shop.acme.com",
      doors: [],
    },
    {
      case: "no domain of its own: its zerops.app address",
      place: place([], [subdomain("app")]),
      head: "app-1a2b-3000.prg1.zerops.app",
      doors: [],
    },
    {
      case: "its own domain not live yet: its zerops.app address meanwhile",
      place: place([domain("shop.acme.com", "app", "dns")], [subdomain("app")]),
      head: "app-1a2b-3000.prg1.zerops.app",
      doors: [],
    },
    {
      case: "several services: a door each, at its own domain where it has one, and that domain heads it",
      place: place([domain("shop.acme.com", "shop")], [subdomain("shop"), subdomain("api")]),
      head: "shop.acme.com",
      doors: [
        { service: "api", url: "https://api-1a2b-3000.prg1.zerops.app" },
        { service: "shop", url: "https://shop.acme.com" },
      ],
    },
    {
      case: "several services and no domain of its own: a door each, no one address",
      place: place([], [subdomain("shop"), subdomain("api")]),
      head: undefined,
      doors: [
        { service: "api", url: "https://api-1a2b-3000.prg1.zerops.app" },
        { service: "shop", url: "https://shop-1a2b-3000.prg1.zerops.app" },
      ],
    },
    {
      case: "a service with its zerops.app address off and no domain: no door",
      place: place([], [subdomain("app"), subdomain("db", false)]),
      head: "app-1a2b-3000.prg1.zerops.app",
      doors: [],
    },
    {
      case: "still being read: as its listing says it",
      place: place([], [], "reading"),
      head: "app-1a2b-3000.prg1.zerops.app",
      doors: [],
    },
    {
      case: "outside an account: as its listing says it",
      place: undefined,
      head: "app-1a2b-3000.prg1.zerops.app",
      doors: [],
    },
  ])("a place is headed by the address it answers at: $case", ({ place, head, doors }) => {
    const said = panelAddresses({ kind: "production", listed, place, runs: true });
    expect(said.head?.host).toBe(head);
    expect(said.doors).toEqual(doors);
  });

  it.each([
    { face: "going-live", word: "Going live", tone: "muted" },
    { face: "changing", word: "Changing", tone: "muted" },
    { face: "removing", word: "Removing", tone: "muted" },
    { face: "dns", word: "Waiting for your DNS", tone: "attention" },
    { face: "elsewhere", word: "Points elsewhere", tone: "attention" },
    { face: "certificate", word: "Getting a certificate", tone: "muted" },
    { face: "certificate-failed", word: "Couldn't get a certificate", tone: "attention" },
  ] as const)(
    "a domain of its own not answering yet says how far it is, as the addresses sheet says it: $face",
    ({ face, word, tone }) => {
      const said = panelAddresses({
        kind: "stage",
        listed,
        runs: true,
        place: place(
          [domain("shop.acme.com", "app", face), domain("acme.com", "app")],
          [subdomain("app")],
        ),
      });
      expect(said.pending).toEqual([{ name: "shop.acme.com", word, tone }]);
    },
  );

  it("a place with only its default address and nothing pending says nothing more", () => {
    const said = panelAddresses({
      kind: "stage",
      listed,
      place: place([], [subdomain("app")]),
      runs: true,
    });
    expect(said.pending).toEqual([]);
    expect(said.offerDomain).toBe(false);
  });

  it.each([
    {
      case: "production read with no domain of its own",
      kind: "production",
      place: place([], [subdomain("app")]),
      offered: true,
    },
    {
      case: "production with a domain of its own",
      kind: "production",
      place: place([domain("shop.acme.com", "app")], []),
      offered: false,
    },
    {
      case: "production with a domain of its own not live yet",
      kind: "production",
      place: place([domain("shop.acme.com", "app", "dns")], []),
      offered: false,
    },
    {
      case: "production still being read",
      kind: "production",
      place: place([], [], "reading"),
      offered: false,
    },
    { case: "production outside an account", kind: "production", place: undefined, offered: false },
    {
      case: "a stage with no domain of its own",
      kind: "stage",
      place: place([], [subdomain("app")]),
      offered: false,
    },
  ] as const)(
    "offers a domain of its own as the globe's popover does: $case",
    ({ kind, place, offered }) => {
      expect(panelAddresses({ kind, listed, place, runs: true }).offerDomain).toBe(offered);
    },
  );

  // The run: production offered "Put it on your domain" while it said "Not released yet", and
  // its door read "Manage addresses" a beat before it became "Put it on your domain".
  it.each([
    { case: "it does", place: place([], [subdomain("app")]), runs: true, door: true },
    {
      case: "nothing runs there yet",
      place: place([], [subdomain("app")]),
      runs: false,
      door: false,
    },
    {
      case: "it has no address",
      place: place([], [subdomain("app", false)]),
      runs: true,
      door: false,
    },
    {
      case: "its addresses are still read",
      place: place([], [], "reading"),
      runs: true,
      door: false,
    },
    { case: "outside an account", place: undefined, runs: true, door: false },
  ])(
    "opens a door into the addresses sheet only once the place runs something at an address: $case",
    ({ place, runs, door }) => {
      const said = panelAddresses({ kind: "production", listed, place, runs });
      expect(said.door).toBe(door);
      if (!door) expect(said.offerDomain).toBe(false);
    },
  );

  it("a production reached only on its own domains shows them on its block", () => {
    const own = place(
      [domain("example.xyz", "app"), domain("www.example.xyz", "app")],
      [subdomain("app", false)],
    );
    const said = panelAddresses({ kind: "production", listed: [], place: own, runs: true });
    expect(said.head).toEqual({ host: "example.xyz", url: "https://example.xyz" });
  });
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
        { name: "prod", words: "Not released yet" },
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
