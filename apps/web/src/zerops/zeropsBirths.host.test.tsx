import type { ZeropsApiClient, ZeropsIntegrationToken } from "@t3tools/client-runtime/zerops";
import {
  applyProjectTagPatch,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  makeZeropsApiOrigin,
  type OrganizationRef,
  type ProjectRef,
  type ProjectTagPatch,
} from "@t3tools/client-runtime/zerops/data";
import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";
import { INVALIDATION_COALESCE_MS } from "@t3tools/client-runtime/zerops/knowledge/invalidation";
import * as Effect from "effect/Effect";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { bindTestInvalidationBus } from "./__fixtures__/invalidationBus";
import { TestNode } from "./__fixtures__/testDom";
import { onZeropsInvalidation } from "./accountInvalidations";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { beginBirth, bindBirthInputs, useZeropsBirths, type BirthInputs } from "./zeropsBirths";

// The Mate's health is the probe pool's; these births stop at their harden.
vi.mock("./zeropsContainers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  nextContainerReading: () => new Promise(() => undefined),
}));

const account = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account"),
};

const organizationRef = (organizationId: string): OrganizationRef => ({
  kind: "organization",
  account,
  organizationId: ZeropsOrganizationId.make(organizationId),
});

const projectRef = (organizationId: string, projectId: string): ProjectRef => ({
  kind: "project",
  organization: organizationRef(organizationId),
  projectId: ZeropsProjectId.make(projectId),
});

/** The tab's account tree: a client, a runtime and a feed that reads the container's boot over. */
function accountTree(calls: Array<string>): BirthInputs {
  let tagList: ReadonlyArray<string> = ["mate:tool:gitea", "mate:gn:group-1:todo"];
  const broker: ZeropsIntegrationToken = { id: "broker-1", name: "mate-broker", projects: [] };
  const client = {
    listIntegrationTokens: async (clientId: string) => {
      calls.push(`list tokens of ${clientId}`);
      return [broker];
    },
    setIntegrationTokenProjects: async (input: {
      readonly clientId: string;
      readonly projects: ReadonlyArray<{ readonly projectId: string }>;
    }) => {
      calls.push(
        `grant ${input.projects.map((project) => project.projectId).join(",")} in ${input.clientId}`,
      );
    },
    fetchProject: async (projectId: string) => ({
      id: projectId,
      name: "Todo - Vera",
      status: "ACTIVE",
      clientId: "org-1",
      publicZone: "abc.prg1-zerops.zone",
      zeropsSubdomainHost: "24cb",
    }),
    listProjectServices: async () => [
      {
        id: "service-1",
        name: "zcp",
        status: "ACTIVE",
        subdomainAccess: true,
        ports: [{ port: 8080, httpSupport: true }],
        serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
      },
    ],
  } as unknown as ZeropsApiClient;
  const runtime = {
    acquire: () => Effect.void,
    reads: { activity: (project: ProjectRef) => project },
    commands: {
      updateProjectTags: (project: ProjectRef, patch: ProjectTagPatch) =>
        Effect.sync(() => {
          calls.push(`${patch.kind} on ${project.projectId}`);
          const next = applyProjectTagPatch(tagList, patch);
          if (next.ok) tagList = next.tags;
          const read = { id: project.projectId, name: "Gitea", status: "ACTIVE", tagList };
          return { value: { kind: "written", project: read } };
        }),
      isolateProjectEnv: (project: ProjectRef) =>
        Effect.sync(() => {
          calls.push(`harden ${project.organization.organizationId}/${project.projectId}`);
          return { value: undefined };
        }),
    },
  } as unknown as BirthInputs["runtime"];
  // The feed observes the project, and nothing runs on the container any more.
  const atoms = {
    get: () => ({ running: { observation: { required: [{ status: "observing" }] }, value: [] } }),
  } as unknown as BirthInputs["atoms"];
  return { client, runtime, organizationRef, projectRef, atoms };
}

const mate = {
  projectId: "project-1",
  organizationId: "org-1",
  registration: {
    giteaProjectId: "gitea-1",
    giteaOrigin: null,
    groupId: "group-1",
    kind: "mate" as const,
    displayName: "Todo - Vera",
  },
  container: true,
  placement: null,
};

function openTab() {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  const values = new Map<string, string>();
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  // A tab of its own: no other tab asks for a birth's lock.
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  openAccountLifetime("account");
  const bus = bindTestInvalidationBus();
  const heard: Array<Invalidation> = [];
  const stop = onZeropsInvalidation((invalidation) => heard.push(invalidation));
  return {
    heard,
    close: () => {
      stop();
      bus.close();
    },
  };
}

afterEach(() => {
  closeAccountLifetime();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the account's births", () => {
  it("leaving /zerops mid-birth keeps it hardening", async () => {
    const tab = openTab();
    const calls: Array<string> = [];
    bindBirthInputs(accountTree(calls));
    let births: ReturnType<typeof useZeropsBirths>["births"] = [];
    function ProjectsPage() {
      const current = useZeropsBirths().births;
      useEffect(() => {
        births = current;
      }, [current]);
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      act(() => root.render(<ProjectsPage />));
      act(() => beginBirth({ ...mate, registration: null }));
      expect(births.map((birth) => birth.step)).toEqual(["harden"]);

      // The person leaves the projects page before the container is up.
      act(() => root.unmount());
      await vi.advanceTimersByTimeAsync(100);
      expect(calls).toEqual(["harden org-1/project-1"]);
    } finally {
      tab.close();
    }
  });

  it("org switch after create-accepted still finishes tags and registry", async () => {
    const tab = openTab();
    const calls: Array<string> = [];
    bindBirthInputs(accountTree(calls));
    beginBirth(mate);
    // The tab switches to org-2: the account tree commits again, and the birth is still org-1's.
    bindBirthInputs(accountTree(calls));
    await vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS + 100);
    try {
      expect(calls).toEqual([
        "registry-member on gitea-1",
        "list tokens of org-1",
        "grant project-1 in org-1",
        "harden org-1/project-1",
      ]);
      // Its Mate is listed in the organization it was born in.
      expect(tab.heard).toEqual([{ topic: "inventory", organization: organizationRef("org-1") }]);
    } finally {
      tab.close();
    }
  });
});
