import { flowVerbKey, type AppRecipe, type ZeropsProject } from "@t3tools/client-runtime/zerops";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  makeZeropsApiOrigin,
  projectKeyOf,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import type { DeploymentStore, StopService } from "@t3tools/client-runtime/zerops/flow";
import type { HqEnvironment } from "@t3tools/client-runtime/zerops/hq";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { changeUrl, type HqChange } from "@t3tools/shared/hqChanges";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  hqStructureAtom,
  zeropsSessionAtom,
  type HqStructureView,
  type ZeropsSessionView,
} from "../state/zerops";
import { bindAccountFlow } from "./accountForge";
import { HeldInventoryContext } from "./inventoryContext";
import { useZeropsProjectFlow, type ZeropsProjectFlowValue } from "./projectFlowContext";
import {
  HELD_VERB_MS,
  HQ_CHANGES_UNANSWERED,
  RELEASE_MOVES_TO_HQ,
  VERB_ALREADY_RUNNING,
  ZeropsProjectFlowProvider,
} from "./ZeropsProjectFlowProvider";

const GITEA = "https://gitea.example.test";

/**
 * The flows stand through a failed reacquire: signed in, and no token to act with until
 * `readable` turns; `trouble` is the cause the session names. `origin` is whether the account has
 * a Gitea at all.
 */
const gitea = vi.hoisted(() => ({
  readable: false,
  origin: true,
  trouble: null as string | null,
}));

/** The account's authority as its inventory publishes it. */
const access = vi.hoisted(() => ({
  account: { kind: "authorized" } as
    | { readonly kind: "authorized" }
    | { readonly kind: "withheld"; readonly reason: "access-lapsed"; readonly cause: null },
}));

/** What the verbs act on: the client they act as, and what the Gitea half answers for `g1`. */
const verbs = vi.hoisted(() => ({
  client: null as unknown,
  forge: { released: { releases: [], tags: [] } } as unknown,
  invalidated: [] as Array<readonly [string, unknown]>,
  forgeFailures: new Map<string, string>(),
}));

vi.mock("./accountGiteaSessions", () => ({
  useGiteaSession: () => ({ signedIn: true, readable: gitea.readable, trouble: gitea.trouble }),
  giteaClientFor: () => verbs.client,
}));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: "signed-in",
    activeOrganization: { id: "org-1", roleCode: "OWNER" },
    client: {},
  }),
}));
/**
 * The account's projects the inventory holds, by id — none of them need be in a group — the ones
 * whose content it shows, and each one's authority by project key.
 */
