import type {
  DeployedVersion,
  FlowReleaseRow,
  GroupEnvironmentRowInput,
  GroupFlowProduction,
  GroupFlowStop,
} from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  buildingOf,
  chipFace,
  chipMenu,
  deployedAgo,
  draftParts,
  drawnChip,
  fixProblemOf,
  productionChip,
  rememberedChipAfter,
  releaseFailureOf,
  stopServing,
  type ChipView,
  type GiteaAnswer,
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

const SERVING: StopServing = { kind: "serving" };
const ANSWERED: GiteaAnswer = { kind: "answered", failure: undefined };
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
  stages: [],
  stageBeingCreated: false,
  building: undefined,
  waiting: 0,
  serving: { production: SERVING, stage: SERVING },
  gitea: ANSWERED,
  ...over,
});

const chip = (view: ChipView): ProductionChip | undefined =>
  view.kind === "chip" ? view.chip : undefined;

describe("productionChip — the one chip on a project's heading (M2)", () => {
  // The plan's table: what each state says, at a glance, on the heading.
  it.each([
    {
      state: "ok",
      given: input({ production: live("v0.1.0") }),
      face: { tone: "neutral", dot: "ok", label: "prod", version: "v0.1.0", extra: undefined },
    },
    {
      state: "waiting — still green: nothing is wrong, the count is what a release would carry",
      given: input({ waiting: 1 }),
      face: { tone: "neutral", dot: "ok", label: "prod", version: "v0.1.44", extra: "· 1 waiting" },
    },
    {
      state: "releasing",
      given: input({
        production: { kind: "releasing", stop: stop(), line: "v0.1.44", tag: "v0.1.45" },
      }),
      face: {
        tone: "neutral",
        dot: "spinner",
        label: "prod",
        version: "v0.1.44 → v0.1.45",
        extra: undefined,
      },
    },
    {
      state: "release failed — the old one still serves",
      given: input({
        production: live("v0.1.56"),
        gitea: { kind: "answered", failure: FAILED_RELEASE },
      }),
      face: {
        tone: "amber",
        dot: "attention",
        label: "prod",
        version: "v0.1.56",
        extra: "· release failed",
      },
    },
    {
      state: "down — production isn't serving",
      given: input({
        production: live("v2.3.0"),
        serving: { production: { kind: "down", services: ["app"] }, stage: SERVING },
      }),
      face: {
        tone: "red",
        dot: "failed",
        label: "prod down",
        version: undefined,
        extra: undefined,
      },
    },
    {
      state: "stopped on purpose",
      given: input({ serving: { production: { kind: "stopped" }, stage: SERVING } }),
      face: {
        tone: "neutral",
        dot: "hollow",
        label: "prod stopped",
        version: undefined,
        extra: undefined,
      },
    },
    {
      state: "no production, only stage",
      given: input({
        production: { kind: "absent", line: "Not set up", addable: false },
        stages: [stage()],
      }),
      face: { tone: "neutral", dot: "ok", label: "stage", version: "main", extra: undefined },
    },
  ])("$state", ({ given, face }) => {
    const drawn = chip(productionChip(given));
    expect(drawn).toBeDefined();
    const { words: _words, ...shown } = chipFace(drawn!);
    expect(shown).toEqual(face);
  });

  it("draws no chip where there is neither a production nor a stage", () => {
    expect(
      productionChip(input({ production: { kind: "absent", line: "Not set up", addable: true } })),
    ).toEqual({ kind: "none" });
  });

  // A reload must not paint a chip it then takes back: until what decides it
  // is read, the chip is unknown — the menu draws what it remembers, or nothing.
  it.each([
    { name: "what production runs is still being read", given: { production: checking() } },
    {
      name: "the platform has not said how its services stand",
      given: { serving: { production: { kind: "unknown" }, stage: SERVING } as const },
    },
    { name: "Gitea has not answered yet", given: { gitea: { kind: "waiting" } as const } },
    {
      name: "a stage whose last deploy is unread",
      given: {
        production: { kind: "absent", line: "Not set up", addable: false } as const,
        stages: [stage({ state: "checking", version: undefined })],
      },
    },
  ])("is unknown while $name", ({ given }) => {
    expect(productionChip(input(given))).toEqual({ kind: "unknown" });
  });

  it("settles on the platform's facts alone where Gitea is not coming", () => {
    expect(chip(productionChip(input({ gitea: { kind: "absent" } })))).toEqual({
      label: "prod",
      state: "ok",
      version: "v0.1.44",
    });
  });

  it("says down at once, whatever else is still to be read", () => {
    expect(
      chip(
        productionChip(
          input({
            gitea: { kind: "waiting" },
            serving: { production: { kind: "down", services: ["app"] }, stage: SERVING },
          }),
        ),
      )?.state,
    ).toBe("down");
  });

  it.each([
    {
      name: "a production being set up",
      given: input({
        production: {
          kind: "creating",
          line: "Setting up production…",
          creation: {
            projectId: "prod",
            kind: "production",
            name: "production",
            step: "tags",
            overdue: false,
          },
        },
      }),
      face: { dot: "spinner", label: "prod", version: undefined, extra: "· setting up" },
    },
    {
      name: "a stage being set up, and no production",
      given: input({
        production: { kind: "absent", line: "Not set up", addable: false },
        stageBeingCreated: true,
      }),
      face: { dot: "spinner", label: "stage", version: undefined, extra: "· setting up" },
    },
    {
      name: "a production nothing was released to yet",
      given: input({
        production: {
          kind: "empty",
          stop: stop({ state: "empty", version: undefined }),
          line: "Nothing deployed yet",
        },
      }),
      face: { dot: "off", label: "prod", version: undefined, extra: "· not released" },
    },
    {
      name: "an empty production with changes waiting for its first release",
      given: input({
        production: {
          kind: "ready-to-release",
          stop: stop({ state: "empty", version: undefined }),
          line: "Nothing deployed yet",
          candidate: { tag: "v0.1.0", waiting: 3 },
        },
        waiting: 3,
      }),
      face: { dot: "off", label: "prod", version: undefined, extra: "· 3 waiting" },
    },
    {
      name: "a deploy running on production with no release in flight",
      given: input({
        production: {
          kind: "deploying",
          stop: stop({ state: "deploying", version: version("v0.1.45") }),
          line: "Deploying…",
        },
        building: { from: "v0.1.44", to: "v0.1.45" },
      }),
      face: { dot: "spinner", label: "prod", version: "v0.1.44 → v0.1.45", extra: undefined },
    },
    {
      name: "a deploy whose target nothing names yet",
      given: input({
        production: {
          kind: "deploying",
          stop: stop({ state: "deploying", version: undefined }),
          line: "Deploying…",
        },
        building: { from: "v0.1.44", to: undefined },
      }),
      face: { dot: "spinner", label: "prod", version: "v0.1.44", extra: "· deploying" },
    },
    {
      name: "a production whose own running commit's deploy failed",
      given: input({
        production: {
          kind: "deploy-failed",
          stop: stop({ state: "failed" }),
          line: "v0.1.44",
          candidate: undefined,
        },
      }),
      face: { dot: "attention", label: "prod", version: "v0.1.44", extra: "· release failed" },
    },
    {
      name: "a stage-only project whose last deploy failed",
      given: input({
        production: { kind: "absent", line: "Not set up", addable: false },
        stages: [stage({ state: "failed" })],
      }),
      face: { dot: "attention", label: "stage", version: "main", extra: "· deploy failed" },
    },
    {
      name: "a stage-only project that is down",
      given: input({
        production: { kind: "absent", line: "Not set up", addable: false },
        stages: [stage()],
        serving: { production: SERVING, stage: { kind: "down", services: ["web"] } },
      }),
      face: { dot: "failed", label: "stage down", version: undefined, extra: undefined },
    },
    {
      name: "a stage running a deploy somebody named, by its name",
      given: input({
        production: { kind: "absent", line: "Not set up", addable: false },
        stages: [
          stage({
            version: {
              name: "hotfix-cache",
              commit: undefined,
              sha: undefined,
              taggedBy: undefined,
              label: "hotfix-cache",
            },
          }),
        ],
      }),
      face: { dot: "ok", label: "stage", version: "hotfix-cache", extra: undefined },
    },
  ])("draws $name", ({ given, face }) => {
    const drawn = chip(productionChip(given));
    expect(drawn).toBeDefined();
    const { tone: _tone, words: _words, ...shown } = chipFace(drawn!);
    expect(shown).toEqual(face);
  });

  it("names every state in words for the chip's accessible name", () => {
    expect(
      chipFace({ label: "prod", state: "waiting", version: "v0.1.44", waiting: 2 }).words,
    ).toBe("Production v0.1.44, 2 changes waiting");
    expect(chipFace({ label: "prod", state: "down", version: "v2.3.0" }).words).toBe(
      "Production is down",
    );
    expect(chipFace({ label: "stage", state: "ok", version: "main" }).words).toBe(
      "Stage main, healthy",
    );
  });
});

