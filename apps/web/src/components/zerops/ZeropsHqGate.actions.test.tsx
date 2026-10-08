// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import { makeAccountStore } from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsHqGate } from "./ZeropsHqGate";

const submit = vi.hoisted(() => vi.fn());
const registry = AtomRegistry.make();
const store = makeAccountStore(registry);
vi.mock("~/zerops/accountOperations", () => ({ useAccountOperations: () => ({ submit }) }));
vi.mock("~/zerops/ZeropsAccountData", () => ({ useAccountData: () => ({ data: store.data }) }));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ activeOrganization: { id: "org-acme", name: "Acme" }, client: {} }),
}));
vi.mock("~/zerops/accountHq", () => ({
  useAccountHq: () => ({ reread: vi.fn() }),
  hqBirthSite: () => ({ apiUrl: "https://api.example", publicOrigin: "http://localhost" }),
}));
vi.mock("~/zerops/hqBirth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/zerops/hqBirth")>()),
  useHqBirths: () => null,
}));

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  submit.mockReset();
});

describe("HQ setup admission", () => {
  it("makes no project on entry and submits the first birth only after Set up HQ is pressed", async () => {
    submit.mockResolvedValue({ progress: { stage: "accepted" } });
    await act(async () => {
      tree = create(
        <RegistryContext.Provider value={registry}>
          <ZeropsHqGate gate={{ kind: "birth" }} />
        </RegistryContext.Provider>,
      );
    });
    expect(submit).not.toHaveBeenCalled();
    const button = tree!.root.findByType("button");
    expect(button.children).toContain("Set up HQ");
    await act(async () => button.props.onClick());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      kind: "hq-birth",
      orgId: "org-acme",
      again: false,
    });
  });
});
