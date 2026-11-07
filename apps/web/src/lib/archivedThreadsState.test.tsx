// @vitest-environment happy-dom

import { RegistryContext } from "@effect/atom-react";
import * as accountData from "@t3tools/client-runtime/data";
import { makeAccountStore, type AccountStore } from "@t3tools/client-runtime/data";
import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import { EnvironmentId, type OrchestrationShellSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { environmentPresentations } from "../state/presentation";
import { AccountStoreContext } from "../zerops/accountData";
import { closeAccountLifetime, openAccountLifetime } from "../zerops/accountLifetime";
import { useArchivedThreadSnapshots } from "./archivedThreadsState";

const OPEN = EnvironmentId.make("open-mate");
const PARKED = EnvironmentId.make("parked-mate");
const fixture = { asked: [] as unknown[], store: null as AccountStore | null };
let previousPresentations: typeof environmentPresentations.presentationsAtom;
let registry: ReturnType<typeof AtomRegistry.make>;
beforeEach(() => {
  previousPresentations = environmentPresentations.presentationsAtom;
  environmentPresentations.presentationsAtom = Atom.make(
    new Map([
      [OPEN, { connection: { phase: "connected" } } as EnvironmentPresentation],
      [PARKED, { connection: { phase: "available" } } as EnvironmentPresentation],
    ]),
  );
  openAccountLifetime("archive-reader");
  vi.spyOn(accountData, "makeArchiveWire").mockReturnValue({
    read: (environmentId) =>
      Effect.sync(() => {
        fixture.asked.push(environmentId);
        return {
          snapshotSequence: 1,
          updatedAt: "2026-10-07T00:00:00Z",
          projects: [],
          threads: [],
        } satisfies OrchestrationShellSnapshot;
      }),
  });
});
const mounted: ReactTestRenderer[] = [];
afterEach(async () => {
  for (const renderer of mounted.splice(0)) act(() => renderer.unmount());
  await act(() => closeAccountLifetime());
  fixture.store?.close();
  registry.dispose();
  fixture.store = null;
  fixture.asked = [];
  environmentPresentations.presentationsAtom = previousPresentations;
  vi.restoreAllMocks();
});
function Probe({ environmentIds }: { environmentIds: ReadonlyArray<EnvironmentId> }) {
  const read = useArchivedThreadSnapshots(environmentIds);
  return (
    <span>{JSON.stringify({ loading: read.isLoading, snapshots: read.snapshots.length })}</span>
  );
}
describe("useArchivedThreadSnapshots", () => {
  it("reads archived chats only from the Mates this browser is connected to, and retains them on remount", async () => {
    registry = AtomRegistry.make();
    fixture.store = makeAccountStore(registry);
    const ids = [OPEN, PARKED];
    const render = () =>
      create(
        <RegistryContext.Provider value={registry}>
          <AccountStoreContext.Provider value={fixture.store}>
            <Probe environmentIds={ids} />
          </AccountStoreContext.Provider>
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
