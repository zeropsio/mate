import type { PublicAccessView } from "@t3tools/client-runtime/data";
import { act } from "react";
import { create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { project } from "./__fixtures__/platformData";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";

const held = vi.hoisted(() => ({
  ids: [] as string[],
  demanded: [] as string[],
  retried: [] as string[],
  renewals: 0,
  again: [] as string[],
  view: null as PublicAccessView | null,
}));
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
const account = vi.hoisted(() => ({
  orgId: "org-1",
  demandDetail: ({ family, ownerId }: { family: string; ownerId: string }) => {
    held.demanded.push(`${family}:${ownerId}`);
    return () => {
      held.demanded.splice(held.demanded.indexOf(`${family}:${ownerId}`), 1);
    };
  },
  retryDetail: ({ ownerId }: { ownerId: string }) => {
    held.retried.push(ownerId);
  },
}));
vi.mock("./ZeropsAccountData", () => ({
  useAccountDataOptional: () => account,
  useProjection: (_projection: unknown, key: unknown, fallback: unknown) =>
    key === null ? fallback : held.view,
}));
import { useStopPublicAccess, useStopPublicAccesses } from "./useStopPublicAccess";

afterEach(() => {
  held.ids = [];
  held.demanded = [];
  held.retried = [];
  held.renewals = 0;
  held.again = [];
  held.view = null;
});

const data = { projectRef: (_org: string, id: string) => project(id) } as ZeropsDataContextValue;

it("holds each drawn stop's routing and deployment, and lets go of the one no longer drawn", async () => {
  function Stops({ ids }: { ids: string[] }) {
    useStopPublicAccesses(ids);
    return null;
  }
  const render = (ids: string[]) => (
    <ZeropsDataContext.Provider value={data}>
      <Stops ids={ids} />
    </ZeropsDataContext.Provider>
  );
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(render(["production", "stage"]));
  });
  expect(held.ids).toEqual(["production", "stage"]);
  expect(held.demanded).toEqual(["publicRouting:production", "publicRouting:stage"]);
  await act(async () => {
    tree.update(render(["stage"]));
  });
  expect(held.ids).toEqual(["stage"]);
  expect(held.demanded).toEqual(["publicRouting:stage"]);
  await act(async () => {
    tree.unmount();
  });
  expect(held.demanded).toEqual([]);
});

it.each([
  { denied: false, renewals: 0, again: [] },
  { denied: true, renewals: 1, again: ["stage"] },
])(
  "Again reads the routing anew; a denial first asks for access: $denied",
  async ({ denied, renewals, again }) => {
    held.view = { routes: [], offers: [], state: "failed", denied };
    const reads: Array<ReturnType<typeof useStopPublicAccess>> = [];
    function Stop() {
      reads.push(useStopPublicAccess("stage"));
      return null;
    }
    await act(async () => {
      create(
        <ZeropsDataContext.Provider value={data}>
          <Stop />
        </ZeropsDataContext.Provider>,
      );
    });
    expect(reads.at(-1)).toMatchObject({ bound: true, access: { state: "failed" } });
    await act(async () => {
      reads.at(-1)?.again();
    });
    expect(held.retried).toEqual(["stage"]);
    expect(held.renewals).toBe(renewals);
    expect(held.again).toEqual(again);
  },
);
