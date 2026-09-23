import type { AccountForge } from "@t3tools/client-runtime/zerops/account/runtime";
import type { ProjectRef, ServiceRef } from "@t3tools/client-runtime/zerops/data";
import type {
  Deployment,
  DeploymentStore,
  FlowCommands,
  GroupFlow,
  StopService,
} from "@t3tools/client-runtime/zerops/flow";
import type { ForgeFact, ForgeStore, GiteaSessions } from "@t3tools/client-runtime/zerops/forge";
import type { Known, Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { GitCheckoutState } from "@t3tools/client-runtime/zerops";
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
  let stopDemandCalls = 0;
  const stops = new Map<string, Shown<ReadonlyArray<StopService>>>();
  const deployments = {
    stop: (project: ProjectRef) =>
      stops.get(project.projectId) ?? { state: "unread", waitingFor: null },
    demand: (project: ProjectRef) => {
      stopDemandCalls += 1;
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
    stopDemandCalls: () => stopDemandCalls,
    hold: (fact: ForgeFact, shown: Shown<unknown>) => {
      held.set(JSON.stringify(fact), shown);
      publish();
    },
    holdStop: (projectId: string, shown: Shown<ReadonlyArray<StopService>>) => {
      stops.set(projectId, shown);
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

  it("a checkout's push re-reads its repository, and a status not heard yet is no push", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useCheckoutPushes } = await import("./accountForge");
    const { useEffect } = await import("react");
    const repository = { origin: GITEA, owner: "harbor", repo: "appdev" };
    const checkout = (aheadCount: number): GitCheckoutState => ({
      repository: "appdev",
      isRepo: true,
      hasRemote: true,
      headRef: "mate/ada",
      aheadCount,
      behindCount: 0,
      hasUpstream: true,
      changed: [],
    });
    /** Every status the probe has handed on, so each step waits for its own. */
    const seen: Array<GitCheckoutState | null> = [];

    function Probe({ status }: { readonly status: GitCheckoutState | null }) {
      useCheckoutPushes(status, repository);
      useEffect(() => {
        seen.push(status);
      }, [status]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const hear = async (status: GitCheckoutState | null) => {
      const count = seen.length;
      root.render(<Probe status={status} />);
      await vi.waitFor(() => expect(seen.length).toBe(count + 1));
    };
    try {
      // Before the checkout answers, and on its first answer, nothing was pushed.
      await hear(null);
      await hear(checkout(2));
      // A refetch that clears the status for a moment is not a push either.
      await hear(null);
      await hear(checkout(2));
      expect(invalidated).toEqual([]);

      await hear(checkout(0));
      expect(invalidated).toEqual([{ topic: "forge-repo", ...repository }]);
    } finally {
      root.unmount();
    }
  });

  it("the stop rows read what each stop deploys from the account's store while they are shown", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { bindAccountFlow, useStopDeployments } = await import("./accountForge");
    const rig = stage();
    const unbind = bindAccountFlow(rig.stage);
    const deploying: Deployment = {
      kind: "deploying",
      version: {
        name: undefined,
        commit: "3f9c1b2",
        sha: "3f9c1b2".padEnd(40, "0"),
        taggedBy: undefined,
        label: "3f9c1b2",
      },
      previous: null,
    };
    /** Every answer the rows rendered, the latest last. */
    const answers: Array<ReadonlyMap<string, Shown<Deployment>>> = [];
    const latest = () => answers.at(-1)?.get("p-stage");

    function Rows({ stops }: { readonly stops: ReadonlyArray<ProjectRef> }) {
      answers.push(useStopDeployments(stops));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      root.render(<Rows stops={[PROJECT]} />);
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-stage"]));
      expect(latest()?.state).toBe("unread");
      // A surface that draws the same stops again in a new array keeps what it demanded.
      const rendered = answers.length;
      root.render(<Rows stops={[PROJECT]} />);
      await vi.waitFor(() => expect(answers.length).toBeGreaterThan(rendered));
      expect(rig.stopDemandCalls()).toBe(1);

      rig.holdStop(
        "p-stage",
        known([{ service: APPSTAGE, hostname: "appstage", deployment: known(deploying) }]),
      );
      await vi.waitFor(() =>
        expect(latest()).toMatchObject({ state: "known", value: { kind: "deploying" } }),
      );
    } finally {
      root.unmount();
      await nextMacrotask();
      unbind();
    }
    expect(rig.stopDemands).toEqual([]);
  });

  it("a stop joining or leaving the rows keeps every other stop's demand", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { bindAccountFlow, useStopDeployments } = await import("./accountForge");
    const rig = stage();
    const unbind = bindAccountFlow(rig.stage);
    const production = { ...PROJECT, projectId: "p-prod" } as ProjectRef;

    function Rows({ stops }: { readonly stops: ReadonlyArray<ProjectRef> }) {
      useStopDeployments(stops);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      root.render(<Rows stops={[PROJECT]} />);
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-stage"]));
      root.render(<Rows stops={[PROJECT, production]} />);
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-stage", "p-prod"]));
      expect(rig.stopDemandCalls()).toBe(2);
      root.render(<Rows stops={[production]} />);
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-prod"]));
      expect(rig.stopDemandCalls()).toBe(2);
    } finally {
      root.unmount();
      await nextMacrotask();
      unbind();
    }
    expect(rig.stopDemands).toEqual([]);
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
