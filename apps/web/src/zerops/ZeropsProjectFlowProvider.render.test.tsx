import {
  flowVerbKey,
  RELEASE_CHECKING,
  type AppRecipe,
  type CompareRead,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  makeZeropsApiOrigin,
  projectKeyOf,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import type { Stops } from "@t3tools/client-runtime/zerops/account/runtime";
import type { StopService } from "@t3tools/client-runtime/zerops/flow";
import type { HqEnvironment } from "@t3tools/client-runtime/zerops/hq";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { Release } from "@t3tools/shared/hqRelease";
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { zeropsSessionAtom, type ZeropsSessionView } from "../state/zerops";
import { mountHqNavigation } from "./__fixtures__/hqNavigation";
import { bindAccountFlow } from "./accountForge";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { HeldInventoryContext } from "./inventoryContext";
import { useZeropsProjectFlow, type ZeropsProjectFlowValue } from "./projectFlowContext";
import { ZeropsProjectFlowProvider } from "./ZeropsProjectFlowProvider";

/** The account's authority as its inventory publishes it. */
const access = vi.hoisted(() => ({
  account: { kind: "authorized" } as
    | { readonly kind: "authorized" }
    | { readonly kind: "withheld"; readonly reason: "access-lapsed"; readonly cause: null },
}));

/**
 * What HQ last answered `g1`'s releases and repositories, why its last read failed, and which
 * applications a verb asked to be read again.
 */
const released = vi.hoisted(() => ({
  /** What each render asked releases to be read on, by application. */
  releases: [] as ReadonlyArray<Release>,
  repos: [] as ReadonlyArray<RepoListEntry>,
  failures: new Map<string, string>(),
}));

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: "signed-in",
    activeOrganization: { id: "org-1", roleCode: "OWNER" },
    client: {},
  }),
}));
/**
 * The account's projects the inventory holds, by project key as it keys them — none of them need be
 * in a group — the ones whose content it shows, and each one's authority by project key.
 */
const inventoryRefs = vi.hoisted(() => ({
  refs: new Map<string, ProjectRef>(),
  detail: new Set<string>(),
  projects: [] as ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly status: string;
  }>,
  authority: new Map<
    string,
    | { readonly kind: "authorized" }
    | { readonly kind: "withheld"; readonly reason: string; readonly cause: null }
  >(),
}));
/** The groups the account's registry lists, as HQ holds it. */
const registryGroups = vi.hoisted(() => ({
  groups: [{ groupId: "g1", slug: "harbor" }] as ReadonlyArray<{
    readonly groupId: string;
    readonly slug: string;
  }>,
}));

vi.mock("./accountEnvironments", () => ({ useDetailProjects: () => inventoryRefs.detail }));

vi.mock("./ZeropsInventoryProvider", () => ({
  useZeropsInventory: () => ({
    projects: inventoryRefs.projects,
    projectRefs: inventoryRefs.refs,
    authority: inventoryRefs.authority,
    account: access.account,
  }),
}));
vi.mock("./useNowMs", () => ({ useNowMs: () => 0 }));
/**
 * The organization's official HQ; what its stream says is each test's, and what it answers a
 * merge or a close (`answer`), with what it was asked.
 */
/** What HQ answers of the deploys a verb asked for. */
const DEPLOYS = {
  jobs: [
    {
      environment: "production",
      kind: "deploy",
      service: "app",
      sha: "f".repeat(40),
      job: "2",
      state: "building",
      processId: "process-2",
      behind: null,
      reason: null,
    },
  ],
  note: null,
} as const;

const hq = vi.hoisted(() => ({
  account: {
    hq: { kind: "official", projectId: "hq-project", address: "https://hq.example.test" },
  },
  asked: [] as Array<readonly [string, unknown, string?]>,
  answer: (): Promise<unknown> => Promise.resolve({}),
}));
vi.mock("./accountHq", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accountHq")>()),
  useAccountHq: () => hq.account,
  accountHqApi: () => ({
    mergeChange: (link: unknown, expectedHead: string) => {
      hq.asked.push(["merge", link, expectedHead]);
      return hq.answer();
    },
    closeChange: (link: unknown) => {
      hq.asked.push(["close", link]);
      return hq.answer();
    },
    redeploy: (appId: string, environment: string, deploy: unknown) => {
      hq.asked.push(["redeploy", { appId, environment, deploy }]);
      return hq.answer();
    },
    addService: (appId: string, environment: string, service: string) => {
      hq.asked.push(["add-service", { appId, environment, service }]);
      return hq.answer();
    },
    rollback: (appId: string, tag: string, request: unknown) => {
      hq.asked.push(["rollback", { appId, tag, request }]);
      return hq.answer();
    },
    release: (appId: string, request: unknown) => {
      hq.asked.push(["release", { appId, request }]);
      return hq.answer();
    },
  }),
}));
vi.mock("./useZeropsRegistry", () => ({
  useZeropsRegistry: () => ({ registry: { groups: registryGroups.groups } }),
}));
/** What each application's recipe on `main` offers, as HQ answered it. */
const recipes = vi.hoisted(() => ({ read: new Map<string, AppRecipe>() }));
vi.mock("./useZeropsAppRecipes", () => ({
  useZeropsAppRecipes: () => recipes.read,
}));
/** HQ's rule for this person releasing `g1`, in its words; `undefined` while it cannot be asked. */
const permission = vi.hoisted(() => ({
  gate: { allowed: true } as
    | { readonly allowed: true }
    | { readonly allowed: false; readonly reason: string }
    | undefined,
}));
vi.mock("./useChangeOffers", () => ({
  useReleasePermission: () => () => permission.gate,
}));
/**
 * What the account's stops state each service runs, by service id — answered only for a service the
 * provider asked about — and the services it asked about.
 */