function checking(): GroupFlowProduction {
  return {
    kind: "checking",
    stop: stop({ state: "checking", version: undefined }),
    line: "Checking what runs here…",
  };
}

describe("drawnChip and rememberedChipAfter — a reload paints what it last drew", () => {
  const REMEMBERED: ProductionChip = { label: "prod", state: "ok", version: "v0.1.43" };
  const NOW: ProductionChip = { label: "prod", state: "waiting", version: "v0.1.44", waiting: 1 };
  it.each([
    { view: { kind: "chip", chip: NOW } as const, drawn: NOW, remember: NOW },
    { view: { kind: "unknown" } as const, drawn: REMEMBERED, remember: undefined },
    { view: { kind: "none" } as const, drawn: undefined, remember: null },
  ])("$view.kind: draws and remembers", ({ view, drawn, remember }) => {
    expect(drawnChip(view, REMEMBERED)).toEqual(drawn);
    expect(rememberedChipAfter(view)).toEqual(remember);
  });

  it("draws nothing while unknown and nothing is remembered", () => {
    expect(drawnChip({ kind: "unknown" }, undefined)).toBeUndefined();
  });
});

describe("stopServing — how a stop's services stand on the platform", () => {
  it.each([
    {
      name: "every service up",
      projectStatus: "ACTIVE",
      services: [
        { hostname: "app", status: "ACTIVE" },
        { hostname: "db", status: "RUNNING" },
      ],
      serving: { kind: "serving" },
    },
    {
      name: "a service the platform marks failed",
      projectStatus: "ACTIVE",
      services: [
        { hostname: "app", status: "CONTAINER_FAILED" },
        { hostname: "db", status: "ACTIVE" },
      ],
      serving: { kind: "down", services: ["app"] },
    },
    {
      name: "a service somebody stopped",
      projectStatus: "ACTIVE",
      services: [
        { hostname: "app", status: "SERVICE_STOPPED" },
        { hostname: "db", status: "ACTIVE" },
      ],
      serving: { kind: "stopped" },
    },
    {
      name: "the whole project stopped",
      projectStatus: "STOPPED",
      services: undefined,
      serving: { kind: "stopped" },
    },
    {
      name: "services not read yet",
      projectStatus: "ACTIVE",
      services: undefined,
      serving: { kind: "unknown" },
    },
    {
      name: "no service to say anything",
      projectStatus: "ACTIVE",
      services: [],
      serving: { kind: "unknown" },
    },
    {
      name: "a project in another state",
      projectStatus: "DELETING",
      services: [{ hostname: "app", status: "ACTIVE" }],
      serving: { kind: "unknown" },
    },
  ])("$name", ({ projectStatus, services, serving }) => {
    expect(stopServing({ projectStatus, services })).toEqual(serving);
  });
});

