import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  makeZeropsApiOrigin,
  type OrganizationRef,
} from "@t3tools/client-runtime/zerops/data";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";
import { bindTestInvalidationBus, type BoundTestBus } from "./__fixtures__/invalidationBus";
import { invalidateZerops } from "./accountInvalidations";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { creationVerdictTargets, useZeropsCreationVerdicts } from "./useZeropsCreationVerdicts";

const session = vi.hoisted(() => ({ readProjectCreation: vi.fn() }));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    activeOrganization: { id: "org-1" },
    client: { readProjectCreation: session.readProjectCreation },
  }),
}));

let bus: BoundTestBus | null = null;
afterEach(() => {
  bus?.close();
  bus = null;
  closeAccountLifetime();
  session.readProjectCreation.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const organization = (organizationId: string): OrganizationRef => ({
  kind: "organization",
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  },
  organizationId: ZeropsOrganizationId.make(organizationId),
});

describe("creationVerdictTargets", () => {
  it("names every project still on its way up, once each", () => {
    expect(
      creationVerdictTargets([
        { project: { id: "a", name: "a", status: "CREATING" } },
        { project: { id: "a", name: "a", status: "CREATING" } },
        { project: { id: "b", name: "b", status: "NEW" } },
        { project: { id: "c", name: "c", status: "ACTIVE" } },
      ]),
    ).toEqual(["a", "b"]);
  });

  it("names nobody once every project has landed", () => {
    expect(creationVerdictTargets([{ project: { id: "a", name: "a", status: "ACTIVE" } }])).toEqual(
      [],
    );
  });
});

describe("useZeropsCreationVerdicts", () => {
  it("asks again about a settled creation on its organization's inventory intent", async () => {
    vi.useFakeTimers();
    openAccountLifetime("account");
    bus = bindTestInvalidationBus();
    const document = new TestNode("#document", null, 9);
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { document, HTMLIFrameElement: TestNode });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    session.readProjectCreation.mockResolvedValue({
      processId: "process-1",
      status: "FAILED",
      error: null,
    });
    const candidates = [
      { key: "p1", project: { id: "p1", name: "One", status: "NEW" }, group: "provisioning" },
    ] as unknown as ReadonlyArray<ZeropsCandidate>;
    function Reader() {
      useZeropsCreationVerdicts(candidates);
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Reader));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(session.readProjectCreation).toHaveBeenCalledTimes(1);

    invalidateZerops({ topic: "inventory", organization: organization("org-2") });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(session.readProjectCreation).toHaveBeenCalledTimes(1);

    invalidateZerops({ topic: "inventory", organization: organization("org-1") });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(session.readProjectCreation).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });
});
