import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useArchivedThreadSnapshots } from "./archivedThreadsState";

const OPEN = EnvironmentId.make("open-mate");
const PARKED = EnvironmentId.make("parked-mate");

const reads = vi.hoisted(() => ({ asked: [] as unknown[] }));

vi.mock("../state/presentation", async () => {
  const { Atom: Atoms } = await import("effect/unstable/reactivity");
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

vi.mock("../state/orchestration", () => ({
  orchestrationEnvironment: {
    archivedShellSnapshot: ({ environmentId }: { environmentId: unknown }) => {
      reads.asked.push(environmentId);
      return Atom.make(AsyncResult.initial(true));
    },
  },
}));

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const renderer of mounted.splice(0)) act(() => renderer.unmount());
  reads.asked = [];
});

function Probe({ environmentIds }: { environmentIds: ReadonlyArray<EnvironmentId> }) {
  useArchivedThreadSnapshots(environmentIds);
  return null;
}

describe("useArchivedThreadSnapshots", () => {
  it("reads archived chats only from the Mates this browser is connected to", () => {
    const registry = AtomRegistry.make();
    act(() => {
      mounted.push(
        create(
          <RegistryContext.Provider value={registry}>
            <Probe environmentIds={[OPEN, PARKED]} />
          </RegistryContext.Provider>,
        ),
      );
    });

    expect(reads.asked).toEqual([OPEN]);
  });
});