const inventoryRefs = vi.hoisted(() => ({
  refs: new Map<string, ProjectRef>(),
  projects: [] as ReadonlyArray<{ readonly id: string; readonly status: string }>,
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

vi.mock("./ZeropsInventoryProvider", () => ({
  useZeropsInventory: () => ({
    projects: inventoryRefs.projects,
    services: new Map(),
    projectRefs: inventoryRefs.refs,
    authority: inventoryRefs.authority,
    account: access.account,
  }),
}));
vi.mock("./useNowMs", () => ({ useNowMs: () => 0 }));
vi.mock("./giteaProject", () => ({
  useAccountGitea: () =>
    gitea.origin
      ? {
          projectId: "gitea-project",
          state: { url: GITEA, brokerUrl: "https://broker.example.test" },
        }
      : undefined,
}));
/**
 * The organization's official HQ; what its stream says is each test's, and what it answers a
 * merge or a close (`answer`), with what it was asked.
 */
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
vi.mock("./useZeropsGroupForge", () => ({
  useZeropsGroupForge: () => ({
    forges: new Map([["g1", verbs.forge]]),
    failures: verbs.forgeFailures,
    invalidate: (groupId: string, scope: unknown) => {
      verbs.invalidated.push([groupId, scope]);
    },
  }),
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
    deploys: [],
  };
}

/** HQ's stream for org-1 telling `g1`'s environments. */
function structureWith(environments: ReadonlyArray<HqEnvironment>): HqStructureView {
  return {
    organizationId: "org-1",
    structure: {
      ungrouped: [],
      apps: [{ id: "g1", name: "Harbor", projects: [], environments }],
    },
    changes: null,
    readAt: 1,
    current: true,
    unavailableSince: null,
  };
}

describe("ZeropsProjectFlowProvider", () => {
  afterEach(() => {
    gitea.readable = false;
    gitea.origin = true;
    gitea.trouble = null;
    access.account = { kind: "authorized" };
    inventoryRefs.refs = new Map();
    inventoryRefs.projects = [];
    inventoryRefs.authority = new Map();
    registryGroups.groups = [{ groupId: "g1", slug: "harbor" }];
    verbs.client = null;
    verbs.invalidated = [];
    recipes.read = new Map();
    verbs.forgeFailures = new Map();
    verbs.forge = { released: { releases: [], tags: [] } };
    vi.unstubAllGlobals();
  });

  // DESIGN §4.7, D6: what a stop runs needs no Gitea, and every project the sidebar draws is a stop
  // — one tagged into no registered group, or in none at all, reads what it runs all the same.
  it("every project the account holds reads what it runs, with no group registered", async () => {
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
    inventoryRefs.refs = new Map([["loose-1", loose]]);
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
    // The store publishes a stop as it is first demanded.
    const demanded = new Set<string>();
    const listeners = new Set<(project: ProjectRef) => void>();
    const deployments = {
      demand: (project: ProjectRef) => {
        demanded.add(project.projectId);
        for (const listener of listeners) listener(project);
        return () => demanded.delete(project.projectId);
      },
      stop: (project: ProjectRef) =>
        demanded.has(project.projectId) ? running : { state: "unread", waitingFor: null },
      shows: () => false,
      subscribe: (listener: (project: ProjectRef) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      invalidate: () => undefined,
      dispose: () => undefined,
    } as DeploymentStore;
    const unbind = bindAccountFlow({
      forge: null,
      deployments,
      services: { serviceOf: () => null },
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

    expect([...demanded]).toEqual(["loose-1"]);
    // The store's publication reaches React in the next task.
    await vi.waitFor(() =>
      expect(seen.at(-1)?.deployments.get("loose-1")).toMatchObject({
        state: "known",
        value: { kind: "running", version: { label: "v1.0.0" } },
      }),
    );

    await act(async () => {
      root.unmount();
    });
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
      ["open-1", "denied-1", "stopped-1"].map((projectId) => [projectId, ref(projectId)]),
    );
    inventoryRefs.projects = [
      { id: "open-1", status: "ACTIVE" },
      { id: "stopped-1", status: "STOPPED" },
    ];
    inventoryRefs.authority = new Map([
      [projectKeyOf(ref("denied-1")), { kind: "withheld", reason: "access-denied", cause: null }],
    ]);
    const demanded = new Set<string>();
    const unbind = bindAccountFlow({
      forge: null,
      deployments: {
        demand: (project: ProjectRef) => {
          demanded.add(project.projectId);
          return () => demanded.delete(project.projectId);
        },
        stop: () => ({ state: "unread", waitingFor: null }),
        shows: () => false,
        subscribe: () => () => undefined,
        invalidate: () => undefined,
        dispose: () => undefined,
      } as DeploymentStore,
      services: { serviceOf: () => null },
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
    expect(seen.at(-1)?.slugs.size).toBe(0);

    access.account = { kind: "authorized" };
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    expect([...(seen.at(-1)?.flows.keys() ?? [])]).toEqual(["g1"]);
    expect([...(seen.at(-1)?.slugs.keys() ?? [])]).toEqual(["g1"]);

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
      services: new Map(),
    };
    recipes.read = new Map([
      [
        "g1",
        {
          tiers: ["stage", "production"],
          repositories: new Map([["app", "appdev"]]),
          productionRepositories: new Map(),
        },
      ],
    ]);
    const atoms = signedInAtoms();
    atoms.set(hqStructureAtom, structureWith([environment("prod-1", "production")]));
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
    expect(flow?.missing.map(({ tier }) => tier)).toEqual(["stage"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("a Gitea that stops answering keeps the flows and names the cause where the verbs are", async () => {
    gitea.trouble = "Gitea isn't answering.";
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
    expect(seen.at(-1)?.trouble).toBe("Gitea isn't answering.");

    await act(async () => {
      root.unmount();
    });
  });

  it("a verb pressed while no Gitea token is held says why nothing happened", async () => {
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
    expect(seen.at(-1)?.readable).toBe(false);
    expect(seen.at(-1)?.trouble).toBeNull();

    await act(async () => {
      await seen.at(-1)?.rollBack("g1", "v1.0.0");
    });
    expect(seen.at(-1)?.trouble).toBe("Signing in to Gitea again. Try it again in a moment.");

    await act(async () => {
      root.unmount();
    });
  });

  it("stops saying it is signing in again once the token is back", async () => {
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
    await act(async () => {
      await seen.at(-1)?.rollBack("g1", "v1.0.0");
    });
    expect(seen.at(-1)?.trouble).toBe("Signing in to Gitea again. Try it again in a moment.");

    gitea.readable = true;
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    expect(seen.at(-1)?.trouble).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("a verb pressed with no Gitea on the account claims no sign-in", async () => {
    gitea.origin = false;
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
    // The group's flow stands, so the press reaches the client it would act as.
    expect(seen.at(-1)?.flows.has("g1")).toBe(true);
    await act(async () => {
      await seen.at(-1)?.rollBack("g1", "v1.0.0");
    });
    expect(seen.at(-1)?.trouble).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("refuses a release: its offer moves to HQ next", async () => {
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
    expect(seen.at(-1)?.flows.get("g1")?.release.gate).toEqual({
      allowed: false,
      reason: RELEASE_MOVES_TO_HQ,
    });
    let outcome: unknown;
    await act(async () => {
      outcome = await seen.at(-1)?.release("g1");
    });
    expect(outcome).toEqual({ ok: false, reason: RELEASE_MOVES_TO_HQ });
    await act(async () => {
      root.unmount();
    });
  });

  describe("roll back", () => {
    const MOVED = "b".repeat(40);
    const MERGED = "2".repeat(40);
    const ROLL_BACK = flowVerbKey({ kind: "roll-back", groupId: "g1", tag: "v1.0.0" });

    /** A group whose group repo `main` is at `MOVED` at the press, and whose `v1.0.0` lists MERGED. */
    async function mountRollBack() {
      gitea.readable = true;
      const tags: Array<{ tag: string; target: string; message?: string | undefined }> = [];
      verbs.client = {
        getBranch: async () => ({ name: "main", commit: { id: MOVED } }),
        listTags: async () => [{ name: "v1.0.0", message: `app ${MERGED}` }],
        createTag: async (_owner: string, _repo: string, input: (typeof tags)[number]) => {
          tags.push(input);
        },
      };
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
      return { seen, tags, render, root };
    }

    it("tags main as read at the press, and answers with the tag it made", async () => {
      const { seen, tags, root } = await mountRollBack();
      let outcome: unknown;
      await act(async () => {
        outcome = await seen.at(-1)!.rollBack("g1", "v1.0.0");
      });
      expect(tags.map(({ target }) => target)).toEqual([MOVED]);
      expect(outcome).toEqual({ ok: true, tag: tags[0]?.tag });
      expect(seen.at(-1)?.trouble).toBeNull();
      await act(async () => {
        root.unmount();
      });
    });

    it("the group's tags are re-read right after the tag is made, and Roll back waits for them", async () => {
      const { seen, render, root } = await mountRollBack();
      await act(async () => {
        await seen.at(-1)!.rollBack("g1", "v1.0.0");
      });
      expect(verbs.invalidated).toEqual([["g1", { kind: "tags" }]]);
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(true);
      verbs.forge = { ...(verbs.forge as object) };
      await render();
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(false);
      await act(async () => {
        root.unmount();
      });
    });

    it("a failed re-read after the tag does not leave Roll back pending", async () => {
      const { seen, render, root } = await mountRollBack();
      await act(async () => {
        await seen.at(-1)!.rollBack("g1", "v1.0.0");
      });
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(true);
      // The re-read the tag asked for fails: the forge answer stays the one the tag was made against.
      verbs.forgeFailures = new Map([["g1", "Gitea did not answer"]]);
      await render();
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(false);
      // The failure clearing does not bring back a wait that already ended.
      verbs.forgeFailures = new Map();
      await render();
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(false);
      await act(async () => {
        root.unmount();
      });
    });

    it("keeps waiting when the group's tags answer again while the tag is being made", async () => {
      const { seen, render, root } = await mountRollBack();
      let finish = () => {};
      const client = verbs.client as Record<string, unknown>;
      verbs.client = {
        ...client,
        createTag: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      };
      let pressed: Promise<unknown> = Promise.resolve();
      await act(async () => {
        pressed = seen.at(-1)!.rollBack("g1", "v1.0.0");
      });
      // A pass that started before the tag existed answers while it is being made.
      verbs.forge = { ...(verbs.forge as object) };
      await render();
      await act(async () => {
        finish();
        await pressed;
      });
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(true);
      verbs.forge = { ...(verbs.forge as object) };
      await render();
      expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(false);
      await act(async () => {
        root.unmount();
      });
    });

    it("stops being pending once the forge has not answered again in time", async () => {
      vi.useFakeTimers();
      try {
        const { seen, root } = await mountRollBack();
        await act(async () => {
          await seen.at(-1)!.rollBack("g1", "v1.0.0");
        });
        await act(async () => {
          vi.advanceTimersByTime(HELD_VERB_MS - 1);
        });
        expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(true);
        await act(async () => {
          vi.advanceTimersByTime(1);
        });
        expect(seen.at(-1)?.pending.has(ROLL_BACK)).toBe(false);
        await act(async () => {
          root.unmount();
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("a Mate's changes in a project's flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** `app#n` of `g1` as HQ's stream says it. */
  const change = (over: Partial<HqChange> = {}): HqChange => ({
    appId: "g1",
    repo: "app",
    number: 7,
    mateProjectId: "mate-1",
    title: "Add a /status page",
    body: "",
    state: "open",
    head: "c0ffee",
    mergedSha: null,
    landedHead: null,
    openedAt: "2026-10-02T09:00:00.000Z",
    mergedAt: null,
    closedAt: null,
    updatedAt: "2026-10-02T09:00:00.000Z",
    mergeability: "clean",
    behind: false,
    ...over,
  });

  /** The flow of `g1` while HQ's stream for org-1 says `view`. */
  async function flowOf(view: HqStructureView) {
    const atoms = AtomRegistry.make();
    atoms.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-1" },
    } as ZeropsSessionView);
    atoms.set(hqStructureAtom, view);
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
    await act(async () => {
      root.unmount();
    });
    return seen.at(-1)?.flows.get("g1");
  }

  const view = (over: Partial<HqStructureView>): HqStructureView => ({
    organizationId: "org-1",
    structure: null,
    changes: null,
    readAt: null,
    current: true,
    unavailableSince: null,
    ...over,
  });

  it("come down HQ's stream: the open ones a push reached, and the merged, linked at HQ", async () => {
    const flow = await flowOf(
      view({
        changes: new Map([
          [
            "g1",
            [
              change(),
              change({ number: 8, head: null }),
              change({
                number: 6,
                state: "merged",
                mergedSha: "d00d",
                mergedAt: "2026-10-02T08:00:00.000Z",
              }),
            ],
          ],
        ]),
      }),
    );
    expect(flow?.changesKnown).toBe(true);
    expect(flow?.pullRequests.map((pull) => pull.url)).toEqual([
      changeUrl("https://hq.example.test", "g1", "app", 7),
    ]);
    expect(flow?.merged.map((pull) => pull.number)).toEqual([6]);
  });

  it("are not known, and say why, while HQ has never told them and does not answer", async () => {
    const flow = await flowOf(view({ current: false, unavailableSince: 1 }));
    expect(flow?.changesKnown).toBe(false);
    expect(flow?.changesFailure).toBe(HQ_CHANGES_UNANSWERED);
  });
});

describe("merging and closing a change in HQ", () => {
  const HEAD = "c0ffee";
  const open = (number: number): HqChange => ({
    appId: "g1",
    repo: "app",
    number,
    mateProjectId: "mate-1",
    title: "Add a /status page",
    body: "",
    state: "open",
    head: HEAD,
    mergedSha: null,
    landedHead: null,
    openedAt: "2026-10-02T09:00:00.000Z",
    mergedAt: null,
    closedAt: null,
    updatedAt: "2026-10-02T09:00:00.000Z",
    mergeability: "clean",
    behind: false,
  });
  const streamed = (changes: ReadonlyArray<HqChange>): HqStructureView => ({
    organizationId: "org-1",
    structure: null,
    changes: new Map([["g1", changes]]),
    readAt: 1,
    current: true,
    unavailableSince: null,
  });
  const MERGE = flowVerbKey({ kind: "merge", groupId: "g1", repository: "app", number: 7 });
  const CLOSE = flowVerbKey({ kind: "close", groupId: "g1", repository: "app", number: 7 });
  const CHANGE = { repository: "app", number: 7 } as const;

  afterEach(() => {
    hq.asked = [];
    hq.answer = () => Promise.resolve({});
    vi.unstubAllGlobals();
  });

  /** The provider over HQ's stream saying `#7` is open; `say` moves what the stream says. */
  async function mount() {
    const atoms = AtomRegistry.make();
    atoms.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-1" },
    } as ZeropsSessionView);
    atoms.set(hqStructureAtom, streamed([open(7)]));
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
    const say = (changes: ReadonlyArray<HqChange>) =>
      act(async () => {
        atoms.set(hqStructureAtom, streamed(changes));
      });
    const unmount = () =>
      act(async () => {
        root.unmount();
      });
    return { seen, say, unmount };
  }

  it("merges with the head its review showed, held until HQ's stream brings it merged", async () => {
    const { seen, say, unmount } = await mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await seen.at(-1)!.merge("g1", CHANGE, HEAD);
    });
    expect(outcome).toEqual({ ok: true });
    expect(hq.asked).toEqual([["merge", { appId: "g1", repo: "app", number: 7 }, HEAD]]);
    // Nothing is read again: the change comes back down the stream.
    expect(verbs.invalidated).toEqual([]);
    expect(seen.at(-1)?.pending.has(MERGE)).toBe(true);
    await say([
      { ...open(7), state: "merged", mergedSha: "d00d", mergedAt: "2026-10-02T10:00:00Z" },
    ]);
    expect(seen.at(-1)?.pending.has(MERGE)).toBe(false);
    await unmount();
  });

  it("closes a change, held until HQ's stream brings it closed", async () => {
    const { seen, say, unmount } = await mount();
    await act(async () => {
      await seen.at(-1)!.close("g1", CHANGE);
    });
    expect(hq.asked).toEqual([["close", { appId: "g1", repo: "app", number: 7 }]]);
    expect(seen.at(-1)?.pending.has(CLOSE)).toBe(true);
    await say([{ ...open(7), state: "closed", closedAt: "2026-10-02T10:00:00Z" }]);
    expect(seen.at(-1)?.pending.has(CLOSE)).toBe(false);
    await unmount();
  });

  it("hands HQ's refusal back in its words, and holds nothing", async () => {
    hq.answer = () =>
      Promise.reject(new Error("Its Mate pushed to it since you opened it. Review it again."));
    const { seen, unmount } = await mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await seen.at(-1)!.merge("g1", CHANGE, HEAD);
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "Its Mate pushed to it since you opened it. Review it again.",
    });
    expect(seen.at(-1)?.pending.has(MERGE)).toBe(false);
    await unmount();
  });

  // Main A04: a head nobody was shown is never merged; HQ is not asked.
  it("asks HQ nothing for a change whose head was never shown", async () => {
    const { seen, unmount } = await mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await seen.at(-1)!.merge("g1", CHANGE, undefined);
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "Its Mate pushed to it since you opened it. Review it again.",
    });
    expect(hq.asked).toEqual([]);
    await unmount();
  });

  it("takes one press of a merge while it runs", async () => {
    let finish = () => {};
    hq.answer = () =>
      new Promise((resolve) => {
        finish = () => resolve({});
      });
    const { seen, unmount } = await mount();
    let second: unknown;
    await act(async () => {
      const first = seen.at(-1)!.merge("g1", CHANGE, HEAD);
      second = await seen.at(-1)!.merge("g1", CHANGE, HEAD);
      finish();
      await first;
    });
    expect(hq.asked).toHaveLength(1);
    expect(second).toEqual({ ok: false, reason: VERB_ALREADY_RUNNING });
    await unmount();
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
  const record = (state: "failed" | "pending"): HqEnvironment["deploys"][number]["latest"] => ({
    sha: FAILED_SHA,
    state,
    failure: state === "failed" ? "job" : null,
    message: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: "2026-10-02T10:00:00.000Z",
  });
  const stageWith = (state: "failed" | "pending"): HqEnvironment => ({
    ...environment("p-stage", "stage"),
    deploys: [{ service: "app", latest: record(state), live: null }],
  });

  afterEach(() => {
    hq.asked = [];
    hq.answer = () => Promise.resolve({});
    vi.unstubAllGlobals();
  });

  /** The provider over HQ's stream recording the stage's newest deploy of `app` as failed. */
  async function mount() {
    const atoms = signedInAtoms();
    atoms.set(hqStructureAtom, structureWith([stageWith("failed")]));
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
    const say = (state: "failed" | "pending") =>
      act(async () => {
        atoms.set(hqStructureAtom, structureWith([stageWith(state)]));
      });
    const unmount = () =>
      act(async () => {
        root.unmount();
      });
    return { seen, say, unmount };
  }

  it("asks it by the environment's name, held until HQ's stream no longer records it failed", async () => {
    const { seen, say, unmount } = await mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await seen.at(-1)!.redeploy("g1", "p-stage", { service: "app", sha: FAILED_SHA });
    });
    expect(outcome).toEqual({ ok: true });
    expect(hq.asked).toEqual([
      [
        "redeploy",
        { appId: "g1", environment: "stage", deploy: { service: "app", sha: FAILED_SHA } },
      ],
    ]);
    expect(seen.at(-1)?.pending.has(REDEPLOY)).toBe(true);
    await say("pending");
    expect(seen.at(-1)?.pending.has(REDEPLOY)).toBe(false);
    await unmount();
  });

  it("hands HQ's refusal back in its words, and holds nothing", async () => {
    hq.answer = () => Promise.reject(new Error("A newer deploy took its place."));
    const { seen, unmount } = await mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await seen.at(-1)!.redeploy("g1", "p-stage", { service: "app", sha: FAILED_SHA });
    });
    expect(outcome).toEqual({ ok: false, reason: "A newer deploy took its place." });
    expect(seen.at(-1)?.pending.has(REDEPLOY)).toBe(false);
    await unmount();
  });
});
