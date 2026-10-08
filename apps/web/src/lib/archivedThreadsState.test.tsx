import { RegistryContext } from "@effect/atom-react";
import { makeAccountStore, type AccountStore } from "@t3tools/client-runtime/data";
import { EnvironmentId, type OrchestrationShellSnapshot } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useArchivedThreadSnapshots } from "./archivedThreadsState";

const OPEN = EnvironmentId.make("open-mate");
const PARKED = EnvironmentId.make("parked-mate");
const fixture = vi.hoisted(() => ({
  asked: [] as unknown[],
  store: null as AccountStore | null,
  close: new Set<() => void>(),
}));
vi.mock("../state/presentation", async () => {
  const { Atom: Atoms } = await import("effect/reactivity");
  return {
    environmentPresentations: {
      presentationsAtom: Atoms.make(
        new Map([
          ["open-mate", { connection: { phase: "connected" } }],
          ["parked-mate", { connection: { phase: "available" } }],
        ]),
      ),
    },
  };
});
vi.mock("../connection/runtime", () => ({
  connectionAtomRuntime: { atom: () => Atom.make(AsyncResult.success({})) },
}));
vi.mock("../zerops/ZeropsAccountData", () => ({ useAccountStoreForAdapters: () => fixture.store }));
vi.mock("../zerops/accountLifetime", () => ({
  onAccountLifetimeClose: (close: () => void) => {
    fixture.close.add(close);
    return () => fixture.close.delete(close);
  },
}));
vi.mock("@t3tools/client-runtime/data", async (original) => {
  const actual = await original<typeof import("@t3tools/client-runtime/data")>();
  const Effect = await import("effect/Effect");
  return {
    ...actual,
    makeArchiveWire: () => ({
      read: (environmentId: EnvironmentId) =>
        Effect.sync(() => {
          fixture.asked.push(environmentId);
          return {
            snapshotSequence: 1,
            updatedAt: "2026-10-07T00:00:00Z",
            projects: [],
            threads: [],
          } satisfies OrchestrationShellSnapshot;
        }),
    }),
  };
});
const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const renderer of mounted.splice(0)) act(() => renderer.unmount());
  act(() => {
    for (const close of fixture.close) close();
  });
  fixture.store = null;
  fixture.asked = [];
});
function Probe({ environmentIds }: { environmentIds: ReadonlyArray<EnvironmentId> }) {
  const read = useArchivedThreadSnapshots(environmentIds);
  return (
    <span>{JSON.stringify({ loading: read.isLoading, snapshots: read.snapshots.length })}</span>
  );
}
describe("useArchivedThreadSnapshots", () => {
  it("reads archived chats only from the Mates this browser is connected to, and retains them on remount", async () => {
    const registry = AtomRegistry.make();
    fixture.store = makeAccountStore(registry);
    const ids = [OPEN, PARKED];
    const render = () =>
      create(
        <RegistryContext.Provider value={registry}>
          <Probe environmentIds={ids} />
        </RegistryContext.Provider>,
      );
    await act(async () => {
      mounted.push(render());
    });
    expect(fixture.asked).toEqual([OPEN]);
    expect(mounted[0]!.root.findByType("span").children).toEqual([
      '{"loading":false,"snapshots":1}',
    ]);
    act(() => mounted.pop()!.unmount());
    await act(async () => {
      mounted.push(render());
    });
    expect(fixture.asked).toEqual([OPEN]);
  });
});
