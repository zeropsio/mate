import {
  deployedVersion,
  environmentRow,
  environmentSlots,
  releaseContentsSummary,
  releaseRow,
  type EnvironmentRow,
  type EnvironmentServiceState,
  type FlowReleaseRow,
  type Moved,
  type MovedCommits,
  type ReleaseContentsSummary,
} from "@t3tools/client-runtime/zerops";
import {
  serviceRows,
  stopKeyGap,
  stopVerdict,
  stopView,
  type Deployment,
  type StopFailure,
  type StopService,
} from "@t3tools/client-runtime/zerops/flow";
import type { HqJob } from "@t3tools/client-runtime/zerops/hq";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { CompareCommit } from "@t3tools/shared/hqChanges";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { service as platformService } from "~/zerops/__fixtures__/platformData";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import type { ZeropsHistoryState } from "~/zerops/useRepositoryHistory";

import {
  detailTrail,
  groupMateOf,
  ZeropsGroupPane,
  ZeropsStopPane,
  ZeropsRuntimeStops,
  devstagesOf,
  runtimeStopsOf,
} from "./ZeropsGroupDetail";
import { ZeropsReleaseRows } from "./ZeropsReleaseRows";

/** The rows' one clock, fixed: an age is the producer's to test, not the minute this ran in. */
const NOW = vi.hoisted(() => Date.parse("2026-09-25T12:00:00Z"));
/** What the platform answered of each stop, as the page's stop lines read it. */
const platform = vi.hoisted(() => ({
  deployments: new Map() as ReadonlyMap<string, unknown>,
}));
vi.mock("~/zerops/projectFlows", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useStopDeploymentsShown: () => platform.deployments,
}));
vi.mock("~/zerops/useNowMs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNowMs: () => NOW,
}));

vi.mock("@tanstack/react-router", async (actual) => {
  const { createElement } = await import("react");
  return {
    ...(await actual<typeof import("@tanstack/react-router")>()),
    // Standing alone, the frame's bar carries the lockup as a link home.
    Link: ({ to, ...props }: React.ComponentProps<"a"> & { to: string }) =>
      createElement("a", { href: to, ...props }),
    useNavigate: () => () => undefined,
  };
});

// Render the popup in place so the stop page's project link is visible in SSR.
vi.mock("../ui/menu", async (actual) => ({
  ...(await actual<typeof import("../ui/menu")>()),
  MenuPopup: ({ children }: { children: ReactNode }) => children,
}));

const CHECKING = "Checking your access to this project…";

const environment = (
  projectId: string,
  name: string,
  tier: EnvironmentRow["tier"] = "stage",
): EnvironmentRow =>
  ({
    projectId,
    name,
    tier,
    source: "main",
    tone: "good",
    version: {
      name: undefined,
      label: "3f9c1b2",
      commit: "3f9c1b2e",
      sha: "3f9c1b2e".padEnd(40, "0"),
      taggedBy: undefined,
    },
    versionRepository: undefined,
  }) as EnvironmentRow;

const mate = (projectId: string, name: string, subject: string) => ({
  projectId,
  name,
  tint: "amber" as const,
  shape: "seal" as const,
  face: "working" as const,
  subject,
  snippet: undefined,
  when: "1h",
});

/** The Environments section as it stands for these environments and nothing else. */
const slotsOf = (environments: ReadonlyArray<EnvironmentRow>) =>
  environmentSlots({
    environments: environments.map((entry) => ({ id: entry.projectId, tier: entry.tier })),
    devstages: [],
    pending: [],
    halfMade: [],
    recipeTiers: [],
    recipeRead: false,
    mayAdd: false,
    writer: false,
    productionRuns: "unknown",
    waiting: { count: 0, atLeast: false },
    mainHasCode: undefined,
    releaseOffered: false,
    releasing: undefined,
  });

function render(
  who: Pick<
    React.ComponentProps<typeof ZeropsGroupPane>,
    "mates" | "matesNotice" | "onMatesNoticeAct"
  > & { readonly name?: string | undefined } = {
    mates: [
      mate("theo", "Theo", "Cache the link previews"),
      mate("iris", "Iris", "Split the checkout"),
    ],
  },
  stops: Pick<
    React.ComponentProps<typeof ZeropsGroupPane>,
    "environments" | "withheldNotice" | "firstDeployOf"
  > & { readonly slots?: React.ComponentProps<typeof ZeropsGroupPane>["slots"] } = {
    environments: [environment("stage", "stage"), environment("prod", "production", "production")],
  },
  waiting: ReleaseContentsSummary = releaseContentsSummary([], 20),
  /** The page's flow; absent, it holds none. */
  flow?: ReadonlyMap<string, Shown<Deployment>>,
) {
  const pane = (
    <ZeropsGroupPane
      attention={[]}
      crumbs={[{ label: "Projects", onClick: () => {} }]}
      history={{ kind: "reading" }}
      groupId="shop"
      name="Shop"
      {...who}
      {...stops}
      slots={stops.slots ?? slotsOf(stops.environments)}
      onFinish={() => {}}
      finishing={false}
      onAdd={() => {}}
      names={{ mateNames: new Map() }}
      onAct={() => {}}
      onAddMate={() => {}}
      onOpenMate={() => {}}
      onSetUp={() => {}}
      pullRequests={[]}
      release={{
        offered: false,
        releasing: false,
        tag: undefined,
        reason: undefined,
        onReview: () => {},
      }}
      repo={undefined}
      tags={new Map()}
      waiting={waiting}
    />
  );
  platform.deployments = flow ?? new Map();
  return renderToStaticMarkup(pane);
}

/** What the platform answered of each stop, as the page reads it. */
const flowOf = (deployments: ReadonlyMap<string, Shown<Deployment>>) => deployments;

it("an empty open-change list makes no claim about how closed changes ended", () => {
  const markup = render();
  expect(markup).toContain("Nothing open.");
  expect(markup).not.toContain("Every change the Mates made has landed.");
});

