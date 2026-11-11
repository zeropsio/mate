/**
 * Opening a service to the internet: the account's `enable-subdomain-access` operation, whose end
 * the pushed rows show — nothing is read again; a refusal is said.
 */
import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as accountOperations from "./accountOperations";
import * as accountData from "./ZeropsAccountData";
import * as accountLifetime from "./accountLifetime";
import { useEnableRoute, type EnableRoute } from "./useEnableRoute";

const mock = { submit: vi.fn() };

const mounted: ReactTestRenderer[] = [];
let route: EnableRoute;
function Probe() {
  const hook = useEnableRoute();
  useLayoutEffect(() => {
    route = hook;
  }, [hook]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.submit.mockReset();
  vi.spyOn(accountOperations, "useAccountOperations").mockReturnValue({
    submit: mock.submit,
  } as unknown as ReturnType<typeof accountOperations.useAccountOperations>);
  vi.spyOn(accountData, "useAccountData").mockReturnValue({ orgId: "org-1" } as ReturnType<
    typeof accountData.useAccountData
  >);
  vi.spyOn(accountLifetime, "captureAccountLifetime").mockReturnValue(() => true);
  act(() => {
    mounted.push(create(createElement(Probe)));
  });
});
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const answered = (progress: unknown) => ({ requestId: "r1", evidence: null, progress });

describe("useEnableRoute", () => {
  it("asks Zerops for the subdomain, and is done when Zerops says so", async () => {
    mock.submit.mockResolvedValue(
      answered({ stage: "done", operationId: "s1", outcome: "succeeded" }),
    );
    await act(async () => {
      await route.enable("p1", "s1");
    });
    expect(mock.submit).toHaveBeenCalledWith({
      kind: "enable-subdomain-access",
      orgId: "org-1",
      projectId: "p1",
      serviceId: "s1",
    });
    expect(route.trouble).toBeNull();
    expect(route.enablingServiceId).toBeNull();
  });

  it("says a refusal in Zerops's words", async () => {
    mock.submit.mockResolvedValue(answered({ stage: "refused", reason: "Not allowed." }));
    await act(async () => {
      await route.enable("p1", "s1");
    });
    expect(route.trouble).toBe("Not allowed.");
  });
});
