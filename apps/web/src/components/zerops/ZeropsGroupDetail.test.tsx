import {
  deployedVersion,
  environmentRow,
  releaseContentsSummary,
  releaseRow,
  type EnvironmentRow,
  type EnvironmentServiceState,
  type FlowReleaseRow,
  type GiteaCommit,
} from "@t3tools/client-runtime/zerops";
import {
  serviceRows,
  stopVerdict,
  stopView,
  type Deployment,
  type StopFailure,
  type StopService,
} from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { service as platformService } from "~/zerops/__fixtures__/platformData";
import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";

import { serviceBuildRequest, ZeropsGroupPane, ZeropsStopPane } from "./ZeropsGroupDetail";
import { ZeropsReleaseRows } from "./ZeropsReleaseRows";

/** The rows' one clock, fixed: an age is the producer's to test, not the minute this ran in. */
const NOW = vi.hoisted(() => Date.parse("2026-09-25T12:00:00Z"));
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
  face: "working" as const,
  subject,
  snippet: undefined,
  when: "1h",
});

function render(
  who: Pick<
    React.ComponentProps<typeof ZeropsGroupPane>,
    "mates" | "matesNotice" | "onMatesNoticeAct"
  > = {
    mates: [
      mate("theo", "Theo", "Cache the link previews"),
      mate("iris", "Iris", "Split the checkout"),
    ],
  },
  stops: Pick<React.ComponentProps<typeof ZeropsGroupPane>, "environments" | "withheldNotice"> = {
    environments: [environment("stage", "stage"), environment("prod", "production")],
  },
) {
  return renderToStaticMarkup(
    <ZeropsGroupPane
      attention={[]}
      commits={{ kind: "no-gitea" }}
      crumbs={[{ label: "Projects", onClick: () => {} }]}
      groupId="shop"
      {...who}
      {...stops}
      name="Shop"
      names={{ mateNames: new Map(), groupName: "Shop" }}
      onAct={() => {}}
      onAddMate={() => {}}
      onOpenMate={() => {}}
      onSetUp={() => {}}
      pullRequests={[]}
      readDetail={undefined}
      release={{
        offered: false,
        releasing: false,
        tag: undefined,
        contents: [],
        onRelease: () => {},
      }}
      repo={undefined}
      waiting={releaseContentsSummary([], 20)}
    />,
  );
}