describe("runtime without HQ detail", () => {
  it("keeps the inventory's placed stop identities when HQ has no environment read", () => {
    const projects = ["production", "stage", "mate"].map((kind) => ({
      id: kind,
      name: kind,
      status: "ACTIVE",
      hq: {
        appId: "shop",
        appName: "Shop",
        kind: kind as "production" | "stage" | "mate",
        mate: null,
      },
    }));
    expect(runtimeStopsOf("shop", projects, undefined)).toEqual([
      { projectId: "production", name: "production", tier: "production" },
      { projectId: "stage", name: "stage", tier: "stage" },
    ]);
  });
  it("names a Mate that is also the stage, and no other project, as the group's devstage", () => {
    const project = (id: string, kind: "mate" | "devstage" | "stage", appId = "shop") => ({
      id,
      name: id,
      status: "ACTIVE",
      hq: { appId, appName: "Shop", kind, mate: null },
    });
    expect(
      devstagesOf("shop", [
        project("vera", "devstage"),
        project("iris", "mate"),
        project("shop-stage", "stage"),
        project("other-dev", "devstage", "links"),
      ]),
    ).toEqual([{ id: "vera", name: "vera" }]);
  });

  it.each([
    {
      deployment: { state: "unread", waitingFor: null } as Shown<Deployment>,
      words: "Checking what runs here…",
    },
    {
      deployment: {
        state: "failed",
        failure: { kind: "transport", detail: "closed" },
        atMs: 0,
        attempt: 1,
        retryAtMs: null,
      } as Shown<Deployment>,
      words: "read what runs here. Zerops didn",
    },
    {
      deployment: {
        state: "known",
        value: { kind: "running", version: deployedVersion("v0.1.0"), activatedAt: null },
        asOf: { ordinal: 1, atMs: 0 },
        coverage: "complete",
        freshness: { kind: "live" },
      } as Shown<Deployment>,
      words: "v0.1.0",
    },
  ])("shows the shared runtime answer: $words", ({ deployment, words }) => {
    const html = renderToStaticMarkup(
      <ZeropsRuntimeStops
        stops={[{ projectId: "prod", name: "Production", tier: "production" }]}
        deployments={new Map([["prod", deployment]])}
      />,
    );
    expect(html).toContain("Production");
    expect(html).toContain(words);
  });
});

