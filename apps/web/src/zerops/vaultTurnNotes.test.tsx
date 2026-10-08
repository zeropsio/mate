import { RegistryContext } from "@effect/atom-react";
import { NOT_READ_VAULT, type VaultView } from "@t3tools/client-runtime/data";
import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry, type Atom } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";
import { useVaultTurnNotes } from "./vaultTurnNotes";

const held = vi.hoisted(() => ({ view: null as unknown as Atom.Writable<VaultView> }));

vi.mock("./useZeropsEnvironmentProject", () => ({
  useZeropsEnvironmentProject: () => ({ projectId: "p1", orgId: "org" }),
}));
vi.mock("./ZeropsAccountData", () => ({ useDetailDemand: () => undefined }));
vi.mock("@t3tools/client-runtime/data", async (original) => {
  const data = await original<typeof import("@t3tools/client-runtime/data")>();
  const { Atom } = await import("effect/reactivity");
  held.view = Atom.make(data.NOT_READ_VAULT);
  return { ...data, vaultAtom: () => held.view };
});

it("a chat's vault note renders changes, without rendering source status", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const registry = AtomRegistry.make();
  const view = held.view;
  let renders = 0;
  function Note() {
    renders++;
    const read = useVaultTurnNotes(EnvironmentId.make("e1"), "t1", "2026-10-07T09:00:00Z");
    return <span>{read.note ?? "no changes"}</span>;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    registry.set(view, { ...NOT_READ_VAULT, status: "ready", complete: true });
    await act(async () => {
      renderer = create(
        <RegistryContext value={registry}>
          <Note />
        </RegistryContext>,
      );
    });
    const before = renders;
    await act(async () => registry.set(view, { ...registry.get(view), status: "failed" }));
    expect(renders).toBe(before);
    expect(renderer!.toJSON()).toMatchObject({ children: ["no changes"] });
    const changed: VaultView = {
      ...registry.get(view),
      scopes: [
        {
          ref: { kind: "shared" },
          id: "shared",
          hostname: null,
          kind: "shared",
          serviceType: null,
          editable: true,
          reads: [],
          startedAt: null,
          values: [
            {
              id: "v1",
              key: "LOG_LEVEL",
              sensitive: false,
              value: "debug",
              createdAt: "2026-10-07T09:01:00Z",
              changedAt: null,
              madeByZerops: false,
              readers: [],
            },
          ],
        },
      ],
    };
    await act(async () => registry.set(view, changed));
    expect(renders).toBe(before + 1);
    expect(JSON.stringify(renderer!.toJSON())).toContain("LOG_LEVEL");
  } finally {
    await act(async () => renderer?.unmount());
    registry.dispose();
    vi.unstubAllGlobals();
  }
});
