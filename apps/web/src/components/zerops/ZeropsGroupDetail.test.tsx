import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import {
  canonicalProjectFlow,
  inventoryContents,
  readsOfState,
} from "@t3tools/client-runtime/data";
import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
} from "@t3tools/client-runtime/zerops/data";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { environmentRow } from "~/components/zerops/projects/flowTestFixtures";
import {
  deployedVersion,
  environmentSlots,
  releaseRow,
  type CanonicalEnvironmentRow as EnvironmentRow,
  type EnvironmentServiceState,
  type FlowReleaseRow,
  type Moved,
  type MovedCommits,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsServiceRow } from "@t3tools/client-runtime/zerops/serviceMap";
import {
  serviceRows,
  stopKeyGap,
  stopFailedDeploys,
  stopVerdict,
  stopView,
  type Deployment,
  type StopFailure,
  type StopService,
} from "@t3tools/client-runtime/zerops/flow";
import type { HqJob } from "@t3tools/client-runtime/zerops/hq";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type { CompareCommit } from "@t3tools/shared/hqChanges";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { Window } from "happy-dom";
import { act, type ReactNode } from "react";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { AccountDataContext, type AccountData } from "~/zerops/ZeropsAccountData";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import type { CanonicalHqStructure } from "@t3tools/client-runtime/zerops/hq";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { service as platformService } from "~/zerops/__fixtures__/platformData";
import type { ZeropsHistoryState } from "~/zerops/useRepositoryHistory";

import {
  detailTrail,
  ZeropsStopDetailPage,
  ZeropsGroupPane,
  ZeropsStopPane,
  ZeropsRuntimeStops,
  devstagesOf,
  runtimeStopsOf,
  stopRepository,
} from "./ZeropsGroupDetail";
import { markupDom } from "../../../test/markupDom";
import { ZeropsReleaseRows } from "./ZeropsReleaseRows";

