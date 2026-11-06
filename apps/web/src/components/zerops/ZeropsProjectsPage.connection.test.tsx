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
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AnyRouter } from "@tanstack/react-router";

import { TestNode } from "~/zerops/__fixtures__/testDom";
import { bindTestInvalidationBus } from "~/zerops/__fixtures__/invalidationBus";
import { onZeropsInvalidation } from "~/zerops/accountInvalidations";
import { closeAccountLifetime, openAccountLifetime } from "~/zerops/accountLifetime";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import * as presses from "~/zerops/matePress";
import * as sessionContext from "~/zerops/sessionContext";
import * as containers from "~/zerops/zeropsContainers";
import * as environments from "~/zerops/accountEnvironments";
import * as upgrade from "~/zerops/useMateUpgradeRecovery";

import { useZeropsProjectConnection } from "./ZeropsProjectsPage";

const organizationRef = (organizationId: string): OrganizationRef => ({
  kind: "organization",
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  },
  organizationId: ZeropsOrganizationId.make(organizationId),
});

const { RouterContextProvider } =
  await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
const router = { options: {}, navigate: vi.fn(async () => {}) } as unknown as AnyRouter;

beforeEach(() => {
  vi.spyOn(presses, "useMatePresses").mockReturnValue([]);
  vi.spyOn(sessionContext, "useZeropsSession").mockReturnValue({
    activeOrganization: null,
  } as unknown as ReturnType<typeof sessionContext.useZeropsSession>);
  vi.spyOn(containers, "useZeropsContainers").mockReturnValue({
    health: new Map(),
    serverVersions: new Map(),
    mateFlags: new Map(),
  } as unknown as ReturnType<typeof containers.useZeropsContainers>);
  vi.spyOn(environments, "useConnectMate").mockReturnValue(
    vi.fn() as ReturnType<typeof environments.useConnectMate>,
  );
  vi.spyOn(upgrade, "useMateUpgradeRecovery").mockReturnValue(null);
});

afterEach(() => {
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
  act(() =>
    root.render(
      <RouterContextProvider router={router}>
        <ZeropsDataContext.Provider value={{ organizationRef } as ZeropsDataContextValue}>
          <Connection />
        </ZeropsDataContext.Provider>
      </RouterContextProvider>,
    ),
  );
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

describe("useZeropsProjectConnection", () => {
  it.each([
    {
      name: "a finished opening reads its organization's inventory again",
      organizationId: "org-1",
      want: [{ topic: "inventory", organization: organizationRef("org-1") }],
    },
    { name: "a connect of no known organization asks for nothing", organizationId: null, want: [] },
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