const versions = vi.hoisted(() => ({
  stated: new Map<string, unknown>(),
  asked: [] as ReadonlyArray<{ readonly serviceId: string }>,
}));
vi.mock("./accountForge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accountForge")>()),
  useStatedVersions: (services: ReadonlyArray<{ readonly serviceId: string }>) => {
    versions.asked = services;
    return new Map(
      services.flatMap(({ serviceId }) =>
        versions.stated.has(serviceId) ? [[serviceId, versions.stated.get(serviceId)]] : [],
      ),
    );
  },
}));

/** What HQ compares for each read a release asks: the commits listed here, every time. */
const compares = vi.hoisted(() => ({
  commits: [] as ReadonlyArray<{ readonly sha: string; readonly subject: string }>,
  /** Every read asked of HQ, by application, as last asked. */
  asked: new Map<string, ReadonlyArray<CompareRead>>(),
}));
vi.mock("./useZeropsCompares", async () => {
  const { compareReadKey } = await import("@t3tools/client-runtime/zerops");
  return {
    useZeropsCompares: (asks: ReadonlyMap<string, ReadonlyArray<CompareRead>>) => {
      for (const [appId, reads] of asks) compares.asked.set(appId, reads);
      return new Map(
        [...asks].map(([appId, reads]) => [
          appId,
          {
            answers: new Map(
              reads.map((read) => [
                compareReadKey(read),
                {
                  base: read.query.base ?? null,
                  head: read.query.head,
                  commits: compares.commits.map((commit) => ({
                    ...commit,
                    authorName: "Juno",
                    at: "2026-10-02T09:00:00.000Z",
                    change: null,
                  })),
                  truncated: false,
                  total: compares.commits.length,
                },
              ]),
            ),
            failures: new Map(),
          },
        ]),
      );
    },
  };
});
vi.mock("./useZeropsAppReleases", () => ({
  useZeropsAppReleases: () => {
    return {
      releases: new Map([["g1", released.releases]]),
      repos: new Map([["g1", released.repos]]),
      failures: released.failures,
    };
  },
}));

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  readonly nodeName: string;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};

  constructor(
    name: string,
    readonly ownerDocument: TestNode | null = null,
    readonly nodeType = 1,
  ) {
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
  }

  set textContent(_value: string) {
    this.childNodes = [];
  }

  appendChild(child: TestNode) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  createElement(name: string) {
    return new TestNode(name, this);
  }

  get activeElement(): null {
    return null;
  }

  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
}

function installTestDom(): void {
  const document = new TestNode("#document", null, 9);
  const window = {
    document,
    HTMLIFrameElement: TestNode,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLIFrameElement", window.HTMLIFrameElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

/** An atom registry signed in to org-1, as HQ's atoms read it. */
function signedInAtoms() {
  const atoms = AtomRegistry.make();
  atoms.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: { organizationId: "org-1" },
  } as ZeropsSessionView);
  return atoms;
}

/** An environment of `g1` as HQ records it, with no deploy yet. */
function environment(projectId: string, tier: HqEnvironment["tier"]): HqEnvironment {
  return {
    projectId,
    tier,
    name: tier,
    sources: tier === "production" ? ["release"] : ["main"],
    order: 1,
    keyHeld: true,
    keyInvalid: false,
    jobs: [],
    release: null,
    birth: null,
  };
}

/** HQ's stream for org-1 telling `g1`'s environments. */
function structureWith(environments: ReadonlyArray<HqEnvironment>) {
  return {
    structure: {
      ungrouped: [],
      apps: [{ id: "g1", name: "Harbor", projects: [], environments }],
    },
  };
}

