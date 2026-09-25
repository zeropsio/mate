import {
  deployedVersion,
  environmentRow,
  releaseContentsSummary,
  releaseRow,
  type EnvironmentRow,
  type EnvironmentServiceState,
  type FlowReleaseRow,
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

const NOW = Date.parse("2026-09-25T12:00:00Z");
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

/** What a production's releases read, newest first, the newest running there. */
const releases = (count: number, running: ReadonlyMap<string, string>): Array<FlowReleaseRow> =>
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
            : [{ service: "api", commit: fullSha(`e${String(index)}`) }],
        taggedAt: undefined,
      },
      index,
      { production: running, failed: new Map(), live: index === 0 },
    ),
  );

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
      releases={input.tier === "production" ? releases(input.releases ?? 0, running) : []}
      repo="appdev"
      routes={[]}
      services={rows}
      stop={stop}
      trouble={null}
      verdict={verdict}
      view={view}
      waiting={waiting}
      menuWaiting={
        input.tier === "production" ? releaseContentsSummary([{ commits: waiting }], 8) : undefined
      }
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
