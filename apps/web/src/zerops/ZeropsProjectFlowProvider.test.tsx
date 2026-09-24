import { flowVerbKey, GiteaApiError, type ZeropsProject } from "@t3tools/client-runtime/zerops";
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
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { bindAccountFlow } from "./accountForge";
import { HeldInventoryContext } from "./inventoryContext";
import { useZeropsProjectFlow, type ZeropsProjectFlowValue } from "./projectFlowContext";
import { MERGE_HEAD_MOVED, ZeropsProjectFlowProvider } from "./ZeropsProjectFlowProvider";

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

/**
 * What the verbs act on: the client they act as, and what each half answers for `g1` — `null`
 * leaves the half unread, as the tests above expect.
 */
const verbs = vi.hoisted(() => ({
  client: null as unknown,
  deploys: null as unknown,
  forge: {
    repositories: [],
    pullRequests: [],
    merged: [],
    released: { releases: [], tags: [] },
  } as unknown,
  invalidated: [] as Array<readonly [string, unknown]>,
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
/** The groups the account's Gitea registry lists. */
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
vi.mock("./useZeropsRegistry", () => ({
  useZeropsRegistry: () => ({ registry: { groups: registryGroups.groups } }),
}));
vi.mock("./useZeropsDeployedVersion", () => ({
  useZeropsDeployedVersionReader: () => async () => undefined,
}));
/** The groups the deploy half was last asked to read. */
const deployReads = vi.hoisted(() => ({
  groups: [] as ReadonlyArray<{
    readonly groupId: string;
    readonly projects: ReadonlyArray<{ readonly projectId: string }>;
  }>,
}));

vi.mock("./useZeropsGroupDeploys", () => ({
  useZeropsGroupDeploys: (input: { readonly groups: typeof deployReads.groups }) => {
    deployReads.groups = input.groups;
    return {
      deploys: verbs.deploys === null ? new Map() : new Map([["g1", verbs.deploys]]),
      failures: new Map(),
      invalidate: () => {},
    };
  },
}));
vi.mock("./useZeropsGroupForge", () => ({
  useZeropsGroupForge: () => ({
    forges: new Map([["g1", verbs.forge]]),
    failures: new Map(),
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
    verbs.deploys = null;
    verbs.invalidated = [];
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

  // DESIGN M7: withholding is not loss. A project the grant withholds alone leaves every shown
  // read, and its group's deploy read keeps it, so its tier is never offered as missing again.
  it("a project the grant withholds alone stays in its group's deploy read", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const held = {
      projects: [
        {
          id: "prod-1",
          clientId: "org-1",
          name: "harbor-prod",
          status: "ACTIVE",
          tagList: ["mate:g:g1", "mate:role:prod"],
        } as ZeropsProject,
      ],
      services: new Map(),
    };

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(
        createElement(
          HeldInventoryContext,
          { value: held },
          createElement(ZeropsProjectFlowProvider, null, null),
        ),
      );
    });

    expect(
      deployReads.groups.map(({ groupId, projects }) => [
        groupId,
        projects.map(({ projectId }) => projectId),
      ]),
    ).toEqual([["g1", ["prod-1"]]]);

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
      await seen.at(-1)?.mergePullRequest("harbor", { repository: "app", number: 7 });
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
      await seen.at(-1)?.mergePullRequest("harbor", { repository: "app", number: 7 });
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
    await act(async () => {
      await seen.at(-1)?.mergePullRequest("harbor", { repository: "app", number: 7 });
    });
    expect(seen.at(-1)?.trouble).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  describe("release", () => {
    const SHOWN = "a".repeat(40);
    const MOVED = "b".repeat(40);
    const MERGED = "2".repeat(40);

    /** A releasable group whose group repo `main` was at `SHOWN` when it was read. */
    async function mountReleasable() {
      gitea.readable = true;
      const tags: Array<{ tag: string; target: string; message?: string | undefined }> = [];
      verbs.client = {
        getBranch: async () => ({ name: "main", commit: { id: MOVED } }),
        createTag: async (_owner: string, _repo: string, input: (typeof tags)[number]) => {
          tags.push(input);
        },
      };
      verbs.deploys = {
        declarations: [],
        environments: [],
        pullRequests: [],
        missing: [],
        mainHeadRepositories: new Map([["app", "appdev"]]),
        mainHeads: new Map([["app", MERGED]]),
        groupHead: SHOWN,
        releaseContents: [],
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
      expect(seen.at(-1)?.flows.get("g1")?.release.gate).toEqual({ allowed: true });
      return { seen, tags, render, root };
    }

    it("one click creates one tag", async () => {
      const { seen, tags, root } = await mountReleasable();
      const value = seen.at(-1)!;
      await act(async () => {
        await Promise.all([value.release("g1"), value.release("g1")]);
      });
      expect(tags).toHaveLength(1);
      await act(async () => {
        root.unmount();
      });
    });

    it("the group is re-read right after a release tag is created, and Release waits for it", async () => {
      const { seen, render, root } = await mountReleasable();
      await act(async () => {
        await seen.at(-1)!.release("g1");
      });
      expect(verbs.invalidated).toEqual([["g1", { kind: "tags" }]]);
      // The tag is made; until the group's tags answer again Release stays pressed.
      expect(seen.at(-1)?.pending.has(flowVerbKey({ kind: "release", groupId: "g1" }))).toBe(true);
      verbs.forge = { ...(verbs.forge as object) };
      await render();
      expect(seen.at(-1)?.pending.has(flowVerbKey({ kind: "release", groupId: "g1" }))).toBe(false);
      await act(async () => {
        root.unmount();
      });
    });

    it("Release tags the sha the offer showed even after main moved", async () => {
      const { seen, tags, root } = await mountReleasable();
      await act(async () => {
        await seen.at(-1)!.release("g1");
      });
      expect(tags.map(({ target }) => target)).toEqual([SHOWN]);
      await act(async () => {
        root.unmount();
      });
    });
  });

  describe("merge", () => {
    async function mountMerging(merge: (head: string) => Promise<void>) {
      gitea.readable = true;
      verbs.client = {
        mergePullRequest: (_owner: string, _repo: string, _number: number, head: string) =>
          merge(head),
      };
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
        await seen
          .at(-1)
          ?.mergePullRequest("harbor", { repository: "app", number: 7, headSha: "c0ffee" });
      });
      await act(async () => {
        root.unmount();
      });
      return seen.at(-1);
    }

    it("merge sends the shown head", async () => {
      const heads: Array<string> = [];
      await mountMerging(async (head) => {
        heads.push(head);
      });
      expect(heads).toEqual(["c0ffee"]);
    });

    it.each([
      {
        name: "a head-out-of-date 409 reads as changed since opened",
        refusal: new GiteaApiError(
          "Gitea refused to merge the pull request.",
          409,
          "head out of date",
        ),
        trouble: MERGE_HEAD_MOVED,
      },
      {
        name: "any other 409 stays a refusal to retry",
        refusal: new GiteaApiError(
          "Gitea refused to merge the pull request. merge push out of date",
          409,
          "merge push out of date",
        ),
        trouble:
          "Gitea would not merge it: Gitea refused to merge the pull request. merge push out of date",
      },
    ])("$name", async ({ refusal, trouble }) => {
      const value = await mountMerging(async () => {
        throw refusal;
      });
      expect(value?.trouble).toBe(trouble);
    });
  });
});