describe("ZeropsGroupPane", () => {
  it("draws every line's content", () => {
    const markup = render();

    expect(markup).toContain("Split the checkout");
    expect(markup).toContain("Cache the link previews");
    expect(markup).toContain("production");
  });

  // DESIGN §3.4, M7: a stop the grant withholds keeps its place in the list and nothing of its
  // project — neither its name, what it runs, nor a way into it.
  it("draws a stop the grant withholds as its tier and why", () => {
    const markup = render(undefined, {
      environments: [
        environment("stage", "Shop stage"),
        environment("prod", "Harbor live", "production"),
      ],
      withheldNotice: (projectId) => (projectId === "prod" ? CHECKING : null),
    });

    expect(markup).toContain("production");
    expect(markup).toContain(CHECKING);
    expect(markup).not.toContain("Harbor live");
    expect(markup.match(/3f9c1b2/g)).toHaveLength(1);
    expect(markup.match(/<button/g)?.length).toBe(render().match(/<button/g)!.length - 1);
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

/** One service of a stop, as the group's Gitea reads it: what it runs and how its deploy went. */
const service = (
  environment: string,
  hostname: string,
  seed: string,
  name: string | undefined,
  state: "success" | "failure" = "success",
): EnvironmentServiceState => ({
  hostname,
  repository: `${hostname}dev`,
  appVersionName: [fullSha(seed), name, name === undefined ? undefined : "gitea"]
    .filter((part) => part !== undefined)
    .join(" "),
  statuses: [{ context: `mate/deploy/${environment}/${hostname}`, state }],
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
  contents: [],
  onRelease: () => {},
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
        taggedAt: undefined,
      },
      index,
      { production: running, failed: new Map(), live: index === 0 },
    ),
  );

const FOUR_HOURS_AGO = new Date(NOW - 4 * 3_600_000).toISOString();

const gitCommit = (seed: string, subject: string, author?: string): GiteaCommit => ({
  sha: fullSha(seed),
  subject,
  ...(author === undefined ? {} : { author, at: FOUR_HOURS_AGO }),
});

/** apidev's default branch, newest first: what api runs, down through every earlier release's. */
const API_BRANCH: ReadonlyArray<GiteaCommit> = [
  gitCommit("a1", "Fix the cart total", "ales"),
  gitCommit("d1", "Tidy the cart"),
  gitCommit("e1", "Two-step checkout"),
  gitCommit("e2", "Retry the webhook"),
  gitCommit("e3", "Fix the VAT table"),
  gitCommit("e4", "Key the cache on locale", "wren"),
  gitCommit("d4", "Warm the cache"),
  gitCommit("e5", "Add the cache"),
  gitCommit("e6", "Open the shop"),
];

/** webdev's, the same way for web. */
const WEB_BRANCH: ReadonlyArray<GiteaCommit> = [
  gitCommit("b2", "Restyle the basket"),
  gitCommit("w1", "Add a footer"),
  gitCommit("w2", "Open the storefront"),
];

const read = (commits: ReadonlyArray<GiteaCommit>): ZeropsCommitsState => ({
  kind: "read",
  commits,
  releases: new Map(),
});

const READ_BRANCHES: ReadonlyMap<string, ZeropsCommitsState> = new Map([
  ["apidev", read(API_BRANCH)],
  ["webdev", read(WEB_BRANCH)],
]);

interface StopCase {
  readonly tier: EnvironmentRow["tier"];
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  readonly deployment?: Shown<Deployment>;
  /** What the platform lists for each service; unread unless given. */
  readonly platform?: Shown<ReadonlyArray<StopService>>;
  readonly waiting?: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
  readonly offered?: string;
  readonly failed?: StopFailure;
  readonly releases?: number;
  readonly atMainHead?: boolean;
  readonly commits?: ZeropsCommitsState;
  /** The services, besides api, whose commit each earlier release moves. */
  readonly moving?: ReadonlyArray<string>;
  /** `repository → its read`, as the page reads a production's code repositories; none unless given. */
  readonly reads?: ReadonlyMap<string, ZeropsCommitsState> | undefined;
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
  };
  const stop = environmentRow(declared);
  const view = stopView({ deployment: input.deployment ?? UNREAD, row: stop, nowMs: NOW });
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
  const waiting = input.waiting ?? [];
  const running = new Map(
    input.services.map((entry) => [entry.hostname, entry.appVersionName?.split(" ")[0] ?? ""]),
  );
  const verdict = stopVerdict({
    tier: input.tier,
    view,
    releasing: undefined,
    failed: input.failed,
    waiting: waiting.length,
    release: { offered: input.offered !== undefined, tag: input.offered },
    releasedAge: undefined,
    since: undefined,
    atMainHead: input.atMainHead ?? false,
  });
  return renderToStaticMarkup(
    <ZeropsStopPane
      commits={input.commits ?? { kind: "reading" }}
      crumbs={[{ label: "Projects", onClick: () => {} }]}
      deployed={new Map(view.version?.sha === undefined ? [] : [[name, view.version.sha]])}
      forge={{ giteaOrigin: "https://gitea.example", owner: "shop" }}
      groupId="shop"
      groupName="Shop"
      names={{ mateNames: new Map(), groupName: "Shop" }}
      onOpenProject={() => {}}
      onRollBack={() => {}}
      pending={new Set()}
      readDetail={undefined}
      release={
        input.offered === undefined
          ? RELEASE_OFF
          : { ...RELEASE_OFF, offered: true, tag: input.offered, contents: [{ commits: waiting }] }
      }
      releaseReads={
        input.reads === undefined
          ? undefined
          : {
              reads: input.reads,
              repositoryOf: new Map(
                input.services.flatMap((entry) =>
                  entry.repository === undefined ? [] : [[entry.hostname, entry.repository]],
                ),
              ),
            }
      }
      releases={
        input.tier === "production" ? releases(input.releases ?? 0, running, input.moving) : []
      }
      repo="appdev"
      routes={[]}
      services={rows}
      stop={stop}
      trouble={null}
      verdict={verdict}
      view={view}
      waiting={waiting}
    />,
  );
}

const TWO_LIVE = [
  service("production", "api", "a1", "v0.1.13"),
  service("production", "web", "b2", "v0.1.13"),
];

const count = (markup: string, needle: string | RegExp) => markup.split(needle).length - 1;

describe("ZeropsStopPane", () => {
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
      name: "a production three changes behind, with a release offered",
      input: {
        tier: "production",
        services: [service("production", "api", "a1", "v0.1.13")],
        releases: 1,
        waiting: [
          { sha: fullSha("c1"), subject: "Two-step checkout" },
          { sha: fullSha("c2"), subject: "Fix the VAT table" },
          { sha: fullSha("c3"), subject: "Retry the webhook" },
        ],
        offered: "v0.1.14",
      },
      contains: [
        "3 changes not live.",
        "Production runs v0.1.13",
        "Waiting for release · 3",
        "Two-step checkout",
        "c200000",
        ">Release v0.1.14</button>",
      ],
    },
    {
      name: "a production whose deploy failed",
      input: {
        tier: "production",
        services: [service("production", "api", "a1", "v0.1.14", "failure")],
        failed: {
          label: "v0.1.14",
          service: "api",
          sha: undefined,
          running: undefined,
          jobKnown: false,
        },
      },
      contains: ["The deploy of v0.1.14 failed on api."],
    },
    {
      name: "a stage at the head of main",
      input: {
        tier: "stage",
        services: [service("stage", "api", "a1", undefined)],
        atMainHead: true,
        commits: {
          kind: "read",
          commits: [
            { sha: fullSha("a1"), subject: "Key the cache", author: "theo", at: undefined },
          ],
          releases: new Map(),
        },
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
        commits: { kind: "read", commits: [], releases: new Map() },
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
        services: [service("production", "api", "a1", "v0.1.13")],
        waiting: [{ sha: fullSha("c1"), subject: "Two-step checkout" }],
        offered: "v0.1.14",
      },
      detail: "Production runs v0.1.13",
    },
    {
      name: "a stage at the head of main",
      input: {
        tier: "stage",
        services: [service("stage", "api", "a1", undefined)],
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
      services: [service("stage", "api", "b2", undefined)],
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
      services: [service("production", "api", "a1", "v0.1.13")],
      waiting: [{ sha: fullSha("c1"), subject: "Two-step checkout" }],
      offered: "v0.1.14",
    });
    const button = /<button[^>]*>Release v0\.1\.14<\/button>/.exec(markup)?.[0];
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
        name: "a single repository: its newest commit's subject, over who, when and the sha",
        input: {
          tier: "production",
          services: [service("production", "api", "a1", "v0.1.13")],
          releases: 2,
          reads: READ_BRANCHES,
        },
        tag: "v0.1.13",
        contains: ["Fix the cart total, +1 more", "ales · 4h · api 0"],
      },
      {
        name: "a split group where one service moved: no service named",
        input: { tier: "production", services: TWO_LIVE, releases: 2, reads: READ_BRANCHES },
        tag: "v0.1.13",
        contains: [">Fix the cart total, +1 more<"],
        lacks: ["api: ", "Restyle the basket"],
      },
      {
        name: "a split group where two moved: the first service named, and the rest counted",
        input: {
          tier: "production",
          services: TWO_LIVE,
          releases: 2,
          moving: ["web"],
          reads: READ_BRANCHES,
        },
        tag: "v0.1.13",
        contains: [">api: Fix the cart total, +2 more<"],
      },
      {
        // The fifth row shown is measured against the sixth release, which is not shown: read
        // over the shown rows alone it would be the oldest and carry the rest of the branch.
        name: "the last row shown: what came after the first release not shown",
        input: {
          tier: "production",
          services: [service("production", "api", "a1", "v0.1.13")],
          releases: 6,
          reads: READ_BRANCHES,
        },
        tag: "v0.1.9",
        contains: [">Key the cache on locale, +1 more<", "wren · 4h · api 4"],
        lacks: ["+3 more"],
      },
    ])("$name", ({ input, tag, contains, lacks = [] }) => {
      const row = releaseRowOf(renderStop(input), tag);
      for (const text of contains) expect(row).toContain(text);
      for (const text of lacks) expect(row).not.toContain(text);
    });

    it.each<{ readonly name: string; readonly reads: ZeropsCommitsState }>([
      { name: "while its commits are read", reads: { kind: "reading" } },
      { name: "where the forge would not read them", reads: { kind: "failed", reason: "Gone." } },
    ])("keeps each row's shas, with a closed chevron, $name", ({ reads }) => {
      const markup = renderStop({
        tier: "production",
        services: TWO_LIVE,
        releases: 2,
        reads: new Map([
          ["apidev", reads],
          ["webdev", reads],
        ]),
      });
      for (const [tag, line] of [
        ["v0.1.13", "api 0"],
        ["v0.1.12", "api 1"],
      ] as const) {
        const row = releaseRowOf(markup, tag);
        expect(row).toContain(`data-zerops-surface="environment-summary">${line}</span>`);
        expect(row).toContain('aria-expanded="false"');
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

    it.each<{ readonly name: string; readonly reads?: ReadonlyMap<string, ZeropsCommitsState> }>([
      { name: "read", reads: READ_BRANCHES },
      { name: "unread" },
    ])("keeps the list's own pins with its commits $name", ({ reads }) => {
      const two = renderStop({ tier: "production", services: TWO_LIVE, releases: 2, reads });
      expect(count(two, ">Roll back to this</button>")).toBe(1);
      const seven = renderStop({
        tier: "production",
        services: TWO_LIVE,
        releases: 7,
        reads,
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

describe("serviceBuildRequest", () => {
  const forge = { giteaOrigin: "https://gitea.example", owner: "shop" };
  const rows = serviceRows({
    environment: "production",
    services: TWO_LIVE,
    platform: { state: "unread", waitingFor: null },
    mainHead: undefined,
    routes: [],
    offers: [],
    nowMs: NOW,
    age: () => "",
  });

  it("reads the build of the service it expands, not the first one's", () => {
    expect(rows.map((row) => serviceBuildRequest(row, forge))).toEqual([
      { ...forge, repo: "apidev", sha: fullSha("a1") },
      { ...forge, repo: "webdev", sha: fullSha("b2") },
    ]);
  });

  it("reads nothing for a service with nothing deployed", () => {
    expect(serviceBuildRequest({ repository: "apidev", sha: undefined }, forge)).toBeNull();
  });
});
