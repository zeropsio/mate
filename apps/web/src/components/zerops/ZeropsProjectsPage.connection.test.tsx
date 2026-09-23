import { EnvironmentId } from "@t3tools/contracts";
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

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => async () => undefined,
}));
vi.mock("~/zerops/zeropsDataContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsData: () => ({ organizationRef }),
}));
vi.mock("~/zerops/zeropsBirths", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsBirths: () => ({ births: [], waits: new Map(), outstanding: null }),
}));
vi.mock("~/zerops/zeropsContainers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsContainers: () => ({
    health: new Map(),
    serverVersions: new Map(),
    mateFlags: new Map(),
  }),
}));
vi.mock("~/zerops/useZeropsIdentityExchange", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsIdentityExchange: () => async () => undefined,
}));
vi.mock("~/zerops/useZeropsUpgradeRestart", () => ({ useZeropsUpgradeRestart: () => null }));

afterEach(() => {
  closeAccountLifetime();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useZeropsProjectConnection", () => {
  it.each([
    {
      name: "a finished birth reads its organization's inventory again",
      organizationId: "org-1",
      want: [{ topic: "inventory", organization: organizationRef("org-1") }],
    },
    { name: "a connect that was no birth asks for nothing", organizationId: null, want: [] },
  ])("$name", async ({ organizationId, want }) => {
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
    let connection!: ReturnType<typeof useZeropsProjectConnection>;
    function Connection() {
      const current = useZeropsProjectConnection();
      useEffect(() => {
        connection = current;
      }, [current]);
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      act(() => root.render(<Connection />));

      await act(() => connection.finishBirth(EnvironmentId.make("environment-1"), organizationId));
      await act(() => vi.advanceTimersByTimeAsync(INVALIDATION_COALESCE_MS));
      expect(heard).toEqual(want);
    } finally {
      stop();
      bus.close();
      act(() => root.unmount());
    }
  });
});
