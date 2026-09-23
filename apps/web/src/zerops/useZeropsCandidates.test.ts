import { EnvironmentId } from "@t3tools/contracts";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import { deriveZeropsCandidates } from "@t3tools/client-runtime/zerops/candidates";
import {
  interestKeyOf,
  makeInitialZeropsDataState,
  makeZeropsApiOrigin,
  selectProjectsOf,
  ReceiptOrdinal,
  selectServicesOf,
  ZeropsAccountId,
  ZeropsOrganizationId,
  type InterestState,
  type OrganizationRef,
} from "@t3tools/client-runtime/zerops/data";
import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";
import { INVALIDATION_COALESCE_MS } from "@t3tools/client-runtime/zerops/knowledge/invalidation";

import { identity, organization, project, scope } from "./__fixtures__/platformData";
import { TestNode } from "./__fixtures__/testDom";
import { bindTestInvalidationBus } from "./__fixtures__/invalidationBus";
import { onZeropsInvalidation } from "./accountInvalidations";
import { sameProjectsRead, sameServicesRead } from "../state/zerops";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  authenticatedZeropsOrigins,
  useZeropsCandidates,
  withZeropsConnection,
} from "./useZeropsCandidates";

const organizationRef = (organizationId: string): OrganizationRef => ({
  kind: "organization",
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  },
  organizationId: ZeropsOrganizationId.make(organizationId),
});

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    activeOrganization: { id: "org-1" },
    organizationStatus: "selected",
    status: "signed-in",
  }),
}));
vi.mock("./zeropsDataContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsData: () => ({ organizationRef }),
}));
vi.mock("./inventoryContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsInventory: () => ({
    projects: [],
    services: new Map(),
    projectRefs: new Map(),
    isLoading: false,
    error: null,
  }),
}));

afterEach(() => {
  closeAccountLifetime();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PROJECT: ZeropsProject = {
  id: "project-1",
  name: "kanban",
  status: "ACTIVE",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};

const SERVICE: ZeropsService = {
  id: "service-1",
  name: "zcp",
  status: "ACTIVE",
  subdomainAccess: true,
  ports: [{ port: 8080, httpSupport: true }],
  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
};

const READY = {
  ...deriveZeropsCandidates(PROJECT, [SERVICE], new Map())[0]!,
  presence: "known" as const,
};

describe("authenticatedZeropsOrigins", () => {
  it("does not group a registered same-origin environment as connected until it authenticates", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const registeredButRejected = authenticatedZeropsOrigins([
      {
        environmentId,
        displayUrl: "https://zcp-24cb-8080.prg1.zerops.app/mate",
        connection: { phase: "error" },
      },
    ]);

    expect(withZeropsConnection(READY, registeredButRejected)).toMatchObject({
      group: "ready",
      containerOrigin: "https://zcp-24cb-8080.prg1.zerops.app",
    });

    const authenticated = authenticatedZeropsOrigins([
      {
        environmentId,
        displayUrl: "https://zcp-24cb-8080.prg1.zerops.app/mate",
        connection: { phase: "connected" },
      },
    ]);

    expect(withZeropsConnection(READY, authenticated)).toMatchObject({
      group: "connected",
      environmentId,
    });
  });
});

describe("a held read", () => {
  const establishing = (key: InterestState["identity"]["key"]): InterestState => ({
    status: "establishing",
    identity: { ...identity(), key },
    startedAtMs: 0,
    deadlineMs: 60_000,
    progress: {
      requiredRegistrations: 1,
      completedRegistrations: 0,
      requiredReads: 1,
      completedReads: 0,
      crossedReceiptOrdinal: ReceiptOrdinal.make(0),
    },
  });
  const failed = (from: InterestState): InterestState => ({
    status: "failed",
    identity: from.identity,
    reason: "gateway",
    retryable: true,
    attempts: 1,
    retryAtMs: 90_000,
  });

  it("changes when its projects' interest fails, though the query did not", () => {
    const read = selectProjectsOf(makeInitialZeropsDataState(scope()), organization);
    const feeder = establishing(interestKeyOf({ kind: "organization-inventory", organization }));
    const before = { ...read, observation: { ...read.observation, required: [feeder] } };
    const after = { ...read, observation: { ...read.observation, required: [failed(feeder)] } };

    expect(sameProjectsRead(before, after)).toBe(false);
  });

  it("holds when only an interest that does not feed it changes", () => {
    const read = selectProjectsOf(makeInitialZeropsDataState(scope()), organization);
    const other = establishing(
      interestKeyOf({ kind: "project-topology", project: project(), includeCurrentMetrics: false }),
    );
    const before = { ...read, observation: { ...read.observation, required: [other] } };
    const after = { ...read, observation: { ...read.observation, required: [failed(other)] } };

    expect(sameProjectsRead(before, after)).toBe(true);
  });

  it("changes when its services' interest fails, though the query did not", () => {
    const read = selectServicesOf(makeInitialZeropsDataState(scope()), project());
    const feeder = establishing(interestKeyOf({ kind: "project-inventory", project: project() }));
    const before = { ...read, observation: { ...read.observation, required: [feeder] } };
    const after = { ...read, observation: { ...read.observation, required: [failed(feeder)] } };

    expect(sameServicesRead(before, after)).toBe(false);
  });
});

describe("useZeropsCandidates", () => {
  it("the header's reload reads the active organization's inventory again", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
    vi.spyOn(process.hrtime, "bigint").mockImplementation(() =>
      BigInt(Math.round(performance.now() * 1_000_000)),
    );
    const document = new TestNode("#document", null, 9);
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { document, HTMLIFrameElement: TestNode });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    openAccountLifetime("account");
    const bus = bindTestInvalidationBus();
    const heard: Array<Invalidation> = [];
    const stop = onZeropsInvalidation((invalidation) => heard.push(invalidation));
    let refresh!: () => void;
    function Header() {
      const reload = useZeropsCandidates().refresh;
      useEffect(() => {
        refresh = reload;
      }, [reload]);
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      act(() => root.render(createElement(Header)));
      refresh();
      await act(() => vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS));
      expect(heard).toEqual([{ topic: "inventory", organization: organizationRef("org-1") }]);
    } finally {
      stop();
      bus.close();
      act(() => root.unmount());
    }
  });
});
