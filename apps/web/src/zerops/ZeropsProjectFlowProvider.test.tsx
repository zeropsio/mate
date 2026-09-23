import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  makeZeropsApiOrigin,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import type { DeploymentStore, StopService } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { bindAccountFlow } from "./accountForge";
import { HeldInventoryContext } from "./inventoryContext";
import { useZeropsProjectFlow, type ZeropsProjectFlowValue } from "./projectFlowContext";
import { ZeropsProjectFlowProvider } from "./ZeropsProjectFlowProvider";

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

vi.mock("./accountGiteaSessions", () => ({
  useGiteaSession: () => ({ signedIn: true, readable: gitea.readable, trouble: gitea.trouble }),
  giteaClientFor: () => null,
}));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: "signed-in",
    activeOrganization: { id: "org-1", roleCode: "OWNER" },
    client: {},
  }),
}));
/** The account's projects the inventory holds, by id; none of them need be in a group. */
const inventoryRefs = vi.hoisted(() => ({ refs: new Map<string, ProjectRef>() }));
/** The groups the account's Gitea registry lists. */
const registryGroups = vi.hoisted(() => ({
  groups: [{ groupId: "g1", slug: "harbor" }] as ReadonlyArray<{
    readonly groupId: string;
    readonly slug: string;
  }>,
}));

vi.mock("./ZeropsInventoryProvider", () => ({
  useZeropsInventory: () => ({
    projects: [],
    services: new Map(),
    projectRefs: inventoryRefs.refs,
    authority: new Map(),
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
    return { deploys: new Map(), failures: new Map(), invalidate: () => {} };
  },
}));
vi.mock("./useZeropsGroupForge", () => ({
  useZeropsGroupForge: () => ({
    forges: new Map([
      [
        "g1",
        {
          repositories: [],
          pullRequests: [],
          merged: [],
          released: { releases: [], tags: [] },
        },
      ],
    ]),
    failures: new Map(),
    invalidate: () => {},
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
    registryGroups.groups = [{ groupId: "g1", slug: "harbor" }];
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
});
