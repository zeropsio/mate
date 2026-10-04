import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import type { PublicAccessCellRequest } from "@t3tools/client-runtime/zerops/data";
import { project } from "./__fixtures__/platformData";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";
const held = vi.hoisted(() => ({ ids: [] as string[], renewals: 0, again: [] as string[] }));
vi.mock("./accountInvalidations", () => ({
  invalidateZerops: () => {
    held.renewals++;
  },
}));
vi.mock("./accountForge", () => ({
  againStopDeployment: (ref: { projectId: string }) => {
    held.again.push(ref.projectId);
  },
  useStopDeployments: (refs: ReadonlyArray<{ projectId: string }>) => {
    held.ids = refs.map((ref) => ref.projectId);
    return new Map();
  },
}));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => ({ activeOrganization: { id: "org-1" } }),
}));
import { useStopPublicAccesses } from "./useStopPublicAccess";
afterEach(() => {
  held.ids = [];
  held.renewals = 0;
  held.again = [];
});

it.each(["reading", "access-denied", "access-lapsed"])(
  "drawn stop demand and a manual Again after %s",
  async (state) => {
    const registry = AtomRegistry.make();
    const active = new Set<string>();
    let attempts = 0;
    const cells = new Map<string, Atom.Atom<unknown>>();
    const data = {
      projectRef: (_org: string, id: string) => project(id),
      runtime: {
        scope: {},
        cells: {
          known: (request: PublicAccessCellRequest) => {
            const id = request.project.projectId;
            if (!cells.has(id))
              cells.set(
                id,
                Atom.make((get) => {
                  active.add(id);
                  get.addFinalizer(() => {
                    active.delete(id);
                  });
                  return state === "reading"
                    ? { state: "reading", sinceMs: 0, attempt: 1 }
                    : { state: "withheld", reason: state, cause: null };
                }),
              );
            return cells.get(id);
          },
          readAgain: () =>
            Effect.sync(() => {
              attempts++;
              return true;
            }),
        },
      },
    } as unknown as ZeropsDataContextValue;
    let again: (id: string) => void = () => {};
    function Stops({ ids }: { ids: string[] }) {
      again = useStopPublicAccesses(ids).again;
      return null;
    }
    const render = (ids: string[]) => (
      <RegistryContext.Provider value={registry}>
        <ZeropsDataContext.Provider value={data}>
          <Stops ids={ids} />
        </ZeropsDataContext.Provider>
      </RegistryContext.Provider>
    );
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(render(["production", "stage"]));
    });
    try {
      expect(held.ids).toEqual(["production", "stage"]);
      expect([...active]).toEqual(["production", "stage"]);
      expect(attempts).toBe(0);
      await act(async () => {
        tree.update(render(["stage"]));
      });
      expect(held.ids).toEqual(["stage"]);
      await act(async () => {
        again("stage");
      });
      expect(attempts).toBe(1);
      expect(held.renewals).toBe(state === "reading" ? 0 : 1);
      expect(held.again).toEqual(state === "reading" ? [] : ["stage"]);
    } finally {
      await act(async () => {
        tree.unmount();
      });
      registry.dispose();
    }
    expect(active.size).toBe(0);
  },
);
