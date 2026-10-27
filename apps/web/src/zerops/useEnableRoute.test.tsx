/**
 * Opening a service to the internet: the account's `enable-subdomain-access` operation, whose end
 * the pushed rows show — nothing is read again; a refusal is said.
 */
import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useEnableRoute, type EnableRoute } from "./useEnableRoute";

const mock = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock("./accountOperations", () => ({ useAccountOperations: () => ({ submit: mock.submit }) }));
vi.mock("./ZeropsAccountData", () => ({ useAccountData: () => ({ orgId: "org-1" }) }));
vi.mock("./accountLifetime", () => ({ captureAccountLifetime: () => () => true }));

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
  act(() => {
    mounted.push(create(createElement(Probe)));
  });
});
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
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