describe("ZeropsGroupPane", () => {
  it("draws every line's content", () => {
    const markup = render();

    expect(markup).toContain("Split the checkout");
    expect(markup).toContain("Cache the link previews");
    expect(markup).toContain("production");
    // Each Mate in the face its person picked.
    expect(markup.match(/data-mate-face-shape="seal"/gu)).toHaveLength(2);
  });

  // DESIGN §3.4, M7: a stop the grant withholds keeps its place in the list and nothing of its
  // project — neither its name, what it runs, nor a way into it.
  it("draws a stop the grant withholds as its tier and why", () => {
    const markup = render(undefined, {
      environments: [
        environment("stage", "Shop stage"),
        {
          ...environment("prod", "Harbor live", "production"),
          version: {
            name: undefined,
            label: "9e8d7c6",
            commit: "9e8d7c6",
            sha: "9e8d7c6".padEnd(40, "0"),
            taggedBy: undefined,
          },
        },
      ],
      withheldNotice: (projectId) => (projectId === "prod" ? CHECKING : null),
    });

    expect(markup).toContain("production");
    expect(markup).toContain(CHECKING);
    expect(markup).not.toContain("Harbor live");
    expect(markup).not.toContain("9e8d7c6");
    expect(markup).toContain("3f9c1b2");
    expect(markup.match(/<button/g)?.length).toBe(render().match(/<button/g)!.length - 1);
  });

  it("says at least how many changes wait for production where HQ stopped counting", () => {
    const markup = render(undefined, undefined, {
      subjects: ["Two-step checkout"],
      more: 9999,
      total: 10000,
      atLeast: true,
    });

    expect(markup).toContain("Merged, waiting for production · 10000+");
    expect(markup).toContain("+9999+ more");
  });

  describe("the Environments section", () => {
    const slots = (over: Partial<Parameters<typeof environmentSlots>[0]>) =>
      environmentSlots({
        environments: [],
        devstages: [],
        pending: [],
        halfMade: [],
        recipeTiers: ["stage", "production"],
        recipeRead: true,
        mayAdd: true,
        writer: false,
        productionRuns: "unknown",
        waiting: { count: 0, atLeast: false },
        mainHasCode: true,
        releaseOffered: false,
        releasing: undefined,
        ...over,
      });

    it("is not drawn before HQ's environments are read: nothing is known to be absent", () => {
      const markup = render(undefined, { environments: [], slots: [] });
      expect(markup).not.toContain("Environments");
      expect(markup).not.toContain("Not added");
    });

    it("is there with nothing added: two quiet slots, each with its Add", () => {
      const markup = render(undefined, { environments: [], slots: slots({}) });
      expect(markup).toContain("Environments");
      expect(markup).toContain("Add stage");
      expect(markup).toContain("Add production");
    });

    it("offers no Add to somebody who may not add, and says a tier waits for the recipe", () => {
      const markup = render(undefined, {
        environments: [],
        slots: slots({ mayAdd: false, recipeTiers: ["stage"] }),
      });
      expect(markup).not.toContain("Add stage");
      expect(markup).toContain("Waiting for the Mate&#x27;s recipe");
    });

    it("says a Mate that is the stage is the stage, and asks no second one of the person", () => {
      const markup = render(undefined, {
        environments: [],
        slots: slots({ devstages: [{ id: "dev", name: "Vera" }] }),
      });
      expect(markup).toContain("Vera — deployed by its agent");
      expect(markup).not.toContain("Add stage");
      expect(markup).toContain("Add production");
    });

    it("says a production being created is being set up, and offers no second Add for it", () => {
      const markup = render(undefined, {
        environments: [],
        slots: slots({ pending: [{ id: "p-new", tier: "production" }] }),
      });
      expect(markup).toContain("Setting up production…");
      expect(markup).not.toContain("Add production");
    });

    it("says a half-made environment is unfinished, with Finish setup and no Add for its tier", () => {
      const markup = render(undefined, {
        environments: [],
        slots: slots({ halfMade: [{ id: "p-half", tier: "production" }] }),
      });
      expect(markup).toContain("Setup isn&#x27;t finished");
      expect(markup).toContain("Finish setup");
      expect(markup).not.toContain("Add production");
      expect(markup).not.toContain("Waiting for the Mate&#x27;s recipe");
    });

    it("says an empty production waits for its first release, with Review release where offered", () => {
      const prod = environment("prod", "production", "production");
      const markup = render(undefined, {
        environments: [prod],
        slots: slots({
          environments: [{ id: "prod", tier: "production" }],
          recipeTiers: [],
          productionRuns: "empty",
          releaseOffered: true,
        }),
      });
      expect(markup).toContain("No release yet");
      expect(markup).not.toContain("Add production");
    });
  });

  it("lists nothing as waiting for a production the application does not have", () => {
    const markup = render(
      undefined,
      { environments: [environment("stage", "stage")] },
      { subjects: ["Two-step checkout"], more: 0, total: 1, atLeast: false },
    );
    expect(markup).not.toContain("Two-step checkout");
    expect(markup).not.toContain("waiting for production");
  });

  it("says an empty stage's first deploy on its line, as its cell does", () => {
    const empty = {
      ...environment("stage", "stage"),
      version: { ...environment("stage", "stage").version, label: undefined, commit: undefined },
    } as EnvironmentRow;
    const markup = render(undefined, {
      environments: [empty],
      firstDeployOf: (projectId) => (projectId === "stage" ? { kind: "on-its-way" } : undefined),
    });
    expect(markup).toContain("First deploy on its way");
  });

  // F13, 2026-10-03: a stage whose version was still being read wrote "none" in its version column,
  // while its page said it was checking.
  describe("names what a stop runs in its version column, as its page does", () => {
    const unnamed = {
      ...environment("stage", "stage"),
      version: { ...environment("stage", "stage").version, label: undefined, commit: undefined },
      tone: "neutral",
    } as EnvironmentRow;
    const running = (name: string): Shown<Deployment> => ({
      state: "known",
      value: { kind: "running", activatedAt: null, version: deployedVersion(name) },
      asOf: { ordinal: 1, atMs: NOW },
      coverage: "complete",
      freshness: { kind: "live" },
    });
    /** The stage's line: the cell between its name and its state. */
    const cell = (markup: string) =>
      /<span class="truncate text-end font-mono[^"]*">([^<]*)<\/span>/u.exec(markup)?.[1];

    it.each([
      {
        name: "checking while nothing has answered",
        deployment: undefined,
        expected: "Checking what runs here…",
      },
      {
        name: "checking while what runs is read",
        deployment: UNREAD,
        expected: "Checking what runs here…",
      },
      {
        name: "the version the platform names before the row does",
        deployment: running("main 6aeae99"),
        expected: "6aeae99",
      },
      {
        name: "none once the platform says nothing runs",
        deployment: NONE,
        expected: "Nothing deployed yet",
      },
    ])("$name", ({ deployment, expected }) => {
      const markup = render(
        undefined,
        { environments: [unnamed] },
        undefined,
        flowOf(new Map(deployment === undefined ? [] : [["stage", deployment]])),
      );
      expect(cell(markup)).toBe(expected);
    });
  });

  it("holds its title's line while the listing has not named the project: no id, no placeholder", () => {
    const markup = render({ mates: [], name: undefined });
    const title = markup.slice(markup.indexOf("<h1"), markup.indexOf("</h1>"));

    expect(title).not.toContain("grp7Kq2");
    expect(title).not.toContain("Project");
    expect(title.replace(/<[^>]*>/gu, "")).toBe("\u00a0");
  });

  // SPEC §1: the page stands in the frame /zerops stands in, its trail in the bar.
  it("stands in the hosted frame with its trail in the bar", () => {
    const markup = render();
    const bar = markup.slice(markup.indexOf("data-zerops-frame="), markup.indexOf("<h1"));

    expect(markup).toContain("data-zerops-frame=");
    expect(bar).toMatch(/<nav aria-label="[^"]*breadcrumb"[\s\S]*Projects[\s\S]*<\/nav>/);
  });

  it("spaces its blocks by the frame's one gap, as the header is, adding no margin of their own", () => {
    const markup = render();
    const sections = [...markup.matchAll(/<section(?: class="([^"]*)")?>/g)].map((m) => m[1] ?? "");
    const attention = /class="([^"]*)" data-zerops-surface="project-attention/.exec(markup)?.[1];
    expect(sections.length).toBeGreaterThan(0);
    expect(attention).toBeDefined();
    for (const classes of [...sections, attention ?? ""])
      expect(classes).not.toMatch(/(^|\s)m[by]-\d/);
  });

  const NO_MATE = "No Mate is working on this project yet.";

  it("never says no Mate is on it while the listing is unread: a placeholder instead", () => {
    const markup = render({
      mates: [],
      matesNotice: {
        region: "placeholder",
        message: { text: "Checking who is on it…", afterMs: 400, tone: "quiet" },
        affordance: null,
      },
    });

    expect(markup).not.toContain(NO_MATE);
    expect(markup).toContain("Checking who is on it…");
    expect(markup).not.toContain("Try again");
  });

  it("names why the listing's read failed once, with one Try again, and no none", () => {
    const markup = render({
      mates: [],
      matesNotice: {
        region: "message",
        message: {
          text: "Couldn't read who is on this project. Zerops didn't answer.",
          afterMs: 0,
          tone: "alert",
        },
        affordance: { kind: "retry", label: "Try again" },
      },
      onMatesNoticeAct: () => {},
    });

    expect(markup).not.toContain(NO_MATE);
    expect(markup.match(/Zerops didn(?:&#x27;|')t answer\./g)).toHaveLength(1);
    expect(markup.match(/Try again/g)).toHaveLength(1);
  });

  it("says no Mate is on it only once the listing is complete", () => {
    expect(render({ mates: [], matesNotice: null })).toContain(NO_MATE);
  });
});

const fullSha = (seed: string) => seed.padEnd(40, "0");

const ENDED: ReadonlySet<HqJob["state"]> = new Set([
  "live",
  "failed",
  "refused",
  "skipped",
  "superseded",
]);

/** HQ's job of a deploy of `commit` in `state`. */
const deployRecord = (commit: string, state: HqJob["state"], over: Partial<HqJob> = {}): HqJob => ({
  id: "1",
  kind: "deploy",
  service: null,
  sha: commit,
  state,
  cause: "merge",
  ref: null,
  reason: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
  at: "2026-09-19T11:00:00Z",
  endedAt: ENDED.has(state) ? "2026-09-19T11:04:00Z" : null,
  supersededBy: null,
  ...over,
});

/** One service of a stop: what it runs, and how HQ records its deploy of that commit went. */
const service = (
  hostname: string,
  seed: string,
  name: string | undefined,
  state: HqJob["state"] = "live",
): EnvironmentServiceState => ({
  hostname,
  repository: `${hostname}dev`,
  // As HQ names the version it made (`versionName`): its release tag, else its branch, and the
  // commit's short sha.
  appVersionName: `${name ?? "main"} ${fullSha(seed).slice(0, 7)}`,
  deploy: { latest: deployRecord(fullSha(seed), state), live: null },
});

const UNREAD: Shown<Deployment> = { state: "unread", waitingFor: null };
const NONE: Shown<Deployment> = {
  state: "known",
  value: { kind: "none" },
  asOf: { ordinal: 1, atMs: NOW },
  coverage: "complete",
  freshness: { kind: "live" },
};

const RELEASE_OFF = {
  offered: false,
  releasing: false,
  tag: undefined,
  reason: undefined,
  onReview: () => {},
};

/**
 * What a production's releases read, newest first, the newest running there. Every earlier one
 * lists api at `e{index}`, each service in `moving` at `{its initial}{index}`, and every other
 * service at what runs.
 */
const releases = (
  count: number,
  running: ReadonlyMap<string, string>,
  moving: ReadonlyArray<string> = [],
): Array<FlowReleaseRow> =>
  Array.from({ length: count }, (_, index) =>
    releaseRow(
      {
        tag: `v0.1.${String(13 - index)}`,
        verdict: "approved",
        detail: undefined,
        line: `api ${String(index)}`,
        entries:
          index === 0
            ? [...running].map(([service, commit]) => ({ service, commit }))
            : [
                { service: "api", commit: fullSha(`e${String(index)}`) },
                ...[...running]
                  .filter(([service]) => service !== "api")
                  .map(([service, commit]) => ({
                    service,
                    commit: moving.includes(service)
                      ? fullSha(`${service.slice(0, 1)}${String(index)}`)
                      : commit,
                  })),
              ],
        taggedAt: new Date(NOW - (index + 1) * 3_600_000).toISOString(),
      },
      index,
      { production: running, failed: [], live: index === 0 },
    ),
  );

const FOUR_HOURS_AGO = new Date(NOW - 4 * 3_600_000).toISOString();

/** A commit as HQ compares it; none of HQ's changes landed it. */
const hqCommit = (seed: string, subject: string, author = "ales"): CompareCommit => ({
  sha: fullSha(seed),
  subject,
  authorName: author,
  at: FOUR_HOURS_AGO,
  change: null,
});

/** What one release carried of apidev, as HQ compared it: `subjects`, newest first. */
const apidev = (...subjects: ReadonlyArray<string>): Moved => ({
  repository: "apidev",
  services: ["api"],
  commits: subjects.map((subject, index) => hqCommit(`a${String(index)}`, subject)),
  total: subjects.length,
  truncated: false,
});
const webdev = (...subjects: ReadonlyArray<string>): Moved => ({
  repository: "webdev",
  services: ["web"],
  commits: subjects.map((subject, index) => hqCommit(`w${String(index)}`, subject)),
  total: subjects.length,
  truncated: false,
});
const known = (...moved: ReadonlyArray<Moved>): MovedCommits => ({ state: "known", moved });

/** What v0.1.13 and v0.1.12 carried. */
const CARRIED: ReadonlyMap<string, MovedCommits> = new Map([
  ["v0.1.13", known(apidev("Fix the cart total", "Tidy the cart"))],
  ["v0.1.12", known(apidev("Two-step checkout"))],
]);

interface StopCase {
  readonly readAgain?: ReactNode;
  readonly tier: EnvironmentRow["tier"];
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  readonly deployment?: Shown<Deployment>;
  /** What the platform lists for each service; unread unless given. */
  readonly platform?: Shown<ReadonlyArray<StopService>>;
  readonly waiting?: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
  /** How many wait in all, where HQ counted more than it listed. */
  readonly notLive?: { readonly total: number; readonly atLeast: boolean };
  readonly offered?: string;
  /** Why the release is not offered, as the flow's gate says. */
  readonly releaseReason?: string;
  readonly failed?: StopFailure;
  /** Whether the deploy key HQ holds for the stop no longer works. */
  readonly keyInvalid?: boolean;
  /** Whether HQ holds a deploy key for the stop; held unless given. */
  readonly keyHeld?: boolean;
  /** Whether the person may keep the stop's deploy key. */
  readonly mayKeep?: boolean;
  readonly releases?: number;
  readonly atMainHead?: boolean;
  readonly history?: ZeropsHistoryState;
  /** The services, besides api, whose commit each earlier release moves. */
  readonly moving?: ReadonlyArray<string>;
  /** Whether the person may deploy HQ's commit again over a version HQ did not make. */
  readonly mayDeployAgain?: boolean;
  /** The services the tier declares and the project lacks. */
  readonly notInZerops?: ReadonlyArray<string>;
  /** What HQ answered of the deploys the last verb pressed here asked for. */
  readonly deployAnswer?: HqDeployAnswer;
  /** What each release carried, as HQ compared it; none unless given. */
  readonly carried?: ReadonlyMap<string, MovedCommits> | undefined;
  /** Production's services whose commit cannot be told. */
  readonly untold?: ReadonlyArray<string>;
}

/** A stop's page with every read already done — the producers' words, the pane's drawing. */
function renderStop(input: StopCase): string {
  const name = input.tier === "production" ? "production" : "stage";
  const declared = {
    projectId: `shop-${name}`,
    name,
    tier: input.tier,
    sources: input.tier === "production" ? ("release" as const) : ["main"],
    services: input.services,
    environment: name,
    keyHeld: input.keyHeld ?? true,
    keyInvalid: input.keyInvalid ?? false,
  };
  const stop = environmentRow(declared);
  const deployment: Shown<Deployment> =
    input.deployment ??
    (input.services.length === 0
      ? UNREAD
      : {
          state: "known",
          value: { kind: "running", activatedAt: null, version: stop.version },
          asOf: { ordinal: 1, atMs: NOW },
          coverage: "complete",
          freshness: { kind: "live" },
        });
  const view = stopView({ deployment, row: stop, nowMs: NOW });
  const rows = serviceRows({
    environment: name,
    services: input.services,
    platform: input.platform ?? { state: "unread", waitingFor: null },
    mainHead: undefined,
    routes: [],
    offers: [],
    nowMs: NOW,
    age: () => "1h ago",
  });
  const commits = input.waiting ?? [];
  const waiting = {
    commits,
    total: input.notLive?.total ?? commits.length,
    atLeast: input.notLive?.atLeast ?? false,
  };
  const running = new Map(
    input.services.map((entry) => [entry.hostname, entry.appVersionName?.split(" ")[0] ?? ""]),
  );
  const verdict = stopVerdict({
    tier: input.tier,
    view,
    releasing: undefined,
    failed: input.failed,
    waiting: waiting.total,
    waitingAtLeast: waiting.atLeast,
    untold: input.untold ?? [],
    release: {
      offered: input.offered !== undefined,
      tag: input.offered,
      reason: input.releaseReason,
    },
    releasedAge: undefined,
    since: undefined,
    atMainHead: input.atMainHead ?? false,
    keyGap: stopKeyGap({ ...declared, mayKeep: input.mayKeep, project: stop.name }),
  });
  return renderToStaticMarkup(
    <ZeropsStopPane
      readAgain={input.readAgain}
      carried={input.carried}
      crumbs={[{ label: "Projects", onClick: () => {} }]}
      deployAgain={
        input.mayDeployAgain === true
          ? { running: () => false, onDeployAgain: () => {} }
          : undefined
      }
      addService={
        input.mayDeployAgain === true ? { running: () => false, onAdd: () => {} } : undefined
      }
      notInZerops={input.notInZerops}
      deployAnswer={input.deployAnswer}
      deployed={new Map(view.version?.sha === undefined ? [] : [[name, view.version.sha]])}
      history={input.history ?? { kind: "reading" }}
      groupId="shop"
      names={{ mateNames: new Map() }}
      onRollBack={() => {}}
      pending={new Set()}
      release={
        input.offered === undefined
          ? RELEASE_OFF
          : { ...RELEASE_OFF, offered: true, tag: input.offered }
      }
      releases={
        input.tier === "production" ? releases(input.releases ?? 0, running, input.moving) : []
      }
      repo="appdev"
      routes={[]}
      services={rows}
      stop={stop}
      tags={new Map()}
      trouble={null}
      verdict={verdict}
      untold={input.untold ?? []}
      view={view}
      waiting={waiting}
    />,
  );
}

it("keeps runtime read recovery inside the verdict that reports its failure", () => {
  const markup = renderStop({
    tier: "stage",
    services: [],
    deployment: {
      state: "failed",
      failure: { kind: "transport", detail: "timeout" },
      atMs: NOW,
      attempt: 1,
      retryAtMs: null,
    },
    readAgain: <button>Again</button>,
  });
  const document = new Window().document;
  document.body.innerHTML = markup;
  const panel = document.querySelector('[data-zerops-primitive="verdict-panel"]');
  expect(panel?.textContent).toContain("Again");
  expect(panel?.textContent).toContain("Zerops");
});

const TWO_LIVE = [service("api", "a1", "v0.1.13"), service("web", "b2", "v0.1.13")];

const count = (markup: string, needle: string | RegExp) => markup.split(needle).length - 1;

// The deploy-jobs design: each service's newest job says where it stands — its attempt of how
// many, when the next is due, why it ended and when — and a version HQ did not make is said, with
// HQ's commit to deploy again and the service in Zerops, never overwritten.
describe("ZeropsStopPane — a service's job, and a version HQ did not deploy", () => {
  const LIVE = deployRecord(fullSha("a1"), "live", { id: "5", appVersionId: "av-hq" });
  const drifted: EnvironmentServiceState = {
    hostname: "api",
    repository: "apidev",
    serviceId: "svc-api",
    appVersionName: "hotfix",
    activeVersionId: "av-hand",
    deploy: { latest: LIVE, live: LIVE },
  };
  const jobOf = (markup: string) =>
    /data-zerops-surface="stop-service-job" data-zerops-job-state="(\w+)"/u.exec(markup)?.[1];

  it.each<{
    readonly name: string;
    readonly latest: HqJob;
    readonly state: string;
    readonly contains: ReadonlyArray<string>;
  }>([
    {
      name: "queued",
      latest: deployRecord(fullSha("b2"), "queued"),
      state: "queued",
      contains: ["b200000 queued"],
    },
    {
      name: "building",
      latest: deployRecord(fullSha("b2"), "building", { processId: "pr-1" }),
      state: "building",
      contains: ["Building b200000"],
    },
    {
      name: "refused at its one try",
      latest: deployRecord(fullSha("b2"), "refused", { reason: "git: object not found" }),
      state: "refused",
      contains: ["HQ refused b200000 1h ago", "git: object not found"],
    },
    {
      name: "skipped",
      latest: deployRecord(fullSha("b2"), "skipped", {
        reason: "apidev has no zerops.yaml at b200000",
      }),
      state: "skipped",
      contains: ["HQ skipped b200000 1h ago", "apidev has no zerops.yaml at b200000"],
    },
  ])("says a service's newest job $name", ({ latest, state, contains }) => {
    const markup = renderStop({
      tier: "stage",
      services: [{ hostname: "api", repository: "apidev", deploy: { latest, live: null } }],
    });
    expect(jobOf(markup)).toBe(state);
    for (const text of contains) expect(markup).toContain(text);
  });

  it.each(["building", "failed", "live"] as const)("offers inspection of a %s deploy", (state) => {
    const latest = deployRecord(fullSha("b2"), state, {
      id: "7",
      processId: "p7",
      appVersionId: "v7",
    });
    const markup = renderStop({
      tier: "stage",
      services: [
        {
          hostname: "api",
          repository: "apidev",
          deploy: { latest, live: state === "live" ? latest : null },
        },
      ],
    });
    expect(markup).toContain("View deploy");
    expect(markup).toContain('data-zerops-deploy-job="7"');
  });

  it("offers no inspection when HQ recorded no platform handle", () => {
    const latest = deployRecord(fullSha("b2"), "refused", { processId: null, appVersionId: null });
    expect(
      renderStop({
        tier: "stage",
        services: [{ hostname: "api", repository: "apidev", deploy: { latest, live: null } }],
      }),
    ).not.toContain("View deploy");
  });

  it("says HQ's words for a failure once, in the verdict that names it", () => {
    const reason = "No zerops.yaml at the commit.";
    const markup = renderStop({
      tier: "stage",
      services: [
        {
          hostname: "api",
          repository: "apidev",
          deploy: { latest: deployRecord(fullSha("b2"), "failed", { reason }), live: null },
        },
      ],
      failed: {
        label: "b200000",
        service: "api",
        sha: fullSha("b2"),
        running: undefined,
        redeploy: undefined,
        message: reason,
        mayRunAgain: false,
      },
    });
    expect(jobOf(markup)).toBe("failed");
    expect(count(markup, reason)).toBe(1);
  });

  it("says nothing of a job that went live", () => {
    expect(jobOf(renderStop({ tier: "stage", services: TWO_LIVE }))).toBeUndefined();
  });

  it("offers HQ's commit again and the service in Zerops, to one who may run it again", () => {
    const markup = renderStop({ tier: "stage", services: [drifted], mayDeployAgain: true });
    expect(markup).toContain('data-zerops-surface="stop-service-drift"');
    expect(markup).toContain("api runs “hotfix”, which HQ did not deploy");
    expect(markup).toContain("Deploy a100000 again");
    expect(markup).toContain('href="https://app.zerops.io/service-stack/svc-api"');
    expect(markup).toContain("Open in Zerops");
  });

  it("says it, with the service in Zerops only, to one who may not", () => {
    const markup = renderStop({ tier: "stage", services: [drifted] });
    expect(markup).toContain("api runs “hotfix”, which HQ did not deploy");
    expect(markup).not.toContain("Deploy a100000 again");
    expect(markup).toContain("Open in Zerops");
  });

  it("offers nothing to ask again where a newer job of another commit stands for the service", () => {
    const markup = renderStop({
      tier: "stage",
      services: [
        {
          ...drifted,
          deploy: {
            latest: deployRecord(fullSha("c3"), "refused", { id: "6", reason: "no key" }),
            live: LIVE,
          },
        },
      ],
      mayDeployAgain: true,
    });
    expect(markup).toContain("api runs “hotfix”, which HQ did not deploy");
    expect(markup).not.toContain("Deploy a100000 again");
    expect(markup).toContain("Open in Zerops");
  });

  // Audit D2: a service the recipe declares and the project lacks is said, never added by HQ
  // alone; whoever may Run again adds it.
  it("says what the recipe declares and the project lacks, offering to add it", () => {
    const offered = renderStop({
      tier: "stage",
      services: TWO_LIVE,
      notInZerops: ["db"],
      mayDeployAgain: true,
    });
    expect(offered).toContain('data-zerops-surface="stop-not-in-zerops"');
    expect(offered).toContain("db · declared in the recipe, not in Zerops");
    expect(offered).toContain("Add db");
    const told = renderStop({ tier: "stage", services: TWO_LIVE, notInZerops: ["db"] });
    expect(told).toContain("db · declared in the recipe, not in Zerops");
    expect(told).not.toContain("Add db");
  });

  it.each(["building", "queued", "refused", "skipped"] as const)(
    "says a %s answer once on its service row",
    (state) => {
      const markup = renderStop({
        tier: "stage",
        services: [service("api", "a1", "v0.1.13", state)],
        deployAnswer: {
          jobs: [
            {
              environment: "stage",
              kind: "deploy",
              service: "api",
              sha: fullSha("a1"),
              job: "8",
              state,
              processId: "process-8",
              behind: null,
              reason: null,
            },
          ],
          note: null,
        },
      });
      const document = new Window().document;
      document.body.innerHTML = markup;
      const jobs = document.querySelectorAll(`[data-zerops-job-state="${state}"]`);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.closest("li")?.textContent).toContain("api");
      expect(jobs[0]?.textContent).toContain("a100000");
      expect(document.body.textContent.match(new RegExp(state, "gi"))).toHaveLength(1);
    },
  );

  it("says no drift while the service runs what HQ put live", () => {
    const markup = renderStop({
      tier: "stage",
      services: [{ ...drifted, activeVersionId: "av-hq" }],
      mayDeployAgain: true,
    });
    expect(markup).not.toContain('data-zerops-surface="stop-service-drift"');
  });
});

