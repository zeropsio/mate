/**
 * Opening a service to the internet: the account's `enable-subdomain-access` operation, and once
 * Zerops took it, its project's public access read again; a refusal is said, nothing read.
 */
import * as Effect from "effect/Effect";
import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useEnableRoute, type EnableRoute } from "./useEnableRoute";

const mock = vi.hoisted(() => ({
  submit: vi.fn(),
  invalidated: [] as Array<unknown>,
}));

vi.mock("./accountOperations", () => ({ useAccountOperations: () => ({ submit: mock.submit }) }));
vi.mock("./ZeropsAccountData", () => ({ useAccountData: () => ({ orgId: "org-1" }) }));
vi.mock("./accountLifetime", () => ({ captureAccountLifetime: () => () => true }));
vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({
    projectRef: (organizationId: string, projectId: string) => ({ organizationId, projectId }),
    runtime: {
      scope: "account-scope",
      cells: {
        invalidate: (request: unknown) =>
          Effect.sync(() => {
            mock.invalidated.push(request);
          }),
      },
    },
  }),
}));

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
  mock.invalidated = [];
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
  it("asks Zerops for the subdomain, then reads the project's public access again", async () => {
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
    expect(mock.invalidated).toEqual([
      {
        kind: "public-access",
        account: "account-scope",
        project: { organizationId: "org-1", projectId: "p1" },
      },
    ]);
    expect(route.trouble).toBeNull();
    expect(route.enablingServiceId).toBeNull();
  });

  it("says a refusal in Zerops's words and reads nothing again", async () => {
    mock.submit.mockResolvedValue(answered({ stage: "refused", reason: "Not allowed." }));
    await act(async () => {
      await route.enable("p1", "s1");
    });
    expect(route.trouble).toBe("Not allowed.");
    expect(mock.invalidated).toEqual([]);
  });
});