describe("ZeropsProjectFlowProvider", () => {
  afterEach(() => {
    access.account = { kind: "authorized" };
    inventoryRefs.refs = new Map();
    inventoryRefs.detail = new Set();
    inventoryRefs.projects = [];
    inventoryRefs.authority = new Map();
    registryGroups.groups = [{ groupId: "g1", slug: "harbor" }];
    recipes.read = new Map();
    released.releases = [];
    released.repos = [];
    released.failures = new Map();
    permission.gate = { allowed: true };
    compares.commits = [];
    compares.asked.clear();
    versions.stated = new Map();
    versions.asked = [];
    hq.asked = [];
    hq.answer = () => Promise.resolve({});
    vi.unstubAllGlobals();
  });

  // A stop needs no HQ group, but only active detail holds its activity receiver.
  // Previously read sidebar projects must release it too.
  it("loaded services read what runs without demanding unread sidebar projects", async () => {
    installTestDom();
    registryGroups.groups = [];
    const account = {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account"),
    };
    const loose: ProjectRef = {
      kind: "project",
      organization: {
        kind: "organization",
        account,
        organizationId: ZeropsOrganizationId.make("org-1"),
      },
      projectId: ZeropsProjectId.make("loose-1"),
    };
    const unread: ProjectRef = { ...loose, projectId: ZeropsProjectId.make("unread-1") };
    inventoryRefs.refs = new Map([
      [projectKeyOf(loose), loose],
      [projectKeyOf(unread), unread],
    ]);
    inventoryRefs.detail.add(loose.projectId);
    const running: Shown<ReadonlyArray<StopService>> = {
      state: "known",
      value: [
        {
          service: { kind: "service", project: loose, serviceId: ZeropsServiceId.make("app-id") },
          hostname: "app",
          deployment: {
            state: "known",
            value: {
              kind: "running",
              activatedAt: null,
              version: {
                name: "v1.0.0",
                commit: undefined,
                sha: undefined,
                taggedBy: undefined,
                label: "v1.0.0",
              },
            },
            asOf: { ordinal: 1, atMs: 0 },
            coverage: "complete",
            freshness: { kind: "live" },
          },
        },
      ],
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    // A stop reads what runs there as it is first demanded.
    const atoms = AtomRegistry.make();
    const none: ReadonlySet<string> = new Set();
    const demandedAtom = Atom.make({ ids: none });
    const demanded = {
      ids: () => [...atoms.get(demandedAtom).ids],
      move: (change: (held: Set<string>) => void) => {
        const held = new Set(atoms.get(demandedAtom).ids);
        change(held);
        atoms.set(demandedAtom, { ids: held });
      },
    };
    const stops: Stops = {
      again: () => undefined,
      demand: (project: ProjectRef) => {
        demanded.move((held) => held.add(project.projectId));
        return () => demanded.move((held) => held.delete(project.projectId));
      },
      services: (project: ProjectRef) =>
        Atom.make((get): Shown<ReadonlyArray<StopService>> =>
          get(demandedAtom).ids.has(project.projectId)
            ? running
            : { state: "unread", waitingFor: null },
        ),
      version: () => Atom.make<Shown<never>>({ state: "unread", waitingFor: null }),
      holdVersions: () => () => undefined,
      dispose: () => undefined,
    };
    const unbind = bindAccountFlow({ stops });
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsProjectFlowValue> = [];

    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(
        createElement(
          RegistryContext.Provider,
          { value: atoms },
          createElement(ZeropsProjectFlowProvider, null, createElement(Probe)),
        ),
      );
    });

    expect(demanded.ids()).toEqual(["loose-1"]);
    await vi.waitFor(() =>
      expect(seen.at(-1)?.deployments.get("loose-1")).toMatchObject({
        state: "known",
        value: { kind: "running", version: { label: "v1.0.0" } },
      }),
    );

    inventoryRefs.detail = new Set([unread.projectId]);
    await act(async () => {
      root.render(
        createElement(
          RegistryContext.Provider,
          { value: atoms },
          createElement(ZeropsProjectFlowProvider, null, createElement(Probe)),
        ),
      );
    });
    expect(demanded.ids()).toEqual([unread.projectId]);
    await act(async () => {
      root.unmount();
    });
    expect(demanded.ids()).toEqual([]);
    unbind();
  });

  // G6: a project whose denial is being confirmed, or that is not ACTIVE, holds nothing open — the
  // inventory demands none of it, and neither does its stop.
  it("a project refused to the account, or not active, demands nothing of what it runs", async () => {
    installTestDom();
    registryGroups.groups = [];
    const account = {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account"),
    };
    const ref = (projectId: string): ProjectRef => ({
      kind: "project",
      organization: {
        kind: "organization",
        account,
        organizationId: ZeropsOrganizationId.make("org-1"),
      },
      projectId: ZeropsProjectId.make(projectId),
    });
    inventoryRefs.refs = new Map(
      ["open-1", "denied-1", "stopped-1"].map((projectId) => [
        projectKeyOf(ref(projectId)),
        ref(projectId),
      ]),
    );
    inventoryRefs.detail = new Set(["open-1", "denied-1", "stopped-1"]);
    inventoryRefs.projects = [
      { id: "open-1", name: "Open", status: "ACTIVE" },
      { id: "stopped-1", name: "Stopped", status: "STOPPED" },
    ];
    inventoryRefs.authority = new Map([
      [projectKeyOf(ref("denied-1")), { kind: "withheld", reason: "access-denied", cause: null }],
    ]);
    const demanded = new Set<string>();
    const unbind = bindAccountFlow({
      stops: {
        again: () => undefined,
        demand: (project: ProjectRef) => {
          demanded.add(project.projectId);
          return () => demanded.delete(project.projectId);
        },
        services: () =>
          Atom.make<Shown<ReadonlyArray<StopService>>>({
            state: "unread",
            waitingFor: null,
          }),
        version: () => Atom.make<Shown<never>>({ state: "unread", waitingFor: null }),
        holdVersions: () => () => undefined,
        dispose: () => undefined,
      },
    });
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsProjectFlowValue> = [];

    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });

    expect([...demanded]).toEqual(["open-1"]);
    // Its stop still says why it shows nothing.
    expect(seen.at(-1)?.deployments.get("denied-1")).toEqual({
      state: "withheld",
      reason: "access-denied",
      cause: null,
    });

    await act(async () => {
      root.unmount();
    });
    unbind();
  });

  // DESIGN §3.1, §4.2 G12: the registry's groups and what was read of them are platform content.
  it("withholds the groups and their flows while the account's access lapses", async () => {
    access.account = { kind: "withheld", reason: "access-lapsed", cause: null };
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsProjectFlowValue> = [];

    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    expect(seen.at(-1)?.flows.size).toBe(0);

    access.account = { kind: "authorized" };
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    expect([...(seen.at(-1)?.flows.keys() ?? [])]).toEqual(["g1"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("says why HQ did not answer an application's releases and repositories, but not while access lapses", async () => {
    released.failures = new Map([["g1", "HQ is not answering right now."]]);
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsProjectFlowValue> = [];

    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    expect(seen.at(-1)?.releaseFailures.get("g1")).toBe("HQ is not answering right now.");

    access.account = { kind: "withheld", reason: "access-lapsed", cause: null };
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    expect(seen.at(-1)?.releaseFailures.size).toBe(0);

    await act(async () => {
      root.unmount();
    });
  });

  // DESIGN M7: withholding is not loss. A project the grant withholds alone keeps its stop, from
  // HQ's record, so its tier is never offered as missing again.
  it("a project the grant withholds alone keeps its stop, and its tier is not asked for", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const held = {
      projects: [
        {
          id: "prod-1",
          clientId: "org-1",
          name: "harbor-prod",
          status: "ACTIVE",
          hq: { appId: "g1", appName: "Harbor", kind: "production", mate: null },
        } as ZeropsProject,
      ],
    };
    recipes.read = new Map([
      [
        "g1",
        {
          tiers: ["stage", "production"],
          repositories: new Map([["app", "appdev"]]),
          productionRepositories: new Map(),
          declared: new Map(),
        },
      ],
    ]);
    const atoms = signedInAtoms();
    mountHqNavigation(atoms, "org-1", structureWith([environment("prod-1", "production")]));
    const seen: Array<ZeropsProjectFlowValue> = [];
    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(
        createElement(
          RegistryContext.Provider,
          { value: atoms },
          createElement(
            HeldInventoryContext,
            { value: held },
            createElement(ZeropsProjectFlowProvider, null, createElement(Probe)),
          ),
        ),
      );
    });

    const flow = seen.at(-1)?.flows.get("g1");
    expect(flow?.environments.map(({ projectId, name }) => [projectId, name])).toEqual([
      ["prod-1", "harbor-prod"],
    ]);
    expect(flow?.recipeRead).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  // The client opens no session with the old Gitea (T12): the flow names no sign-in there and no
  // Gitea org, whether or not the organization still has one.
  it("opens no Gitea session: the flow names no sign-in to Gitea and no Gitea org", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsProjectFlowValue> = [];

    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    expect([...(seen.at(-1)?.flows.keys() ?? [])]).toEqual(["g1"]);
    expect(seen.at(-1)).not.toHaveProperty("signInTrouble");
    expect(seen.at(-1)).not.toHaveProperty("slugs");

    await act(async () => {
      root.unmount();
    });
  });

  describe("release", () => {
    /** appdev's `main` as HQ listed it for B (t10, 2026-10-03). */
    const MERGED = "30f75f9839a1cd6bb87722284127d3de6672e441";
    const GROUP_MAIN = "b".repeat(40);
    const RELEASE = flowVerbKey({ kind: "release", groupId: "g1" });
    /** What HQ makes of the offer: the release it was named. */
    const MADE: Release = {
      tag: "v0.1.0",
      sha: GROUP_MAIN,
      entries: [{ service: "app", sha: MERGED }],
      by: "u1",
      at: "2026-10-02T10:00:00.000Z",
      state: "approved",
      reason: null,
      rollbackOf: null,
    };

    /**
     * A group whose production builds `app` from appdev, merged at MERGED and run nowhere yet, the
     * recipe at GROUP_MAIN; HQ compares one change to put live.
     */
    /** Production's one runtime, `app`, as the platform lists it. */
    const APP = { id: "s-app", name: "app", status: "ACTIVE", isSystem: false };
    /** The Zerops project production is. */
    const PRODUCTION: ProjectRef = {
      kind: "project",
      organization: {
        kind: "organization",
        account: {
          apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
          accountId: ZeropsAccountId.make("account"),
        },
        organizationId: ZeropsOrganizationId.make("org-1"),
      },
      projectId: ZeropsProjectId.make("prod-1"),
    };
    /** What the store states `app` runs: no version at all. */
    const RUNS_NOTHING = {
      state: "known",
      value: { activeId: null, source: null, name: null },
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    };

    async function mountRelease(
      services: ReadonlyArray<unknown> = [APP],
      stated: ReadonlyMap<string, unknown> = new Map([["s-app", RUNS_NOTHING]]),
    ) {
      versions.stated = new Map(stated);
      compares.commits = [{ sha: MERGED, subject: "Quicker gallery" }];
      recipes.read = new Map([
        [
          "g1",
          {
            tiers: ["production"],
            repositories: new Map([["app", "appdev"]]),
            productionRepositories: new Map([["app", "appdev"]]),
            declared: new Map([["production", ["app"]]]),
          },
        ],
      ]);
      released.repos = [
        { name: "appdev", mainHead: MERGED, updatedAt: "2026-10-02T09:00:00.000Z" },
        { name: "group", mainHead: GROUP_MAIN, updatedAt: "2026-10-02T09:00:00.000Z" },
      ];
      hq.answer = () => Promise.resolve({ made: MADE, deploys: DEPLOYS });
      installTestDom();
      const { createRoot } = await import("react-dom/client");
      const seen: Array<ZeropsProjectFlowValue> = [];
      function Probe() {
        seen.push(useZeropsProjectFlow());
        return null;
      }
      // Its production is the Zerops project prod-1, whose services are listed, and whose ref the
      // inventory holds under its project key, as it holds every ref.
      inventoryRefs.refs = new Map([[projectKeyOf(PRODUCTION), PRODUCTION]]);
      const held = {
        projects: [
          {
            id: "prod-1",
            clientId: "org-1",
            name: "harbor-prod",
            status: "ACTIVE",
            hq: { appId: "g1", appName: "Harbor", kind: "production", mate: null },
          } as ZeropsProject,
        ],
      };
      const atoms = signedInAtoms();
      // Its services, as the organization's services listing holds them.
      const roster = mountRoster(atoms, "org-1", held.projects, {
        services: services.map((service) => ({
          ...(service as object),
          projectId: "prod-1",
        })) as never,
      });
      mountHqNavigation(
        atoms,
        "org-1",
        structureWith([environment("prod-1", "production")]),
        roster,
      );
      const root = createRoot(document.createElement("div") as unknown as Element);
      const render = () =>
        act(async () => {
          root.render(
            createElement(
              RegistryContext.Provider,
              { value: atoms },
              createElement(
                HeldInventoryContext,
                { value: held as never },
                createElement(ZeropsProjectFlowProvider, null, createElement(Probe)),
              ),
            ),
          );
        });
      await render();
      return { seen, render, root };
    }

    // F10 (e2e, 2026-10-03): Bea's production, made by the import, runs its no-code version and HQ
    // recorded no deploy; main holds two changes. The release door never showed, and the client
    // never asked HQ to compare: the provider looked production's ref up by its bare id, where the
    // inventory keys every ref by its project key, so it asked the store about no service at all.
    it.each([
      {
        name: "the import's no-code version",
        runs: { activeId: "fJCalELVSOuR53ZwvjA1GA", source: "NONE", name: null },
      },
      { name: "nothing deployed at all", runs: { activeId: null, source: null, name: null } },
    ])("offers a first release over $name: the whole of main, compared", async ({ runs }) => {
      const { seen, root } = await mountRelease(
        [APP],
        new Map([["s-app", { ...RUNS_NOTHING, value: runs }]]),
      );
      expect(versions.asked).toEqual([
        { kind: "service", project: PRODUCTION, serviceId: "s-app" },
      ]);
      expect(compares.asked.get("g1")).toEqual([
        { repository: "appdev", query: { head: MERGED }, services: ["app"] },
      ]);
      const release = seen.at(-1)?.flows.get("g1")?.release;
      expect(release?.gate).toEqual({ allowed: true });
      expect(release?.untold).toEqual([]);
      expect(
        release?.contents.flatMap(({ commits }) => commits.map(({ subject }) => subject)),
      ).toEqual(["Quicker gallery"]);
      await act(async () => {
        root.unmount();
      });
    });

    it("offers what HQ compared it would put live", async () => {
      const { seen, root } = await mountRelease();
      expect(
        seen
          .at(-1)
          ?.flows.get("g1")
          ?.release.contents.flatMap(({ commits }) => commits.map(({ subject }) => subject)),
      ).toEqual(["Quicker gallery"]);
      await act(async () => {
        root.unmount();
      });
    });

    // A production service whose version the store has not stated yet would read as running
    // nothing, and its repository's whole history as going live.
    it("compares nothing while what a production service runs is not stated", async () => {
      const { seen, root } = await mountRelease([APP], new Map());
      const release = seen.at(-1)?.flows.get("g1")?.release;
      expect(release?.gate).toEqual({ allowed: false, reason: RELEASE_CHECKING });
      expect(release?.contents).toEqual([]);
      await act(async () => {
        root.unmount();
      });
    });

    // The tier names `app`, and the account does not list it in production: what it runs cannot
    // be told — never that it runs nothing, which would put its whole history live.
    it("names a runtime the account does not list as untold, and compares nothing for it", async () => {
      const { seen, root } = await mountRelease([]);
      const release = seen.at(-1)?.flows.get("g1")?.release;
      expect(release?.untold).toEqual(["app"]);
      expect(release?.contents).toEqual([]);
      await act(async () => {
        root.unmount();
      });
    });

    it("releases what its offer shows, held until the releases list what HQ made", async () => {
      const { seen, render, root } = await mountRelease();
      expect(seen.at(-1)?.flows.get("g1")?.release.gate).toEqual({ allowed: true });
      let outcome: unknown;
      await act(async () => {
        outcome = await seen.at(-1)!.release("g1");
      });
      expect(hq.asked).toEqual([
        [
          "release",
          {
            appId: "g1",
            request: {
              tag: "v0.1.0",
              groupHead: GROUP_MAIN,
              entries: [{ service: "app", sha: MERGED }],
            },
          },
        ],
      ]);
      // Beside the tag, where HQ answered the release's deploys stand.
      expect(outcome).toEqual({ ok: true, tag: "v0.1.0", deploys: DEPLOYS });
      expect(seen.at(-1)?.pending.has(RELEASE)).toBe(true);
      released.releases = [MADE];
      await render();
      expect(seen.at(-1)?.pending.has(RELEASE)).toBe(false);
      await act(async () => {
        root.unmount();
      });
    });

    it("sends the person's chosen tag to HQ with the offered heads and entries", async () => {
      const { seen, root } = await mountRelease();
      await act(async () => {
        await seen.at(-1)!.release("g1", "v1.0.0");
      });
      expect(hq.asked).toEqual([
        [
          "release",
          {
            appId: "g1",
            request: {
              tag: "v1.0.0",
              groupHead: GROUP_MAIN,
              entries: [{ service: "app", sha: MERGED }],
            },
          },
        ],
      ]);
      await act(async () => root.unmount());
    });

    it("refuses what its offer refuses, in HQ's words for who may, and asks HQ nothing", async () => {
      permission.gate = {
        allowed: false,
        reason: "You need at least Basic user access to this project's production to release it.",
      };
      const { seen, root } = await mountRelease();
      let outcome: unknown;
      await act(async () => {
        outcome = await seen.at(-1)!.release("g1");
      });
      expect(hq.asked).toEqual([]);
      expect(outcome).toEqual({
        ok: false,
        reason: "You need at least Basic user access to this project's production to release it.",
      });
      await act(async () => {
        root.unmount();
      });
    });

    it("says HQ's refusal in its words, where the verbs are, and holds nothing", async () => {
      const { seen, root } = await mountRelease();
      hq.answer = () =>
        Promise.reject(new Error("Main moved since you opened this. Review it again."));
      let outcome: unknown;
      await act(async () => {
        outcome = await seen.at(-1)!.release("g1");
      });
      expect(outcome).toEqual({
        ok: false,
        reason: "Main moved since you opened this. Review it again.",
      });
      expect(seen.at(-1)?.trouble).toBe("Main moved since you opened this. Review it again.");
      expect(seen.at(-1)?.pending.has(RELEASE)).toBe(false);
      await act(async () => {
        root.unmount();
      });
    });
  });

  describe("roll back", () => {
    const GROUP_MAIN = "b".repeat(40);
    const ROLL_BACK = flowVerbKey({ kind: "roll-back", groupId: "g1", tag: "v1.0.0" });
    /** What HQ makes of a rollback to v1.0.0: the next patch, listing its entries. */
    const MADE: Release = {
      tag: "v1.0.2",
      sha: GROUP_MAIN,
      entries: [{ service: "app", sha: "2".repeat(40) }],
      by: "u1",
      at: "2026-10-02T10:00:00.000Z",
      state: "approved",
      reason: null,
      rollbackOf: "v1.0.0",
    };

    /** A group whose recipe's `main` HQ last listed at GROUP_MAIN, or `null` for none. */
    async function mountRollBack(groupMain: string | null = GROUP_MAIN) {
      released.repos = [
        { name: "group", mainHead: groupMain, updatedAt: "2026-10-02T09:00:00.000Z" },
      ];
      hq.answer = () => Promise.resolve({ made: MADE, deploys: DEPLOYS });
      installTestDom();
      const { createRoot } = await import("react-dom/client");
      const seen: Array<ZeropsProjectFlowValue> = [];
      function Probe() {
        seen.push(useZeropsProjectFlow());
        return null;
      }
      const root = createRoot(document.createElement("div") as unknown as Element);
      const render = () =>
        act(async () => {
          root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
        });
      await render();
      return { seen, render, root };
    }

    it("asks HQ with the recipe's main as last read, and answers with the release it made", async () => {
      const { seen, root } = await mountRollBack();
      let outcome: unknown;
      await act(async () => {
        outcome = await seen.at(-1)!.rollBack("g1", "v1.0.0");
      });
      expect(hq.asked).toEqual([
        ["rollback", { appId: "g1", tag: "v1.0.0", request: { groupHead: GROUP_MAIN } }],
      ]);
      expect(outcome).toEqual({ ok: true, tag: "v1.0.2", deploys: DEPLOYS });
      expect(seen.at(-1)?.trouble).toBeNull();
      await act(async () => {
        root.unmount();
      });
    });

    it("Roll back waits for the stream to list the release", async () => {
      const { seen, render, root } = await mountRollBack();
      await act(async () => {
        await seen.at(-1)!.rollBack("g1", "v1.0.0");
      });
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(true);
      released.releases = [MADE];
      await render();
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(false);
      await act(async () => {
        root.unmount();
      });
    });

    it("a failed re-read of the releases does not leave Roll back pending", async () => {
      const { seen, render, root } = await mountRollBack();
      await act(async () => {
        await seen.at(-1)!.rollBack("g1", "v1.0.0");
      });
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(true);
      released.failures = new Map([["g1", "HQ is not answering right now."]]);
      await render();
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(false);
      // The failure clearing does not bring back a wait that already ended.
      released.failures = new Map();
      await render();
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(false);
      await act(async () => {
        root.unmount();
      });
    });

    // A clock is no answer: a second press while the first is not listed would roll back twice.
    it("stays pending while the releases have not listed it, however long that takes", async () => {
      vi.useFakeTimers();
      try {
        const { seen, root } = await mountRollBack();
        await act(async () => {
          await seen.at(-1)!.rollBack("g1", "v1.0.0");
        });
        await act(async () => {
          vi.advanceTimersByTime(60 * 60_000);
        });
        expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(true);
        await act(async () => {
          root.unmount();
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("says HQ's refusal in its words, where the verbs are, and holds nothing", async () => {
      const { seen, root } = await mountRollBack();
      hq.answer = () =>
        Promise.reject(new Error("Main moved since you opened this. Review it again."));
      let outcome: unknown;
      await act(async () => {
        outcome = await seen.at(-1)!.rollBack("g1", "v1.0.0");
      });
      expect(outcome).toEqual({
        ok: false,
        reason: "Main moved since you opened this. Review it again.",
      });
      expect(seen.at(-1)?.trouble).toBe("Main moved since you opened this. Review it again.");
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(false);
      await act(async () => {
        root.unmount();
      });
    });

    it("asks HQ nothing while the recipe has nothing on main to tag", async () => {
      const { seen, root } = await mountRollBack(null);
      let outcome: unknown;
      await act(async () => {
        outcome = await seen.at(-1)!.rollBack("g1", "v1.0.0");
      });
      expect(hq.asked).toEqual([]);
      expect(outcome).toEqual({
        ok: false,
        reason: "The project's recipe has nothing on main to tag yet.",
      });
      await act(async () => {
        root.unmount();
      });
    });
  });
});

describe("asking HQ to run a failed deploy again", () => {
  const FAILED_SHA = "f".repeat(40);
  const REDEPLOY = flowVerbKey({
    kind: "redeploy",
    groupId: "g1",
    projectId: "p-stage",
    service: "app",
  });
  /** HQ's job `id` of `app` at the failed commit, in `state`. */
  const job = (id: string, state: "failed" | "queued"): HqEnvironment["jobs"][number] => ({
    id,
    kind: "deploy",
    service: "app",
    sha: FAILED_SHA,
    state,
    cause: id === "1" ? "merge" : "run_again",
    ref: null,
    reason: null,
    appVersionId: null,
    processId: null,
    requestedBy: id === "1" ? null : "u-ada",
    at: "2026-10-02T10:00:00.000Z",
    endedAt: state === "failed" ? "2026-10-02T10:04:00.000Z" : null,
    supersededBy: null,
  });
  const FAILED = job("1", "failed");
  const stageWith = (...jobs: ReadonlyArray<HqEnvironment["jobs"][number]>): HqEnvironment => ({
    ...environment("p-stage", "stage"),
    jobs,
  });

  afterEach(() => {
    hq.asked = [];
    hq.answer = () => Promise.resolve({});
    vi.unstubAllGlobals();
  });

  /** The provider over HQ's stream recording the stage's newest deploy of `app` as failed. */
  async function mount() {
    const atoms = signedInAtoms();
    const navigation = mountHqNavigation(atoms, "org-1", structureWith([stageWith(FAILED)]));
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsProjectFlowValue> = [];
    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(
        createElement(
          RegistryContext.Provider,
          { value: atoms },
          createElement(ZeropsProjectFlowProvider, null, createElement(Probe)),
        ),
      );
    });
    const say = (...jobs: ReadonlyArray<HqEnvironment["jobs"][number]>) =>
      act(async () => {
        navigation.seed(structureWith([stageWith(...jobs)]));
      });
    const unmount = () =>
      act(async () => {
        root.unmount();
      });
    return { seen, say, unmount };
  }

  it("asks it by the environment's name, held until HQ's stream brings the job it asked for", async () => {
    hq.answer = () => Promise.resolve(DEPLOYS);
    const { seen, say, unmount } = await mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await seen
        .at(-1)!
        .redeploy("g1", "p-stage", { service: "app", sha: FAILED_SHA, after: "1" });
    });
    expect(outcome).toEqual({ ok: true, deploys: DEPLOYS });
    expect(hq.asked).toEqual([
      [
        "redeploy",
        { appId: "g1", environment: "stage", deploy: { service: "app", sha: FAILED_SHA } },
      ],
    ]);
    expect(seen.at(-1)?.pending.has(REDEPLOY)).toBe(true);
    // The stream again, its newest job still the one asked after: still under way.
    await say(FAILED);
    expect(seen.at(-1)?.pending.has(REDEPLOY)).toBe(true);
    await say(job("2", "queued"), FAILED);
    expect(seen.at(-1)?.pending.has(REDEPLOY)).toBe(false);
    await unmount();
  });

  // The deploy-jobs design: a service running what HQ did not deploy is asked HQ's live commit
  // again; its newest job went live, so only a newer one answers the ask.
  it("holds a deploy asked over a live job until a newer job is there", async () => {
    const live: HqEnvironment["jobs"][number] = {
      ...job("5", "queued"),
      state: "live",
      appVersionId: "av-hq",
      endedAt: "2026-10-02T10:04:00.000Z",
    };
    const { seen, say, unmount } = await mount();
    await say(live);
    await act(async () => {
      await seen.at(-1)!.redeploy("g1", "p-stage", { service: "app", sha: FAILED_SHA, after: "5" });
    });
    expect(seen.at(-1)?.pending.has(REDEPLOY)).toBe(true);
    await say(job("6", "queued"), live);
    expect(seen.at(-1)?.pending.has(REDEPLOY)).toBe(false);
    await unmount();
  });

  // Audit D2: a service the recipe declares and the project lacks, added by a person's ask.
  it("adds a service by the environment's name, answering its deploys", async () => {
    hq.answer = () => Promise.resolve(DEPLOYS);
    const { seen, unmount } = await mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await seen.at(-1)!.addService("g1", "p-stage", "cache");
    });
    expect(outcome).toEqual({ ok: true, deploys: DEPLOYS });
    expect(hq.asked).toEqual([
      ["add-service", { appId: "g1", environment: "stage", service: "cache" }],
    ]);
    await unmount();
  });

  it("hands HQ's refusal back in its words, and holds nothing", async () => {
    hq.answer = () => Promise.reject(new Error("A newer deploy took its place."));
    const { seen, unmount } = await mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await seen
        .at(-1)!
        .redeploy("g1", "p-stage", { service: "app", sha: FAILED_SHA, after: "1" });
    });
    expect(outcome).toEqual({ ok: false, reason: "A newer deploy took its place." });
    expect(seen.at(-1)?.pending.has(REDEPLOY)).toBe(false);
    await unmount();
  });
});
