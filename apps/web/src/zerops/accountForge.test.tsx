import type { AccountForge } from "@t3tools/client-runtime/zerops/account/runtime";
import type { ProjectRef, ServiceRef } from "@t3tools/client-runtime/zerops/data";
import type { DeploymentStore, FlowCommands, GroupFlow } from "@t3tools/client-runtime/zerops/flow";
import type { ForgeFact, ForgeStore, GiteaSessions } from "@t3tools/client-runtime/zerops/forge";
import type { Known, Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { ZeropsStateEnvelope } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";

const invalidated = vi.hoisted(() => [] as Array<unknown>);
vi.mock("./accountInvalidations", () => ({
  invalidateZerops: (invalidation: unknown) => {
    invalidated.push(invalidation);
  },
}));

const GITEA = "https://gitea.example";
const PROJECT: ProjectRef = {
  kind: "project",
  organization: {
    kind: "organization",
    account: { apiOrigin: "https://api.example", accountId: "account-1" },
    organizationId: "org-1",
  },
  projectId: "p-stage",
} as unknown as ProjectRef;
const APPSTAGE = { kind: "service", project: PROJECT, serviceId: "s-app" } as ServiceRef;

const known = <T,>(value: T): Known<T> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 1 },
  coverage: "complete",
  freshness: { kind: "live" },
});

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  return document;
}

const nextMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A post-grant stage whose forge answers what the test holds, recording every demand. */
function stage() {
  const held = new Map<string, Shown<unknown>>();
  const demanded = new Map<string, number>();
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const store = {
    read: (fact: ForgeFact) =>
      held.get(JSON.stringify(fact)) ?? { state: "unread", waitingFor: null },
    mergeState: () => ({ state: "unread", waitingFor: null }),
    demand: (fact: ForgeFact) => {
      const key = JSON.stringify(fact);
      demanded.set(key, (demanded.get(key) ?? 0) + 1);
      return () => demanded.set(key, (demanded.get(key) ?? 0) - 1);
    },
    subscribe,
  } as unknown as ForgeStore;
  const sessions = { subscribe, close: vi.fn() } as unknown as GiteaSessions;
  const stopDemands: Array<string> = [];
  const deployments = {
    stop: () => ({ state: "unread", waitingFor: null }),
    demand: (project: ProjectRef) => {
      stopDemands.push(project.projectId);
      return () => stopDemands.splice(stopDemands.indexOf(project.projectId), 1);
    },
    subscribe,
  } as unknown as DeploymentStore;
  const forge: AccountForge = {
    sessions,
    store,
    commands: { subscribe } as unknown as FlowCommands,
  };
  return {
    stage: {
      forge,
      deployments,
      services: {
        serviceOf: (projectId: string, hostname: string) =>
          projectId === "p-stage" && hostname === "appstage" ? APPSTAGE : null,
      },
    },
    sessions,
    /** The facts demanded now. */
    demanded: () =>
      [...demanded]
        .filter(([, leases]) => leases > 0)
        .map(([key]) => (JSON.parse(key) as ForgeFact).kind),
    stopDemands,
    hold: (fact: ForgeFact, shown: Shown<unknown>) => {
      held.set(JSON.stringify(fact), shown);
      publish();
    },
  };
}

afterEach(async () => {
  const { closeAccountLifetime } = await import("./accountLifetime");
  closeAccountLifetime();
  invalidated.length = 0;
  vi.unstubAllGlobals();
});

describe("the account's project flow in the web", () => {
  it("a Mate's envelope that moved on asks the bound account to re-read what it made old", async () => {
    const { bindAccountFlow, lifecycleEnvelopeChanged } = await import("./accountForge");
    const envelope = (success: boolean) =>
      ({
        phase: "develop-active",
        environment: "container",
        project: { id: "p-stage", name: "harbor stage" },
        services: [],
        workSession: {
          intent: "ship",
          services: ["appstage"],
          createdAt: "2026-09-23T09:00:00Z",
          deploys: { appstage: success ? [{ at: "t1", success, iteration: 1 }] : [] },
        },
        generated: "2026-09-23T10:00:00Z",
      }) as ZeropsStateEnvelope;

    // Nothing is bound before the epoch's first grant: nobody resolves the hostname.
    lifecycleEnvelopeChanged(envelope(false), envelope(true));
    expect(invalidated).toEqual([]);

    const unbind = bindAccountFlow(stage().stage);
    lifecycleEnvelopeChanged(envelope(false), envelope(true));
    expect(invalidated).toEqual([{ topic: "deployment", service: APPSTAGE }]);
    unbind();
  });

  it("closing the account lifetime unbinds the flow and forgets its Gitea tokens at once", async () => {
    const { openAccountLifetime, closeAccountLifetime } = await import("./accountLifetime");
    const { bindAccountFlow } = await import("./accountForge");
    const { accountGiteaSessions } = await import("./accountGiteaSessions");
    openAccountLifetime("person-a");
    const rig = stage();
    bindAccountFlow(rig.stage);
    expect(accountGiteaSessions()).toBe(rig.sessions);

    closeAccountLifetime();

    expect(accountGiteaSessions()).toBeNull();
    expect(rig.sessions.close).toHaveBeenCalledTimes(1);
  });

  it("a group's flow demands what it reads as it learns more, and lets it all go at unmount", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { bindAccountFlow, useGroupFlow } = await import("./accountForge");
    const rig = stage();
    const unbind = bindAccountFlow(rig.stage);
    const source = {
      entry: { groupId: "g1", slug: "harbor", projects: [], matesMayRelease: false },
      giteaOrigin: GITEA,
      members: known([{ projectId: "p-stage", name: "harbor stage", project: PROJECT }]),
      mayRelease: true,
    };
    /** Every flow the surface rendered, the latest last. */
    const flows: Array<GroupFlow> = [];
    const flow = () => flows.at(-1);

    function Surface() {
      flows.push(useGroupFlow(source));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      root.render(<Surface />);
      await vi.waitFor(() => expect(rig.demanded()).toEqual(["repos", "declarations", "tags"]));
      expect(rig.stopDemands).toEqual(["p-stage"]);
      expect(flow()?.pullRequests.state).toBe("unread");

      rig.hold({ kind: "repos", origin: GITEA, org: "harbor" }, known([{ name: "appdev" }]));
      await vi.waitFor(() => expect(rig.demanded()).toContain("open-pulls"));
      rig.hold({ kind: "open-pulls", origin: GITEA, owner: "harbor", repo: "appdev" }, known([]));
      await vi.waitFor(() => expect(flow()?.pullRequests.state).toBe("known"));
    } finally {
      root.unmount();
      await nextMacrotask();
      unbind();
    }
    expect(rig.demanded()).toEqual([]);
    expect(rig.stopDemands).toEqual([]);
  });
});