describe("ZeropsStopPane", () => {
  it.each(["stage", "production"] as const)(
    "opens the %s environment's own Zerops project from its menu",
    (tier) => {
      const document = new Window().document;
      document.body.innerHTML = renderStop({ tier, services: [] });
      const link = Array.from(document.querySelectorAll("a")).find(
        (entry) => entry.textContent === "Open in Zerops",
      );
      expect(link?.getAttribute("href")).toBe(`https://app.zerops.io/project/shop-${tier}`);
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noreferrer");
    },
  );
  it.each<{
    readonly name: string;
    readonly input: StopCase;
    readonly contains: ReadonlyArray<string>;
    readonly lacks?: ReadonlyArray<string>;
  }>([
    {
      name: "a production running everything merged",
      input: { tier: "production", services: TWO_LIVE, releases: 2 },
      contains: [
        "Production already runs what is merged.",
        "Moves on release · 2 services",
        "Services · 2",
        "Releases · 2",
        "Live",
      ],
      lacks: ["Nothing needs you here.", "Tagged by"],
    },
    {
      name: "a production with a service nobody can tell the commit of says so beside what waits",
      input: {
        tier: "production",
        services: [service("api", "a1", "v0.1.13"), service("web", "b2", "hotfix")],
        releases: 1,
        waiting: [{ sha: fullSha("c1"), subject: "Two-step checkout" }],
        untold: ["web"],
        offered: "v0.1.14",
      },
      contains: [
        "1 change waiting for production.",
        "Two-step checkout",
        "Can&#x27;t tell what web runs.",
      ],
    },
    {
      name: "a production none of whose services can be told offers its release, never all clear",
      input: {
        tier: "production",
        services: [service("api", "a1", "hotfix")],
        releases: 1,
        untold: ["api"],
        offered: "v0.1.14",
      },
      contains: ["Can&#x27;t tell what api runs.", ">Review release</button>"],
      lacks: ["Production already runs what is merged."],
    },
    {
      name: "a production three changes behind, with a release offered",
      input: {
        tier: "production",
        services: [service("api", "a1", "v0.1.13")],
        releases: 1,
        waiting: [
          { sha: fullSha("c1"), subject: "Two-step checkout" },
          { sha: fullSha("c2"), subject: "Fix the VAT table" },
          { sha: fullSha("c3"), subject: "Retry the webhook" },
        ],
        offered: "v0.1.14",
      },
      contains: [
        "3 changes waiting for production.",
        "Production runs v0.1.13",
        "Waiting for release · 3",
        "Two-step checkout",
        "c200000",
        ">Review release</button>",
      ],
    },
    {
      name: "a production behind by more than HQ counts says at least how many, as the verdict",
      input: {
        tier: "production",
        services: [service("api", "a1", "v0.1.13")],
        releases: 1,
        waiting: [{ sha: fullSha("c1"), subject: "Two-step checkout" }],
        notLive: { total: 10000, atLeast: true },
        offered: "v0.1.14",
      },
      contains: [
        "10000+ changes waiting for production.",
        "Waiting for release · 10000+",
        "Two-step checkout",
      ],
    },
    {
      name: "a production whose deploy failed",
      input: {
        tier: "production",
        services: [service("api", "a1", "v0.1.14", "failed")],
        failed: {
          label: "v0.1.14",
          service: "api",
          sha: undefined,
          running: undefined,
          redeploy: undefined,
          message: undefined,
          mayRunAgain: false,
        },
      },
      contains: ["The deploy of v0.1.14 failed on api."],
    },
    {
      name: "a production the migration holds, in HQ's words under the failure",
      input: {
        tier: "production",
        services: [service("api", "a1", "v0.1.13", "failed")],
        failed: {
          label: "v0.1.14",
          service: "api",
          sha: undefined,
          running: undefined,
          redeploy: undefined,
          message: "Held at migration: api runs a100000; Run brings it to b200000.",
          mayRunAgain: false,
        },
      },
      contains: [
        "The deploy of v0.1.14 failed on api.",
        "Held at migration: api runs a100000; Run brings it to b200000.",
      ],
    },
    {
      name: "a stage with no deploy key yet, to one who may not mint it",
      input: {
        tier: "stage",
        services: [service("api", "a1", undefined, "failed")],
        keyHeld: false,
        mayKeep: false,
      },
      contains: [
        "It has no deploy key yet.",
        "Someone with Full access to the stage project in Zerops mints one here.",
      ],
      lacks: ["Run again"],
    },
    {
      name: "a stage with no deploy key yet, to one who may mint it",
      input: {
        tier: "stage",
        services: [service("api", "a1", undefined)],
        keyHeld: false,
        mayKeep: true,
      },
      contains: [],
      lacks: ["It has no deploy key yet."],
    },
    {
      name: "a production whose release is not offered says why",
      input: {
        tier: "production",
        services: [service("api", "a1", "v0.1.13")],
        releaseReason: "Releases move to HQ next; none is offered until then.",
      },
      contains: ["Releases move to HQ next; none is offered until then."],
      lacks: ["Production already runs what is merged."],
    },
    {
      name: "a stage whose deploy key no longer works",
      input: {
        tier: "stage",
        services: [service("api", "a1", undefined, "failed")],
        keyInvalid: true,
      },
      contains: [
        "Its deploy key no longer works.",
        "Someone with Full access to the stage project in Zerops mints a new one here.",
      ],
      lacks: ["Run again"],
    },
    {
      name: "a stage at the head of main",
      input: {
        tier: "stage",
        services: [service("api", "a1", undefined)],
        atMainHead: true,
        history: { kind: "read", commits: [hqCommit("a1", "Key the cache", "theo")], total: 1 },
      },
      contains: [
        "Stage runs the head of main.",
        "Running here",
        "Deploys · 1",
        "on main",
        "Not public yet",
      ],
    },
    {
      name: "a stage nothing was ever deployed to",
      input: {
        tier: "stage",
        services: [],
        deployment: NONE,
        history: { kind: "read", commits: [], total: 0 },
      },
      contains: [
        "Nothing deployed yet.",
        "The next merge to main deploys here.",
        "Deploys · 0",
        "None yet",
      ],
      lacks: ["Nothing has landed on this repository yet."],
    },
    {
      name: "a stop whose deployment is still being read",
      input: { tier: "stage", services: [] },
      contains: ["Checking what runs here…"],
    },
  ])("$name", ({ input, contains, lacks = [] }) => {
    const markup = renderStop(input);
    for (const text of contains) expect(markup).toContain(text);
    for (const text of lacks) expect(markup).not.toContain(text);
  });

  it.each<{ readonly name: string; readonly input: StopCase; readonly detail: string }>([
    {
      name: "a production behind",
      input: {
        tier: "production",
        services: [service("api", "a1", "v0.1.13")],
        waiting: [{ sha: fullSha("c1"), subject: "Two-step checkout" }],
        offered: "v0.1.14",
      },
      detail: "Production runs v0.1.13",
    },
    {
      name: "a stage at the head of main",
      input: {
        tier: "stage",
        services: [service("api", "a1", undefined)],
        atMainHead: true,
      },
      detail: fullSha("a1").slice(0, 7),
    },
  ])("says the verdict's detail inside its panel: $name", ({ input, detail }) => {
    const markup = renderStop(input);
    const panel = markup.indexOf('data-zerops-primitive="verdict-panel"');
    const at = markup.indexOf(detail, panel);
    expect(panel).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(panel);
    expect(markup.slice(panel, at)).not.toContain("</div>");
  });

  it("spaces its header, verdict and card by the frame's one gap, adding no margin of their own", () => {
    const markup = renderStop({ tier: "production", services: TWO_LIVE, releases: 1 });
    const header = /<header(?: class="([^"]*)")?>/.exec(markup);
    const verdict =
      /<div(?: class="([^"]*)")?><div class="[^"]*" data-zerops-primitive="verdict-panel"/.exec(
        markup,
      );
    expect(header).not.toBeNull();
    expect(verdict).not.toBeNull();
    for (const classes of [header?.[1], verdict?.[1]]) {
      expect(classes ?? "").not.toMatch(/(^|\s)(m[by]|mt|mb)-/);
    }
  });

  it("says a service runs nothing once on its row, in its commit's place", () => {
    const markup = renderStop({
      tier: "stage",
      services: [{ hostname: "api", repository: "apidev" }],
      deployment: NONE,
      platform: {
        ...NONE,
        value: [
          {
            service: platformService("svc-api"),
            hostname: "api",
            deployment: NONE,
          },
        ],
      },
    });
    const card = markup.slice(markup.indexOf("Services · 1"));
    expect(count(card, "Nothing deployed yet")).toBe(1);
  });

  it("never claims nothing runs on a row being deployed while nothing states what ran before", () => {
    const deploying: Shown<Deployment> = {
      ...NONE,
      value: { kind: "deploying", version: deployedVersion(fullSha("b2")), previous: null },
    };
    const markup = renderStop({
      tier: "stage",
      services: [service("api", "b2", undefined)],
      deployment: deploying,
      platform: {
        ...NONE,
        value: [{ service: platformService("svc-api"), hostname: "api", deployment: deploying }],
      },
    });
    const card = markup.slice(markup.indexOf("Services · 1"));
    expect(card).toContain("Deploying…");
    expect(card).not.toContain("Nothing deployed yet");
    expect(card).not.toContain("b200000");
  });

  it("says None yet under Services where the stop has no code service", () => {
    const markup = renderStop({ tier: "production", services: [], deployment: NONE });
    const services = markup.indexOf("Services · 0");
    expect(services).toBeGreaterThan(-1);
    expect(markup.slice(services)).toContain("None yet");
  });

  it("opens the card's first group 12px under its edge and each later one 24px under its hairline", () => {
    const markup = renderStop({ tier: "production", services: TWO_LIVE, releases: 2 });
    const groups = [...markup.matchAll(/<section class="([^"]*)"><h2/g)].map((match) =>
      (match[1] ?? "").split(" "),
    );
    expect(groups).toHaveLength(2);
    for (const classes of groups)
      expect(classes).toEqual(expect.arrayContaining(["pt-6", "first:pt-3"]));
  });

  it("draws the verdict's verb as an outline button, not a filled one", () => {
    const markup = renderStop({
      tier: "production",
      services: [service("api", "a1", "v0.1.13")],
      waiting: [{ sha: fullSha("c1"), subject: "Two-step checkout" }],
      offered: "v0.1.14",
    });
    const button = /<button[^>]*>Review release<\/button>/.exec(markup)?.[0];
    expect(button).toContain("bg-popover");
    expect(button).not.toContain("bg-primary");
  });

  it("offers the way back only to an earlier release, never to the one that runs", () => {
    const markup = renderStop({ tier: "production", services: TWO_LIVE, releases: 2 });
    expect(count(markup, ">Roll back to this</button>")).toBe(1);
  });

  it("lists the newest five releases and a quiet way to the rest", () => {
    const markup = renderStop({ tier: "production", services: TWO_LIVE, releases: 7 });
    expect(count(markup, "data-zerops-environment-row")).toBe(5);
    expect(markup).toContain("Show 2 earlier releases");
  });

  describe("says what each release carried", () => {
    /** The row of `tag`: the item its name stands in. */
    const releaseRowOf = (markup: string, tag: string) => {
      const name = markup.indexOf(`data-zerops-surface="environment-name">${tag}</span>`);
      return markup.slice(markup.lastIndexOf("<li", name), markup.indexOf("</li>", name));
    };

    it.each<{
      readonly name: string;
      readonly input: StopCase;
      readonly tag: string;
      readonly contains: ReadonlyArray<string>;
      readonly lacks?: ReadonlyArray<string>;
    }>([
      {
        name: "one repository: its newest commit's subject, over who, when and the sha",
        input: {
          tier: "production",
          services: [service("api", "a1", "v0.1.13")],
          releases: 2,
          carried: CARRIED,
        },
        tag: "v0.1.13",
        contains: ["Fix the cart total, +1 more", "ales · 4h · api 0"],
      },
      {
        name: "one repository moved of two: no service named",
        input: { tier: "production", services: TWO_LIVE, releases: 2, carried: CARRIED },
        tag: "v0.1.13",
        contains: [">Fix the cart total, +1 more<"],
        lacks: ["api: "],
      },
      {
        name: "two repositories moved: the first service named, and the rest counted",
        input: {
          tier: "production",
          services: TWO_LIVE,
          releases: 2,
          carried: new Map([
            ["v0.1.13", known(apidev("Fix the cart total", "Tidy the cart"), webdev("Restyle"))],
          ]),
        },
        tag: "v0.1.13",
        contains: [">api: Fix the cart total, +2 more<"],
      },
    ])("$name", ({ input, tag, contains, lacks = [] }) => {
      const row = releaseRowOf(renderStop(input), tag);
      for (const text of contains) expect(row).toContain(text);
      for (const text of lacks) expect(row).not.toContain(text);
    });

    it.each<{ readonly name: string; readonly carried: MovedCommits; readonly chevron: boolean }>([
      {
        name: "while HQ compares it, with no chevron",
        carried: { state: "reading" },
        chevron: false,
      },
      {
        name: "where HQ would not compare it, with a closed chevron to say why",
        carried: { state: "failed", reason: "HQ has no such commit." },
        chevron: true,
      },
    ])("keeps each row's shas $name", ({ carried, chevron }) => {
      const markup = renderStop({
        tier: "production",
        services: TWO_LIVE,
        releases: 2,
        carried: new Map([
          ["v0.1.13", carried],
          ["v0.1.12", carried],
        ]),
      });
      for (const [tag, line] of [
        ["v0.1.13", "api 0"],
        ["v0.1.12", "api 1"],
      ] as const) {
        const row = releaseRowOf(markup, tag);
        expect(row).toContain(`data-zerops-surface="environment-summary">${line}</span>`);
        expect(row.includes('aria-expanded="false"')).toBe(chevron);
      }
      expect(count(markup, 'aria-expanded="true"')).toBe(0);
    });

    it("is the row it was where the page reads nothing for it", () => {
      const running = new Map(
        TWO_LIVE.map((entry) => [entry.hostname, entry.appVersionName?.split(" ")[0] ?? ""]),
      );
      const markup = renderStop({ tier: "production", services: TWO_LIVE, releases: 2 });
      expect(markup).toContain(
        renderToStaticMarkup(
          <ZeropsReleaseRows
            groupId="shop"
            onRollBack={() => {}}
            pending={new Set()}
            releases={releases(2, running)}
          />,
        ),
      );
      expect(markup).not.toContain("release-carried");
    });

    it.each<{ readonly name: string; readonly carried?: ReadonlyMap<string, MovedCommits> }>([
      { name: "read", carried: CARRIED },
      { name: "unread" },
    ])("keeps the list's own pins with its commits $name", ({ carried }) => {
      const two = renderStop({ tier: "production", services: TWO_LIVE, releases: 2, carried });
      expect(count(two, ">Roll back to this</button>")).toBe(1);
      const seven = renderStop({
        tier: "production",
        services: TWO_LIVE,
        releases: 7,
        carried,
      });
      expect(count(seven, "data-zerops-environment-row")).toBe(5);
      expect(seven).toContain("Show 2 earlier releases");
    });
  });

  it("writes no Deploys under a production and no Releases under a stage", () => {
    expect(renderStop({ tier: "production", services: TWO_LIVE, releases: 1 })).not.toContain(
      "Deploys",
    );
    expect(renderStop({ tier: "stage", services: [] })).not.toContain("Releases");
  });
});

