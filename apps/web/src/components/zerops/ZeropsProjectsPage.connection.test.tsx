import { EnvironmentId } from "@t3tools/contracts";
import type { ProvisioningState } from "@t3tools/client-runtime/zerops/provisioning";
import type { BirthRecord } from "@t3tools/client-runtime/zerops/birth";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  makeZeropsApiOrigin,
  type OrganizationRef,
} from "@t3tools/client-runtime/zerops/data";
import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";
import { INVALIDATION_COALESCE_MS } from "@t3tools/client-runtime/zerops/knowledge/invalidation";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "~/zerops/__fixtures__/testDom";
import { bindTestInvalidationBus } from "~/zerops/__fixtures__/invalidationBus";
import { onZeropsInvalidation } from "~/zerops/accountInvalidations";
import { closeAccountLifetime, openAccountLifetime } from "~/zerops/accountLifetime";

import { useZeropsProjectConnection } from "./ZeropsProjectsPage";

const organizationRef = (organizationId: string): OrganizationRef => ({
  kind: "organization",
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  },
  organizationId: ZeropsOrganizationId.make(organizationId),
});

const mocks = vi.hoisted(() => ({
  births: {
    births: [] as ReadonlyArray<unknown>,
    waits: new Map<string, unknown>(),
    outstanding: null,
  },
  connect: async (_target: unknown): Promise<unknown> => undefined,
  navigated: [] as Array<unknown>,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => async (to: unknown) => {
    mocks.navigated.push(to);
  },
}));
vi.mock("~/zerops/zeropsDataContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsData: () => ({ organizationRef }),
}));
vi.mock("~/zerops/zeropsBirths", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsBirths: () => mocks.births,
}));
vi.mock("~/zerops/zeropsContainers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsContainers: () => ({
    health: new Map(),
    serverVersions: new Map(),
    mateFlags: new Map(),
  }),
}));
vi.mock("~/zerops/accountEnvironments", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useConnectMate: () => mocks.connect,
}));
vi.mock("~/zerops/useZeropsUpgradeRestart", () => ({ useZeropsUpgradeRestart: () => null }));

afterEach(() => {
  mocks.births = { births: [], waits: new Map(), outstanding: null };
  mocks.connect = async () => undefined;
  mocks.navigated = [];
  closeAccountLifetime();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The hook mounted on a fake clock, with the account's invalidations heard. */
function mountConnection() {
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
  const mounted = { connection: null as ReturnType<typeof useZeropsProjectConnection> | null };
  function Connection() {
    const current = useZeropsProjectConnection();
    useEffect(() => {
      mounted.connection = current;
    }, [current]);
    return null;
  }
  const root = createRoot(document.createElement("div") as unknown as Element);
  act(() => root.render(<Connection />));
  return {
    heard,
    connection: () => mounted.connection!,
    advance: (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms)),
    unmount: () => {
      stop();
      bus.close();
      act(() => root.unmount());
    },
  };
}

const PROJECT = "project-new";
const SERVICE = "service-zcp";
const ORIGIN = "https://zcp-new-8080.prg1.zerops.app";

/** A birth in another organization than any the tab has open, whose Mate answered ready. */
function readyBirth(): void {
  const birth: BirthRecord = {
    projectId: PROJECT,
    organizationId: "org-birth",
    startedAt: 0,
    step: "health",
    overdue: false,
    registration: null,
    container: true,
    serviceId: SERVICE,
    origin: ORIGIN,
    handoff: null,
  };
  const wait: ProvisioningState = {
    phase: "ready",
    waitingFor: "",
    capMs: null,
    phaseStartedAtMs: 1,
    projectId: PROJECT,
    containerServiceId: SERVICE,
    containerOrigin: ORIGIN,
    overdue: false,
    detail: null,
    enabled: false,
    processRunning: false,
  };
  mocks.births = { births: [birth], waits: new Map([[PROJECT, wait]]), outstanding: null };
}

const NOT_LISTED = {
  _tag: "Failure",
  error: "Could not connect to this container. Looking for this Mate…",
  retryable: true,
} as const;

describe("useZeropsProjectConnection", () => {
  it("a birth whose Mate answers ready before the inventory lists it connects by its target key and never sets connectError", async () => {
    readyBirth();
    const targets: Array<unknown> = [];
    const answers = [NOT_LISTED, { _tag: "Success", environmentId: EnvironmentId.make("env-new") }];
    mocks.connect = async (target) => {
      targets.push(target);
      return answers.shift();
    };
    const rig = mountConnection();
    try {
      await rig.advance(0);
      expect(targets).toEqual([{ key: `${PROJECT}:${SERVICE}` }]);
      expect(rig.connection().connectError).toBeNull();
      expect(rig.connection().failedOrigin).toBeNull();

      await rig.advance(2_000);
      expect(targets).toEqual([{ key: `${PROJECT}:${SERVICE}` }, { key: `${PROJECT}:${SERVICE}` }]);
      expect(rig.connection().connectError).toBeNull();
      expect(mocks.navigated).toHaveLength(1);
    } finally {
      rig.unmount();
    }
  });

  it("the first re-read sees the project NEW, no push arrives, and the birth still connects within the retry ladder", async () => {
    readyBirth();
    // The Mate's target is listed by the second read of the birth's organization, and by nothing
    // else: the first still sees the project NEW, and no push follows it.
    const birthRead = { topic: "inventory", organization: organizationRef("org-birth") } as const;
    const heard: Array<Invalidation> = [];
    let connects = 0;
    mocks.connect = async () => {
      connects += 1;
      return heard.length >= 2
        ? { _tag: "Success", environmentId: EnvironmentId.make("env-new") }
        : NOT_LISTED;
    };
    const rig = mountConnection();
    const stop = onZeropsInvalidation((invalidation) => heard.push(invalidation));
    try {
      await rig.advance(0);
      expect(connects).toBe(1);
      await rig.advance(2_000 + 4_000);
      expect(heard).toEqual([birthRead, birthRead]);
      expect(connects).toBe(3);
      expect(mocks.navigated).toHaveLength(1);
      expect(rig.connection().connectError).toBeNull();
    } finally {
      stop();
      rig.unmount();
    }
  });

  it.each([
    {
      name: "a finished birth reads its organization's inventory again",
      organizationId: "org-1",
      want: [{ topic: "inventory", organization: organizationRef("org-1") }],
    },
    { name: "a connect that was no birth asks for nothing", organizationId: null, want: [] },
  ])("$name", async ({ organizationId, want }) => {
    const rig = mountConnection();
    try {
      await act(() =>
        rig.connection().finishBirth(EnvironmentId.make("environment-1"), organizationId),
      );
      await rig.advance(INVALIDATION_COALESCE_MS);
      expect(rig.heard).toEqual(want);
    } finally {
      rig.unmount();
    }
  });
});