/** The rows' one clock, fixed: an age is the producer's to test, not the minute this ran in. */
const NOW = vi.hoisted(() => Date.parse("2026-09-25T12:00:00Z"));
/** What the platform answered of each stop, as the page's stop lines read it. */
const platform = vi.hoisted(() => ({
  deployments: new Map() as ReadonlyMap<string, unknown>,
  routeWitness: false,
  projectReads: [] as Array<string>,
  navigation: [] as Array<unknown>,
}));
vi.mock("~/zerops/activity/useProjectActivity", async (original) => {
  const activity = await original<typeof import("~/zerops/activity/useProjectActivity")>();
  return {
    ...activity,
    useProjectActivityRead: () => activity.EMPTY_PROJECT_ACTIVITY_SNAPSHOT,
  };
});
vi.mock("~/zerops/projectFlows", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useStopDeploymentsShown: () => platform.deployments,
  useProjectFlows: (...args: unknown[]) => {
    if (platform.routeWitness) {
      platform.projectReads.push("project/service/log/version/token consumer");
      throw new Error("Project reads reached before target dispatch");
    }
    throw new Error(`Unexpected flow read: ${String(args)}`);
  },
}));
vi.mock("~/zerops/ZeropsSessionProvider", async (original) => ({
  ...(await original<typeof import("~/zerops/ZeropsSessionProvider")>()),
  useZeropsSession: () => ({ status: "signed-in", activeOrganization: { id: "org" } }),
}));
vi.mock("~/zerops/accountHq", () => ({
  useAccountHq: () => ({ status: "ready", hq: { kind: "official", address: "https://hq.test" } }),
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
    useNavigate: () => (target: unknown) => {
      platform.navigation.push(target);
    },
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
    id: HqEnvironmentId.make(projectId),
    target: { kind: "zerops", projectId: ProjectId.make(projectId) },
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

/** The Environments section as it stands for these environments and nothing else. */
const slotsOf = (environments: ReadonlyArray<EnvironmentRow>) =>
  environmentSlots({
    environments: environments.map((entry) => ({ id: entry.id, tier: entry.tier })),
    devstages: [],
    pending: [],
    halfMade: [],
    recipeTiers: [],
    recipeRead: false,
    offered: { stage: false, production: false },
    productionRuns: "unknown",
    waiting: { count: 0, atLeast: false },
    mainHasCode: undefined,
    releaseOffered: false,
    releasing: undefined,
  });

function render(
  stops: Pick<
    React.ComponentProps<typeof ZeropsGroupPane>,
    "environments" | "withheldNotice" | "firstDeployOf" | "repos" | "onMirror"
  > & { readonly slots?: React.ComponentProps<typeof ZeropsGroupPane>["slots"] } = {
    environments: [environment("stage", "stage"), environment("prod", "production", "production")],
  },
  /** The page's flow; absent, it holds none. */
  flow?: ReadonlyMap<string, Shown<Deployment>>,
) {
  const pane = (
    <ZeropsGroupPane
      history={null}
      groupId="shop"
      name="Shop"
      {...stops}
      slots={stops.slots ?? slotsOf(stops.environments)}
      onFinish={() => {}}
      finishing={false}
      onAdd={() => {}}
      onSetUp={() => {}}
      release={{
        offered: false,
        releasing: false,
        tag: undefined,
        reason: undefined,
        onReview: () => {},
      }}
      repo={undefined}
    />
  );
  platform.deployments = flow ?? new Map();
  return renderToStaticMarkup(pane);
}

/** What the platform answered of each stop, as the page reads it. */
const flowOf = (deployments: ReadonlyMap<string, Shown<Deployment>>) => deployments;

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
  it("says nothing of repositories until one mirrors somewhere, then names where", () => {
    const environments = [environment("stage", "stage")];
    const repo = (name: string, url: string | null) => ({
      name,
      mainHead: null,
      updatedAt: "2026-10-13T10:00:00Z",
      remote:
        url === null
          ? null
          : {
              url,
              repositoryId: "1",
              keptAt: "2026-10-13T10:00:00Z",
              keptBy: "Zerops custodian",
              expiresAt: null,
              invalidSince: null,
            },
    });
    expect(render({ environments, repos: [repo("mailpit", null)] })).not.toContain("Repositories");
    const markup = render({
      environments,
      repos: [repo("mailpit", null), repo("medusadev", "https://github.com/acme/medusa.git")],
    });
    expect(markup).toContain("Repositories");
    expect(markup).toContain("medusadev → github.com/acme/medusa");
    expect(markup).not.toContain("mailpit");
  });

  it("offers mirroring a project's code from its page once it has a repository", () => {
    const environments = [environment("stage", "stage")];
    const mailpit = {
      name: "mailpit",
      mainHead: null,
      updatedAt: "2026-10-13T10:00:00Z",
      remote: null,
    };
    const onMirror = () => undefined;
    expect(render({ environments, repos: [], onMirror })).not.toContain("Mirror code");
    const markup = render({ environments, repos: [mailpit], onMirror });
    expect(markup).toContain("Repositories");
    expect(markup).toContain("Mirror code to GitHub or GitLab…");
  });

  it("draws every line's content", () => {
    const markup = render();

    expect(markup).toContain("stage");
    expect(markup).toContain("production");
    expect(markup).toContain("3f9c1b2");
  });

  // DESIGN §3.4, M7: a stop the grant withholds keeps its place in the list and nothing of its
  // project — neither its name, what it runs, nor a way into it.
  it("draws a stop the grant withholds as its tier and why", () => {
    const markup = render({
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

  describe("the Environments section", () => {
    const slots = (over: Partial<Parameters<typeof environmentSlots>[0]>) =>
      environmentSlots({
        environments: [],
        devstages: [],
        pending: [],
        halfMade: [],
        recipeTiers: ["stage", "production"],
        recipeRead: true,
        offered: { stage: true, production: true },
        productionRuns: "unknown",
        waiting: { count: 0, atLeast: false },
        mainHasCode: true,
        releaseOffered: false,
        releasing: undefined,
        ...over,
      });

    it("is not drawn before HQ's environments are read: nothing is known to be absent", () => {
      const markup = render({ environments: [], slots: [] });
      expect(markup).not.toContain("Environments");
      expect(markup).not.toContain("Not added");
    });

    it("is there with nothing added: two quiet slots, each with its Add", () => {
      const markup = render({ environments: [], slots: slots({}) });
      expect(markup).toContain("Environments");
      expect(markup).toContain("Add stage");
      expect(markup).toContain("Put it live");
    });

    // The project's card says production first, then each stage: its page's column the same.
    it("lists production before its stages, as the project's card does", () => {
      const markup = render({ environments: [], slots: slots({}) });
      expect(markup.indexOf("Put it live")).toBeLessThan(markup.indexOf("Add stage"));
    });

    it("offers no Add HQ does not offer, and says a tier waits for the recipe", () => {
      const markup = render({
        environments: [],
        slots: slots({ offered: { stage: false, production: false }, recipeTiers: ["stage"] }),
      });
      expect(markup).not.toContain("Add stage");
      expect(markup).toContain("Waiting for the Mate&#x27;s recipe");
    });

    describe("B: authoritative placement", () => {
      it("a Mate used as stage occupies the stage slot and explains who deploys it", () => {
        const devstages = devstagesOf("shop", [
          {
            id: "Ada",
            name: "Ada",
            status: "ACTIVE",
            hq: { appId: "shop", appName: "Shop", kind: "devstage", mate: { face: "" } },
          },
        ]);
        const markup = render({ environments: [], slots: slots({ devstages }) });
        expect(markup).toContain("Ada — deployed by its agent");
        expect(markup).not.toContain("Add stage");
        expect(markup).toContain("Put it live");
      });
    });

    it("says a Mate that is the stage is the stage, and asks no second one of the person", () => {
      const markup = render({
        environments: [],
        slots: slots({ devstages: [{ id: "dev", name: "Vera" }] }),
      });
      expect(markup).toContain("Vera — deployed by its agent");
      expect(markup).not.toContain("Add stage");
      expect(markup).toContain("Put it live");
    });

    it("says a production being created is being set up, and offers no second Add for it", () => {
      const markup = render({
        environments: [],
        slots: slots({ pending: [{ id: "p-new", tier: "production" }] }),
      });
      expect(markup).toContain("Setting up production…");
      expect(markup).not.toContain("Put it live");
    });

    it("says a half-made environment is unfinished, with Finish setup and no Add for its tier", () => {
      const markup = render({
        environments: [],
        slots: slots({ halfMade: [{ id: "p-half", tier: "production", finish: true }] }),
      });
      expect(markup).toContain("Setup isn&#x27;t finished");
      expect(markup).toContain("Finish setup");
      expect(markup).not.toContain("Put it live");
      expect(markup).not.toContain("Waiting for the Mate&#x27;s recipe");
    });

    it("says an empty production waits for its first release, with Review release where offered", () => {
      const prod = environment("prod", "production", "production");
      const markup = render({
        environments: [prod],
        slots: slots({
          environments: [{ id: "prod", tier: "production" }],
          recipeTiers: [],
          productionRuns: "empty",
          releaseOffered: true,
        }),
      });
      expect(markup).toContain("No release yet");
      expect(markup).not.toContain("Put it live");
    });
  });

  it("says an empty stage's first deploy on its line, as its cell does", () => {
    const empty = {
      ...environment("stage", "stage"),
      version: { ...environment("stage", "stage").version, label: undefined, commit: undefined },
    } as EnvironmentRow;
    const markup = render({
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
        { environments: [unnamed] },
        flowOf(new Map(deployment === undefined ? [] : [["stage", deployment]])),
      );
      const document = new Window().document;
      document.body.innerHTML = markup;
      const row = Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.startsWith("stage"),
      );
      expect(row?.textContent).toContain(expected);
    });
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
  readonly servicesRead?: boolean;
  readonly repository?: string | null;
  readonly deployment?: Shown<Deployment>;
  /** What the platform lists for each service; unread unless given. */
  readonly platform?: Shown<ReadonlyArray<StopService>>;
  readonly waiting?: ReadonlyArray<{ readonly sha?: string; readonly subject: string }>;
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
  /** The environment's vault beside its page. */
  readonly vault?: {
    readonly orgId: string;
    readonly open: boolean;
    readonly onToggle: () => void;
  };
  /** Who reaches the environment's project, as the page draws it. */
  readonly access?: React.ReactNode;
  /** The place's own name; its tier's unless given. */
  readonly name?: string;
  /** Where the place answers publicly. */
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  /** Every service the platform lists there, as the service map reads it. */
  readonly platformServices?: ReadonlyArray<ZeropsServiceRow>;
}

/** A stop's page with every read already done — the producers' words, the pane's drawing. */
function renderStop(input: StopCase): string {
  const name = input.name ?? (input.tier === "production" ? "production" : "stage");
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
    routes: input.routes ?? [],
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
    failed: input.failed === undefined ? [] : [input.failed],
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
      access={input.access}
      vault={input.vault}
      readAgain={input.readAgain}
      runAgain={
        input.failed?.mayRunAgain === true
          ? { running: false, refused: null, onRunAgain: () => {} }
          : undefined
      }
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
      repo={input.repository === null ? undefined : (input.repository ?? "appdev")}
      routes={input.routes ?? []}
      platformServices={input.platformServices}
      usageRead
      services={input.servicesRead === false ? undefined : rows}
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

it.each(["stage", "production"] as const)(
  "keeps unread %s services and their repository unknown rather than empty",
  (tier) => {
    const markup = renderStop({ tier, services: [], servicesRead: false, repository: null });
    expect(markup).toContain("Services aren");
    expect(markup).toContain("known yet");
    expect(markup).not.toContain("None yet");
    expect(markup).not.toContain("No repository is declared");
  },
);

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

/** A public address of `service`. */
const ROUTE = (service: string, host: string): ZeropsPublicRoute => ({
  service,
  port: 80,
  url: `https://${host}`,
  host,
});

/** A service as the service map reads it, its use known. */
const mapRow = (hostname: string, type: string, typeShort: string) =>
  ({
    isControlPlane: false,
    service: { hostname, serviceId: `svc-${hostname}`, type },
    typeShort,
    typeLabel: type,
    statusLabel: "Running",
    statusNeedsWord: false,
    dashboardUrl: `https://app.zerops.io/service-stack/svc-${hostname}`,
    metrics: [{ id: "cores", label: "CPU", value: "2", used: "0.08", fraction: 0.04 }],
  }) as unknown as ZeropsServiceRow;

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

  it("failed stage build says why and offers Run again", () => {
    const services = [
      {
        hostname: "web",
        repository: "web",
        deploy: {
          latest: deployRecord(fullSha("b2"), "failed", {
            service: "web",
            reason: "Storefront build failed",
          }),
          live: null,
        },
      },
    ];
    const rows = serviceRows({
      environment: "stage",
      services,
      platform: UNREAD,
      mainHead: undefined,
      routes: [],
      offers: [],
      nowMs: NOW,
      age: () => "1h ago",
    });
    const [failed] = stopFailedDeploys({ tier: "stage", rows, releases: [] });
    const document = new Window().document;
    document.body.innerHTML = renderStop({
      tier: "stage",
      services,
      ...(failed === undefined ? {} : { failed: { ...failed, mayRunAgain: true } }),
      mayDeployAgain: true,
    });
    const job = document.querySelector(
      '[data-zerops-surface="stop-service-job"][data-zerops-job-state="failed"]',
    );
    expect(job).not.toBeNull();
    expect(document.body.textContent).toContain("Storefront build failed");
    const retry = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Run again",
    );
    expect(retry).toBeDefined();
    expect(retry?.disabled).toBe(false);
  });

  it("an unresolved deploy stays on the service row without a deploy answer panel", () => {
    const document = new Window().document;
    document.body.innerHTML = renderStop({
      tier: "stage",
      services: [
        {
          hostname: "web",
          repository: "web",
          deploy: {
            latest: deployRecord(fullSha("b2"), "unresolved", {
              service: "web",
              reason: "HQ lost track of this deploy.",
            }),
            live: null,
          },
        },
      ],
      mayDeployAgain: true,
    });
    const job = document.querySelector(
      '[data-zerops-surface="stop-service-job"][data-zerops-job-state="unresolved"]',
    );
    expect(job?.textContent).toContain("HQ lost track of this deploy.");
    expect(job?.textContent).toContain("Check it in Zerops, or run it again.");
    expect(job?.textContent).toContain("Run again");
    expect(document.querySelector(".rv-where")).toBeNull();
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
    expect(offered).toContain("db · in its setup files, not in Zerops");
    expect(offered).toContain("Add db");
    const told = renderStop({ tier: "stage", services: TWO_LIVE, notInZerops: ["db"] });
    expect(told).toContain("db · in its setup files, not in Zerops");
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

describe("ZeropsStopPane — a stop the grant withholds", () => {
  const SHOWN = `/git?appId=shop&repo=appdev&rev=${fullSha("a1")}&view=commit`;
  it.each([
    ["a stop the grant shows opens each commit it ran in the Git browser", null, [SHOWN]],
    [
      "a stop the grant withholds names no commit and links none into the Git browser",
      CHECKING,
      [],
    ],
  ] as const)("%s", (_, withheld, links) => {
    const repository = stopRepository(withheld, { versionRepository: "appdev" });
    const markup = renderStop({
      tier: "stage",
      // The page lists no service of a withheld stop either.
      services: withheld === null ? [service("api", "a1", undefined)] : [],
      repository: repository ?? null,
      history: { kind: "read", commits: [hqCommit("a1", "Key the cache", "theo")], total: 1 },
    });
    const page = markupDom(markup);
    const hrefs = [...page.querySelectorAll("a")]
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("/git?"));
    expect(hrefs).toEqual(links);
    expect(page.body.textContent?.includes(fullSha("a1").slice(0, 7))).toBe(withheld === null);
  });
});

describe("ZeropsStopPane — the environment's vault", () => {
  const vaultToggle = (input: StopCase) => {
    const document = new Window().document;
    document.body.innerHTML = renderStop(input);
    return Array.from(document.querySelectorAll("button")).find(
      (entry) => entry.textContent === "Vault",
    );
  };
  it("offers its vault beside the page, pressed while it shows", () => {
    expect(
      vaultToggle({
        tier: "production",
        services: [],
        vault: { orgId: "org", open: false, onToggle: () => {} },
      })?.getAttribute("aria-pressed"),
    ).toBe("false");
  });
  it("offers no vault where the account's organization is not read", () => {
    expect(vaultToggle({ tier: "stage", services: [] })).toBeUndefined();
  });
});

describe("ZeropsStopPane", () => {
  it("Production shows the recorded release candidate subjects without inventing commit IDs.", () => {
    let markup = "";
    expect(() => {
      markup = renderStop({
        tier: "production",
        services: TWO_LIVE,
        offered: "v0.1.14",
        waiting: [{ subject: "Two-step checkout" }, { subject: "Fix VAT" }],
        notLive: { total: 10000, atLeast: true },
      });
    }).not.toThrow();
    const { document } = new Window();
    document.body.innerHTML = markup;
    expect(document.body.textContent).toContain("Waiting for release · 10000+");
    expect(document.body.textContent).toContain("Two-step checkout");
    expect(document.body.textContent).toContain("Fix VAT");
    expect(document.body.textContent).not.toContain("undefined");
  });
  it.each(["stage", "production"] as const)(
    "the %s environment's page shows who reaches its project, under its card",
    (tier) => {
      const markup = renderStop({ tier, services: [], access: <ul aria-label="Chips" /> });
      expect(markup).toContain("Project access");
      expect(markup).toContain('aria-label="Chips"');
      expect(renderStop({ tier, services: [] })).not.toContain("Project access");
    },
  );
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
        "Running · v0.1.13 · released",
        "· 2 services</span>",
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

  it("lists a place's platform services though it has no code service, never None yet under their count", () => {
    const document = new Window().document;
    document.body.innerHTML = renderStop({
      tier: "production",
      services: [],
      deployment: NONE,
      platformServices: [mapRow("db", "postgresql@17", "PostgreSQL 17")],
    });
    expect(document.body.textContent).toContain("Services · 1");
    expect(document.body.textContent).not.toContain("None yet");
    expect(
      [...document.querySelectorAll("[data-zerops-place-service]")].map((row) =>
        row.getAttribute("data-zerops-place-service"),
      ),
    ).toEqual(["db"]);
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

  it("a place's head names it, says what runs and links its primary address", () => {
    const document = new Window().document;
    document.body.innerHTML = renderStop({
      tier: "production",
      services: TWO_LIVE,
      releases: 2,
      routes: [ROUTE("api", "api-a1b2.prg1.zerops.app"), ROUTE("api", "teashop.example")],
    });
    expect(document.querySelector("h1")?.textContent).toBe("Production");
    expect(document.querySelector("h1")?.parentElement?.textContent).not.toContain("prod");
    expect(document.querySelector("[data-zerops-place-status]")?.textContent).toMatch(
      /^Running · v0\.1\.13 · released .+ · 2 services$/u,
    );
    expect(document.querySelector("[data-zerops-place-address]")?.getAttribute("href")).toBe(
      "https://teashop.example",
    );
    const trail = [...document.querySelectorAll('nav[aria-label="Zerops breadcrumb"] li')];
    expect(trail.map((step) => step.textContent)).toContain("Production");

    document.body.innerHTML = renderStop({ tier: "stage", name: "preview-eu", services: [] });
    expect(document.querySelector("h1")?.textContent).toBe("preview-eu");
    expect(document.querySelector("h1")?.parentElement?.textContent).toContain("stage");
  });

  it("a service without compute shows no meters", () => {
    const document = new Window().document;
    document.body.innerHTML = renderStop({
      tier: "production",
      services: TWO_LIVE,
      platformServices: [
        mapRow("api", "nodejs@22", "Node.js 22"),
        mapRow("db", "postgresql@17", "PostgreSQL 17"),
        mapRow("storage", "object-storage", "Object storage"),
      ],
    });
    const rows = [...document.querySelectorAll("[data-zerops-place-service]")];
    expect(
      rows.map((row) => [
        row.getAttribute("data-zerops-place-service"),
        row.querySelector("[data-zerops-place-meters]") !== null,
      ]),
    ).toEqual([
      ["api", true],
      ["web", false],
      ["db", true],
      ["storage", false],
    ]);
    expect(rows[3]?.textContent).toContain("Object storage");
    expect(document.body.textContent).toContain("Services · 4");
  });

  it("rollback is offered from the production page, never the project's road", () => {
    const menuItems = (markup: string) => {
      const document = new Window().document;
      document.body.innerHTML = markup;
      return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    };
    expect(
      menuItems(renderStop({ tier: "production", services: TWO_LIVE, releases: 2 })),
    ).toContain("Roll back to v0.1.12");
    expect(
      menuItems(renderStop({ tier: "stage", services: [service("api", "a1", undefined)] })).some(
        (item) => item?.startsWith("Roll back"),
      ),
    ).toBe(false);
  });

  it("writes no Deploys under a production and no Releases under a stage", () => {
    expect(renderStop({ tier: "production", services: TWO_LIVE, releases: 1 })).not.toContain(
      "Deploys",
    );
    expect(renderStop({ tier: "stage", services: [] })).not.toContain("Releases");
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

describe("environment route target dispatch", () => {
  it.each(["unknown", "empty", "git"] as const)(
    "The environment route resolves its target before observing a Zerops project.",
    (kind) => {
      const registry = AtomRegistry.make();
      const id = HqEnvironmentId.make("environment-without-project");
      const structure = {
        apps: [
          {
            id: "shop",
            name: "Shop",
            projects: [],
            environments:
              kind !== "git"
                ? []
                : [
                    {
                      id,
                      projectId: ProjectId.make("different-project-address"),
                      target: { kind: "git", branch: "main", delivery: "direct" },
                      tier: "production",
                      name: "Production",
                      sources: ["release"],
                      order: 1,
                      keyHeld: false,
                      keyInvalid: false,
                      can: {},
                      birth: null,
                      release: null,
                      jobs: [],
                    },
                  ],
          },
        ],
        ungrouped: [],
      } as CanonicalHqStructure;
      const { store, seed } = mountHqNavigation(
        registry,
        "org",
        kind === "unknown" ? {} : { structure },
      );
      const requests: string[] = [];
      const data = {
        data: store.data,
        orgId: "org",
        demandDetail: (demand) => {
          requests.push(demand.family);
          return () => {};
        },
      } satisfies Pick<AccountData, "data" | "orgId" | "demandDetail">;
      platform.routeWitness = true;
      platform.projectReads = [];
      let failure: unknown;
      let mounted: ReactTestRenderer | undefined;
      try {
        act(() => {
          mounted = create(
            <RegistryContext.Provider value={registry}>
              <AccountDataContext.Provider value={data as AccountData}>
                <InventoryContext.Provider value={EMPTY_ROUTE_INVENTORY}>
                  <ZeropsStopDetailPage groupId="shop" environmentId={id} />
                </InventoryContext.Provider>
              </AccountDataContext.Provider>
            </RegistryContext.Provider>,
          );
        });
      } catch (cause) {
        failure = cause;
      } finally {
        platform.routeWitness = false;
      }
      expect(platform.projectReads, "An environment's id never opens a Zerops project.").toEqual(
        [],
      );
      expect(requests.filter((family) => family !== "hqAppDetail")).toEqual([]);
      expect(failure).toBeUndefined();
      if (kind === "unknown") {
        act(() =>
          seed({
            structure: {
              ...structure,
              apps: [
                {
                  ...structure.apps[0]!,
                  environments: [
                    {
                      id,
                      target: { kind: "git", branch: "main", delivery: "direct" },
                      tier: "production",
                      name: "Late production",
                      sources: ["release"],
                      order: 1,
                      keyHeld: false,
                      keyInvalid: false,
                      can: {},
                      birth: null,
                      release: null,
                      jobs: [],
                    },
                  ],
                },
              ],
            },
          }),
        );
        expect(
          mounted!.root
            .findAllByType("h1")
            .flatMap((node) => node.children)
            .filter((text) => text === "Late production"),
        ).toEqual(["Late production"]);
        expect(platform.projectReads).toEqual([]);
        expect(requests.filter((family) => family !== "hqAppDetail")).toEqual([]);
      }
      act(() =>
        store.dispatch({
          kind: "stream",
          key: "hq:org",
          now: 0,
          event: { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "503" } },
        }),
      );
      act(() =>
        store.dispatch({
          kind: "stream",
          key: "hq:org",
          now: 5001,
          event: { kind: "grace-over", since: 0 },
        }),
      );
      expect(
        mounted!.root
          .findAll((node) => typeof node.type === "string")
          .flatMap((node) => node.children)
          .filter((text) => text === "HQ is not answering right now."),
      ).toEqual(["HQ is not answering right now."]);
      expect(platform.projectReads).toEqual([]);
      expect(requests.filter((family) => family !== "hqAppDetail")).toEqual([]);
      act(() => mounted?.unmount());
      registry.dispose();
    },
  );
});

it("Environment navigation keeps its identity when the target's project name changes.", () => {
  const id = HqEnvironmentId.make("stable-environment");
  const target = {
    kind: "zerops" as const,
    projectId: ProjectId.make("different-project-address"),
  };
  const open = (name: string) => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, "org", [
      { id: target.projectId, name: `Shop - ${name}`, status: "ACTIVE" },
    ]);
    mountHqNavigation(
      registry,
      "org",
      {
        structure: {
          ungrouped: [],
          apps: [
            {
              id: "shop",
              name: "Shop",
              projects: [],
              environments: [
                {
                  id,
                  target,
                  name: "Stage",
                  tier: "stage",
                  sources: ["main"],
                  order: 1,
                  keyHeld: false,
                  keyInvalid: false,
                  jobs: [],
                },
              ],
            },
          ],
        },
      },
      store,
    );
    const answer = registry.get(
      store.data.project(canonicalProjectFlow, {
        orgId: "org",
        appId: "shop",
        hqAddress: undefined,
        viewer: { id: "org", name: "Org", membershipId: "owner", roleCode: "OWNER" },
      }),
    );
    const row = answer!.environments[0]!;
    expect(row.name).toBe(name);
    expect(row.id).toBe("stable-environment");
    let mounted!: ReactTestRenderer;
    act(() => {
      mounted = create(
        <RegistryContext.Provider value={registry}>
          <ZeropsGroupPane
            groupId="shop"
            name="Shop"
            environments={[row]}
            slots={slotsOf([row])}
            history={null}
            repo={undefined}
            release={{
              offered: false,
              releasing: false,
              tag: undefined,
              reason: undefined,
              onReview: () => {},
            }}
            onFinish={() => {}}
            finishing={false}
            onAdd={() => {}}
            onSetUp={() => {}}
          />
        </RegistryContext.Provider>,
      );
    });
    const button = mounted.root
      .findAllByType("button")
      .find((node) => node.findAllByType("span").some((span) => span.children.includes(name)));
    expect(button).toBeDefined();
    act(() => button!.props.onClick());
    act(() => mounted.unmount());
    registry.dispose();
  };
  platform.navigation = [];
  open("Original project name");
  open("Renamed project name");
  expect(platform.navigation).toEqual([
    {
      to: "/group/$groupId/$projectId",
      params: { groupId: "shop", projectId: "stable-environment" },
    },
    {
      to: "/group/$groupId/$projectId",
      params: { groupId: "shop", projectId: "stable-environment" },
    },
  ]);
});

it("An environment page explains HQ's refusal in words without opening project readers.", () => {
  const registry = AtomRegistry.make();
  const { store } = mountHqNavigation(registry, "org", {
    structure: {
      apps: [
        { id: "shop", name: "Shop", projects: [], environments: { refused: "changes_not_seen" } },
      ],
      ungrouped: [],
    },
  });
  platform.routeWitness = true;
  platform.projectReads = [];
  try {
    const markup = renderToStaticMarkup(
      <RegistryContext.Provider value={registry}>
        <AccountDataContext.Provider
          value={
            { data: store.data, orgId: "org", demandDetail: () => () => {} } as Pick<
              AccountData,
              "data" | "orgId" | "demandDetail"
            > as AccountData
          }
        >
          <InventoryContext.Provider value={EMPTY_ROUTE_INVENTORY}>
            <ZeropsStopDetailPage groupId="shop" environmentId="stage" />
          </InventoryContext.Provider>
        </AccountDataContext.Provider>
      </RegistryContext.Provider>,
    );
    expect(markup).toContain(
      "You need more than Read access to one of this project&#x27;s Zerops projects to see its changes.",
    );
    expect(markup).not.toContain("changes_not_seen");
    expect(platform.projectReads).toEqual([]);
  } finally {
    platform.routeWitness = false;
    registry.dispose();
  }
});

const EMPTY_ROUTE_INVENTORY: Inventory = {
  projects: [],
  projectRefs: new Map(),
  authority: new Map(),
  lost: new Set(),
  deleted: [],
  isLoading: false,
  error: null,
};

it("a deleted production names its removal before opening runtime readers", () => {
  const registry = AtomRegistry.make();
  const store = mountRoster(registry, "org", [
    { id: "production-project", name: "Shop - Production", status: "ACTIVE" },
  ]);
  mountHqNavigation(
    registry,
    "org",
    {
      structure: {
        ungrouped: [],
        apps: [
          {
            id: "shop",
            name: "Shop",
            projects: [],
            environments: [
              {
                id: HqEnvironmentId.make("production-environment"),
                target: { kind: "zerops", projectId: ProjectId.make("production-project") },
                name: "Production",
                tier: "production",
                sources: ["release"],
                order: 1,
                keyHeld: true,
                keyInvalid: false,
                jobs: [],
              },
            ],
          },
        ],
      },
    },
    store,
  );
  store.dispatch({
    kind: "proven-deletion",
    family: "project",
    id: "production-project",
    evidence: "projectNotFound",
  });
  const inventory = inventoryContents.derive(readsOfState(store.state()), {
    organization: {
      kind: "organization",
      account: {
        apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
        accountId: ZeropsAccountId.make("account"),
      },
      organizationId: ZeropsOrganizationId.make("org"),
    },
    viewer: { id: "org", name: "Org", membershipId: "owner", roleCode: "OWNER" },
  });
  platform.routeWitness = true;
  platform.projectReads = [];
  try {
    let markup = "";
    expect(() => {
      markup = renderToStaticMarkup(
        <RegistryContext.Provider value={registry}>
          <AccountDataContext.Provider
            value={
              { data: store.data, orgId: "org", demandDetail: () => () => {} } as Pick<
                AccountData,
                "data" | "orgId" | "demandDetail"
              > as AccountData
            }
          >
            <InventoryContext.Provider value={inventory}>
              <ZeropsStopDetailPage groupId="shop" environmentId="production-environment" />
            </InventoryContext.Provider>
          </AccountDataContext.Provider>
        </RegistryContext.Provider>,
      );
    }).not.toThrow();
    expect(markup).toContain("Production was removed.");
    expect(markup).not.toContain("Stage was removed.");
    expect(markup).not.toContain("Your access to this project changed.");
    expect(platform.projectReads).toEqual([]);
  } finally {
    platform.routeWitness = false;
    registry.dispose();
  }
});

it.each(["empty", "refused"] as const)(
  "A placed stage keeps its runtime page while HQ has no environment row (%s).",
  (standing) => {
    const registry = AtomRegistry.make();
    const { store } = mountHqNavigation(registry, "org", {
      structure: {
        apps: [
          {
            id: "shop",
            name: "Shop",
            projects: [{ projectId: "placed-stage", name: "Stage", kind: "stage", mate: null }],
            environments: standing === "refused" ? { refused: "changes_not_seen" } : [],
          },
        ],
        ungrouped: [],
      },
    });
    const inventory: Inventory = {
      ...EMPTY_ROUTE_INVENTORY,
      projects: [
        {
          id: "placed-stage",
          name: "Shop - Stage",
          status: "ACTIVE",
          hq: { appId: "shop", appName: "Shop", kind: "stage", mate: null },
        },
      ],
    };
    platform.routeWitness = true;
    platform.projectReads = [];
    try {
      const markup = renderToStaticMarkup(
        <RegistryContext.Provider value={registry}>
          <AccountDataContext.Provider
            value={
              { data: store.data, orgId: "org", demandDetail: () => () => {} } as Pick<
                AccountData,
                "data" | "orgId" | "demandDetail"
              > as AccountData
            }
          >
            <InventoryContext.Provider value={inventory}>
              <ZeropsStopDetailPage groupId="shop" environmentId="placed-stage" />
            </InventoryContext.Provider>
          </AccountDataContext.Provider>
        </RegistryContext.Provider>,
      );
      expect(markup).toContain(">Stage</h1>");
      expect(markup).toContain("Environments");
      expect(markup).toContain("Checking what runs here");
      expect(markup).not.toContain("changes_not_seen");
      expect(platform.projectReads).toEqual([]);
    } finally {
      platform.routeWitness = false;
      registry.dispose();
    }
  },
);

it("A runtime stop opens its recorded environment identity and keeps an unrecorded project's bookmark.", () => {
  const stops = runtimeStopsOf(
    "shop",
    [
      {
        id: "project-stage",
        name: "Stage",
        status: "ACTIVE",
        hq: { appId: "shop", appName: "Shop", kind: "stage", mate: null },
      },
      {
        id: "unregistered-stage",
        name: "Unregistered",
        status: "ACTIVE",
        hq: { appId: "shop", appName: "Shop", kind: "stage", mate: null },
      },
    ],
    [
      {
        id: HqEnvironmentId.make("environment-stage"),
        target: { kind: "zerops", projectId: ProjectId.make("project-stage") },
        name: "Stage",
        tier: "stage",
      },
    ],
  );
  const opened: string[] = [];
  let mounted!: ReactTestRenderer;
  act(() => {
    mounted = create(
      <ZeropsRuntimeStops stops={stops} deployments={new Map()} onOpen={(id) => opened.push(id)} />,
    );
  });
  act(() => {
    for (const button of mounted.root.findAllByType("button")) button.props.onClick();
  });
  expect(opened).toEqual(["environment-stage", "unregistered-stage"]);
  act(() => mounted.unmount());
});