describe("releaseFailureOf — the release that did not go through, newer than what serves", () => {
  const release = (over: Partial<FlowReleaseRow>): FlowReleaseRow => ({
    tag: "v0.1.56",
    verdict: "approved",
    detail: undefined,
    line: "app 3f9c1b2",
    entries: [],
    taggedAt: undefined,
    standing: undefined,
    word: "Approved",
    rollBack: false,
    failedEntry: undefined,
    ...over,
  });
  const failedSha = "a".repeat(40);
  const environments: ReadonlyArray<GroupEnvironmentRowInput> = [
    {
      projectId: "stage",
      name: "stage",
      tier: "stage",
      sources: ["main"],
      environment: "shop-stage",
      services: [
        {
          hostname: "app",
          appVersionName: failedSha,
          statuses: [
            {
              context: "mate/deploy/shop-production/app",
              state: "failure",
              description: "The build step exited with code 2 while installing packages.",
              created_at: "2026-09-29T10:41:00Z",
            },
            { context: "mate/deploy/shop-stage/app", state: "success" },
          ],
        },
      ],
    },
    {
      projectId: "prod",
      name: "production",
      tier: "production",
      sources: "release",
      environment: "shop-production",
      services: [{ hostname: "app", appVersionName: `${"b".repeat(40)} v0.1.56 ada` }],
    },
  ];

  it("names the newest release whose production deploy failed, with the broker's words and time", () => {
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

  it("names a release the broker refused, with its reason", () => {
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

  it("keeps the failure when nothing it could read carries the broker's words", () => {
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

describe("chipMenu — what the chip's menu says, per state", () => {
  const NOW = Date.parse("2026-09-29T10:53:00Z");
  const menu = (over: Partial<Parameters<typeof chipMenu>[0]>) =>
    chipMenu({
      chip: { label: "prod", state: "ok", version: "v0.1.0" },
      failure: undefined,
      down: [],
      stages: [],
      waiting: 0,
      nowMs: NOW,
      ...over,
    });

  it.each([
    {
      name: "healthy",
      chip: { label: "prod", state: "ok", version: "v0.1.0" },
      main: { name: "production", version: "v0.1.0", dot: "ok", word: "Healthy", tone: "muted" },
      trouble: false,
    },
    {
      name: "release failed",
      chip: { label: "prod", state: "failed", version: "v0.1.56" },
      main: {
        name: "production",
        version: "v0.1.56",
        dot: "attention",
        word: "Release failed",
        tone: "amber",
      },
      trouble: true,
    },
    {
      name: "down",
      chip: { label: "prod", state: "down", version: "v2.3.0" },
      main: { name: "production", version: "v2.3.0", dot: "failed", word: "Down", tone: "red" },
      trouble: true,
    },
    {
      name: "releasing",
      chip: { label: "prod", state: "releasing", version: "v0.1.44", next: "v0.1.45" },
      main: {
        name: "production",
        version: "v0.1.44",
        dot: "spinner",
        word: "Releasing v0.1.45",
        tone: "muted",
      },
      trouble: false,
    },
    {
      name: "stopped on purpose — no fix to offer",
      chip: { label: "prod", state: "stopped", version: "v0.1.44" },
      main: {
        name: "production",
        version: "v0.1.44",
        dot: "hollow",
        word: "Stopped",
        tone: "muted",
      },
      trouble: false,
    },
    {
      name: "a stage alone",
      chip: { label: "stage", state: "ok", version: "main" },
      main: { name: "stage", version: "main", dot: "ok", word: "Healthy", tone: "muted" },
      trouble: false,
    },
  ] as const)("$name", ({ chip: shown, main, trouble }) => {
    const model = menu({ chip: shown });
    expect(model.main).toEqual(main);
    expect(model.trouble).toBe(trouble);
  });

  it("says what failed, when, the broker's words, and what still serves", () => {
    expect(
      menu({
        chip: { label: "prod", state: "failed", version: "v0.1.56" },
        failure: {
          tag: "v0.1.57",
          kind: "deploy-failed",
          at: "2026-09-29T10:41:00Z",
          error: "The build step exited with code 2 while installing packages.",
          service: "app",
        },
      }).note,
    ).toBe(
      "Release v0.1.57 failed 12 min ago: The build step exited with code 2 while installing packages. v0.1.56 is still serving.",
    );
  });

  it("says a refused release was refused, and why", () => {
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
      }).note,
    ).toBe(
      "Release v0.1.57 was refused: the tag's commit failed its checks. v0.1.56 is still serving.",
    );
  });

  it("says which services the platform marks failed while production is down", () => {
    expect(
      menu({ chip: { label: "prod", state: "down", version: "v2.3.0" }, down: ["app", "api"] })
        .note,
    ).toBe("Down: app and api failed on the platform. v2.3.0 was the last release.");
  });

  it("says nothing more where nothing is wrong", () => {
    expect(menu({}).note).toBeUndefined();
  });

  it("lists the stages under production, each with what it runs and when it was deployed", () => {
    expect(
      menu({
        stages: [
          { name: "stage", stop: stage(), deployedAt: "2026-09-29T10:13:00Z" },
          { name: "qa", stop: stage({ state: "deploying" }), deployedAt: undefined },
        ],
      }).stages,
    ).toEqual([
      { name: "stage", version: "3f9c1b2", dot: "ok", word: "Deployed 40 min ago" },
      { name: "qa", version: "3f9c1b2", dot: "spinner", word: "Deploying…" },
    ]);
  });

  it("counts what waits for production — only on production's menu", () => {
    expect(menu({ waiting: 2 }).waiting).toBe(2);
    expect(
      menu({ chip: { label: "stage", state: "ok", version: "main" }, waiting: 2 }).waiting,
    ).toBe(0);
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
