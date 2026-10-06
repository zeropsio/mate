import type {
  ProjectRef,
  ServiceRef,
  ZeropsServiceDeployedVersion,
} from "@t3tools/client-runtime/zerops/data";
import { RegistryContext } from "@effect/atom-react";
import type { Stops } from "@t3tools/client-runtime/zerops/account/runtime";
import type { Deployment, StopService } from "@t3tools/client-runtime/zerops/flow";
import type { Known, Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";

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

/** A post-grant stage whose stops answer what the test holds, recording every demand. */
function stage() {
  const registry = AtomRegistry.make();
  const stopDemands: Array<string> = [];
  let stopDemandCalls = 0;
  let agains = 0;
  const atoms = new Map<string, Atom.Writable<Shown<ReadonlyArray<StopService>>>>();
  const atomOf = (projectId: string) => {
    let atom = atoms.get(projectId);
    if (atom === undefined) {
      atom = Atom.make<Shown<ReadonlyArray<StopService>>>({ state: "unread", waitingFor: null });
      atoms.set(projectId, atom);
    }
    return atom;
  };
  const versionAtoms = new Map<string, Atom.Writable<Shown<ZeropsServiceDeployedVersion>>>();
  const versionOf = (serviceId: string) => {
    let atom = versionAtoms.get(serviceId);
    if (atom === undefined) {
      atom = Atom.make<Shown<ZeropsServiceDeployedVersion>>({ state: "unread", waitingFor: null });
      versionAtoms.set(serviceId, atom);
    }
    return atom;
  };
  const stops = {
    services: (project: ProjectRef) => atomOf(project.projectId),
    version: (service: ServiceRef) => versionOf(service.serviceId),
    demand: (project: ProjectRef) => {
      stopDemandCalls += 1;
      stopDemands.push(project.projectId);
      return () => stopDemands.splice(stopDemands.indexOf(project.projectId), 1);
    },
    again: () => {
      agains += 1;
    },
    dispose: () => undefined,
  } satisfies Stops;
  return {
    stage: { stops },
    stopDemands,
    stopDemandCalls: () => stopDemandCalls,
    agains: () => agains,
    /** Renders under the registry the stops publish to. */
    wrap: (node: ReactNode) => (
      <RegistryContext.Provider value={registry}>{node}</RegistryContext.Provider>
    ),
    holdStop: (projectId: string, shown: Shown<ReadonlyArray<StopService>>) => {
      registry.set(atomOf(projectId), shown);
    },
    holdVersion: (serviceId: string, shown: Shown<ZeropsServiceDeployedVersion>) => {
      registry.set(versionOf(serviceId), shown);
    },
  };
}

afterEach(async () => {
  const { closeAccountLifetime } = await import("./accountLifetime");
  closeAccountLifetime();
  vi.unstubAllGlobals();
});

describe("the account's project flow in the web", () => {
  it("closing the account lifetime unbinds the stops at once", async () => {
    const { openAccountLifetime, closeAccountLifetime } = await import("./accountLifetime");
    const { againStopDeployment, bindAccountFlow } = await import("./accountForge");
    openAccountLifetime("person-a");
    const rig = stage();
    bindAccountFlow(rig.stage);
    againStopDeployment(PROJECT);
    expect(rig.agains()).toBe(1);

    closeAccountLifetime();

    againStopDeployment(PROJECT);
    expect(rig.agains()).toBe(1);
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
      root.render(rig.wrap(<Rows stops={[PROJECT]} />));
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-stage"]));
      expect(latest()?.state).toBe("unread");
      // A surface that draws the same stops again in a new array keeps what it demanded.
      const rendered = answers.length;
      root.render(rig.wrap(<Rows stops={[PROJECT]} />));
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

  it("the stop rows answer one snapshot per store version, and a new one once the store moves", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { bindAccountFlow, useStopDeployments } = await import("./accountForge");
    const rig = stage();
    const unbind = bindAccountFlow(rig.stage);
    const answers: Array<ReadonlyMap<string, Shown<Deployment>>> = [];

    function Rows({ stops }: { readonly stops: ReadonlyArray<ProjectRef> }) {
      answers.push(useStopDeployments(stops));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      root.render(rig.wrap(<Rows stops={[PROJECT]} />));
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-stage"]));
      const before = answers.at(-1);
      const rendered = answers.length;
      // The same stops in a new array, with the store unmoved, are the same snapshot.
      root.render(rig.wrap(<Rows stops={[PROJECT]} />));
      await vi.waitFor(() => expect(answers.length).toBeGreaterThan(rendered));
      expect(answers.at(-1)).toBe(before);

      // The store moving re-renders the rows with what it answers now, the stops unchanged.
      rig.holdStop("p-stage", known([]));
      await vi.waitFor(() => expect(answers.at(-1)).not.toBe(before));
      expect(answers.at(-1)?.get("p-stage")?.state).not.toBe("unread");
    } finally {
      root.unmount();
      await nextMacrotask();
      unbind();
    }
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
      root.render(rig.wrap(<Rows stops={[PROJECT]} />));
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-stage"]));
      root.render(rig.wrap(<Rows stops={[PROJECT, production]} />));
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-stage", "p-prod"]));
      expect(rig.stopDemandCalls()).toBe(2);
      root.render(rig.wrap(<Rows stops={[production]} />));
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-prod"]));
      expect(rig.stopDemandCalls()).toBe(2);
    } finally {
      root.unmount();
      await nextMacrotask();
      unbind();
    }
    expect(rig.stopDemands).toEqual([]);
  });

  it("a stop's page reads each of its services and what it runs, demanded while it is drawn", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { bindAccountFlow, useStopServices } = await import("./accountForge");
    const rig = stage();
    const unbind = bindAccountFlow(rig.stage);
    const services: ReadonlyArray<StopService> = [
      {
        service: APPSTAGE,
        hostname: "appstage",
        deployment: { state: "unread", waitingFor: null },
      },
    ];
    const answers: Array<Shown<ReadonlyArray<StopService>>> = [];

    function Page({ project }: { readonly project: ProjectRef | null }) {
      answers.push(useStopServices(project));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      root.render(rig.wrap(<Page project={PROJECT} />));
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-stage"]));
      rig.holdStop("p-stage", known(services));
      await vi.waitFor(() =>
        expect(answers.at(-1)).toMatchObject({ state: "known", value: services }),
      );
    } finally {
      root.unmount();
      await nextMacrotask();
      unbind();
    }
  });

  it("a stop's page answers one snapshot per store version, and a new one once the store moves", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { bindAccountFlow, useStopServices } = await import("./accountForge");
    const rig = stage();
    const unbind = bindAccountFlow(rig.stage);
    const answers: Array<Shown<ReadonlyArray<StopService>>> = [];

    function Page({ project }: { readonly project: ProjectRef }) {
      answers.push(useStopServices(project));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      root.render(rig.wrap(<Page project={PROJECT} />));
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-stage"]));
      const before = answers.at(-1);
      const rendered = answers.length;
      // The same stop as a new object, with the store unmoved, is the same snapshot.
      root.render(rig.wrap(<Page project={{ ...PROJECT }} />));
      await vi.waitFor(() => expect(answers.length).toBeGreaterThan(rendered));
      expect(answers.at(-1)).toBe(before);
      expect(rig.stopDemandCalls()).toBe(1);

      rig.holdStop("p-stage", known([]));
      await vi.waitFor(() => expect(answers.at(-1)).not.toBe(before));
      expect(answers.at(-1)?.state).toBe("known");
    } finally {
      root.unmount();
      await nextMacrotask();
      unbind();
    }
  });

  it("a stop's page lets its stop go when it moves to another stop, and at unmount", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { bindAccountFlow, useStopServices } = await import("./accountForge");
    const rig = stage();
    const unbind = bindAccountFlow(rig.stage);
    const production = { ...PROJECT, projectId: "p-prod" } as ProjectRef;

    function Page({ project }: { readonly project: ProjectRef }) {
      useStopServices(project);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      root.render(rig.wrap(<Page project={PROJECT} />));
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-stage"]));
      root.render(rig.wrap(<Page project={production} />));
      await vi.waitFor(() => expect(rig.stopDemands).toEqual(["p-prod"]));
    } finally {
      root.unmount();
      await nextMacrotask();
      unbind();
    }
    expect(rig.stopDemands).toEqual([]);
  });

  it.each([
    { name: "no stop named", bound: true, project: null },
    { name: "no flow bound yet", bound: false, project: PROJECT },
  ])("a stop's page with $name reads nothing and demands nothing", async ({ bound, project }) => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { bindAccountFlow, useStopServices } = await import("./accountForge");
    const rig = stage();
    const unbind = bound ? bindAccountFlow(rig.stage) : () => undefined;
    const answers: Array<Shown<ReadonlyArray<StopService>>> = [];

    function Page() {
      answers.push(useStopServices(project));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      root.render(rig.wrap(<Page />));
      await vi.waitFor(() => expect(answers.length).toBeGreaterThan(0));
      await nextMacrotask();
      expect(answers.at(-1)).toEqual({ state: "unread", waitingFor: "access-grant" });
      expect(rig.stopDemandCalls()).toBe(0);
    } finally {
      root.unmount();
      await nextMacrotask();
      unbind();
    }
  });
  it("reads what each service runs, and nothing before the stops are bound", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { bindAccountFlow, useStatedVersions } = await import("./accountForge");
    const rig = stage();
    const answers: Array<ReadonlyMap<string, Shown<ZeropsServiceDeployedVersion>>> = [];

    function Services({ services }: { readonly services: ReadonlyArray<ServiceRef> }) {
      answers.push(useStatedVersions(services));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    let unbind = () => undefined as void;
    try {
      root.render(rig.wrap(<Services services={[APPSTAGE]} />));
      await vi.waitFor(() =>
        expect(answers.at(-1)?.get("s-app")).toEqual({
          state: "unread",
          waitingFor: "access-grant",
        }),
      );
      unbind = bindAccountFlow(rig.stage);
      await vi.waitFor(() =>
        expect(answers.at(-1)?.get("s-app")).toEqual({ state: "unread", waitingFor: null }),
      );
      rig.holdVersion("s-app", known({ activeId: "v1", source: "GIT", name: "v1.0.0" }));
      await vi.waitFor(() =>
        expect(answers.at(-1)?.get("s-app")).toMatchObject({ value: { name: "v1.0.0" } }),
      );
    } finally {
      root.unmount();
      await nextMacrotask();
      unbind();
    }
  });
});