describe("groupMateOf — a Mate on the project, as its page draws it", () => {
  /** Iris's project, listed and not connected: this page holds no socket to her. */
  const IRIS = {
    key: "iris:zcp",
    project: { id: "iris", name: "Shop - Iris", status: "ACTIVE", tagList: ["mate"] },
    group: "ready",
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  } as unknown as ZeropsCandidate;
  const SPLITTING = {
    kind: "working",
    face: "working",
    subject: "Split the checkout",
    snippet: "Moved the cart into its own module.",
    at: "2026-09-25T11:00:00.000Z",
  } as ZeropsAgentActivity;
  const draw = (read: ZeropsAgentActivity | undefined) =>
    groupMateOf({
      item: IRIS,
      read,
      tint: "amber",
      reviewWaits: false,
      mine: true,
      update: undefined,
    });

  it("draws an unopened Mate from HQ's live word: awake, on its task", () => {
    expect(draw(SPLITTING)).toMatchObject({
      projectId: "iris",
      face: "working",
      subject: "Split the checkout",
      snippet: "Moved the cart into its own module.",
    });
  });

  // Its container runs (ready) though no socket of this page reaches it: awake, as its menu row
  // draws it (restores 374c9923e's rule over bb04ea183's asleep).
  it("draws a running Mate awake at rest, saying nothing, where only a word at rest is known", () => {
    expect(draw({ ...SPLITTING, remembered: true })).toMatchObject({
      face: "idle",
      subject: undefined,
    });
  });

  it.each([
    ["its container runs, nothing heard yet", "ready", false, "idle"],
    ["HQ holds one of its links open, the listing not caught up", "provisioning", true, "idle"],
    ["its container is not reachable, HQ holds no link", "unavailable", false, "sleep"],
  ] as const)("%s: %s", (_case, group, online, face) => {
    const mates = new Map([
      [
        "iris",
        {
          presence: { online, since: "2026-09-25T10:00:00.000Z", overview: "none" },
        } as unknown as MateLiveView,
      ],
    ]);
    expect(
      groupMateOf({
        item: { ...IRIS, group },
        read: undefined,
        mates,
        tint: "amber",
        reviewWaits: false,
        mine: true,
        update: undefined,
      }).face,
    ).toBe(face);
  });

  it("wakes a newly arriving Mate, then returns to its resting face at the bound", () => {
    const born = Date.parse("2026-10-03T10:00:00Z");
    const item = { ...IRIS, project: { ...IRIS.project, created: new Date(born).toISOString() } };
    const at = (nowMs: number) =>
      groupMateOf({
        item,
        nowMs,
        read: undefined,
        tint: "amber",
        reviewWaits: false,
        mine: true,
        update: undefined,
      });
    expect(at(born + 60_000).face).toBe("waking");
    expect(at(born + 31 * 60_000).face).toBe("idle");
  });
});

describe("detailTrail: where a detail page sits", () => {
  it.each([
    ["the projects page", undefined, ["Projects"]],
    ["a project whose name is known", { groupId: "grp7Kq2", name: "Shop" }, ["Projects", "Shop"]],
    // Before the listing is read the project's crumb waits: its id is never a name.
    ["a project whose name is not read yet", { groupId: "grp7Kq2", name: undefined }, ["Projects"]],
  ] as const)("%s", (_case, inside, labels) => {
    expect(detailTrail(inside).map((crumb) => crumb.label)).toEqual(labels);
  });
});
