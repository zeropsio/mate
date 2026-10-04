import { RegistryContext } from "@effect/atom-react";
import {
  initialGrant,
  type AccessGrantView,
  type Evidence,
  type RuntimeInterestDescriptor,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { create } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";
import { project } from "./__fixtures__/platformData";
import { useChangeReviewOffers } from "./useChangeReviewOffers";

const held = vi.hoisted(() => ({
  of: () => ({ read: true, comment: true, merge: false, close: true, redeploy: false }),
}));
vi.mock("./useChangeOffers", () => ({ useChangeOffers: () => held.of }));
vi.mock("../state/zerops", () => ({
  hqPlacementsAtom: Atom.make(new Map([["project-1", { appId: "app" }]])),
}));
vi.mock("./sessionContext", () => ({
  useZeropsSessionOptional: () => ({ activeOrganization: { id: "org-1" } }),
}));
const rig = vi.hoisted(() => ({ context: null as unknown }));
vi.mock("./zeropsDataContext", () => ({ useZeropsData: () => rig.context }));

it("demands the open review's projects once, ends a failed read visibly, and Again asks once", async () => {
  const registry = AtomRegistry.make();
  const ref = project();
  const machine = initialGrant({ online: true, hidden: false }, { wall: 0, mono: 0 });
  const view = Atom.make<AccessGrantView>({ machine, failure: null, overdue: false });
  const demands: RuntimeInterestDescriptor[][] = [];
  const signal = vi.fn(() => Effect.void);
  rig.context = {
    projectRef: () => ref,
    runtime: {
      acquireMany: (descriptors: RuntimeInterestDescriptor[]) =>
        Effect.sync(() => {
          demands.push(descriptors);
          return descriptors.map(() => Result.succeed({ release: Effect.void }));
        }),
      access: { view, signal },
    },
  };
  const seen: Array<ReturnType<typeof useChangeReviewOffers>> = [];
  const offers = () => seen.at(-1)!;
  function Probe() {
    seen.push(useChangeReviewOffers("app"));
    return null;
  }
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <RegistryContext.Provider value={registry}>
        <Probe />
      </RegistryContext.Provider>,
    );
  });
  expect(offers().reason).toBe("Checking project access…");
  expect(demands).toEqual([[{ kind: "project-access", project: ref }]]);
  const evidence: Evidence = {
    account: { round: 1, organizations: [], startedAt: { wall: 0, mono: 0 } },
    projects: new Map(),
    closedProjects: new Map(),
    unverified: new Map([
      [ref.projectId, { project: ref, failure: { kind: "server", status: 503 }, dueAt: null }],
    ]),
  };
  await act(async () => {
    registry.set(view, {
      machine: {
        ...machine,
        phase: {
          phase: "granted",
          failure: null,
          evidence,
          renewal: { status: "idle", dueAt: { wall: 0, mono: 0 } },
        },
      },
      failure: null,
      overdue: false,
    });
  });
  expect(offers().reason).toContain("503");
  expect(offers().again).toBeTypeOf("function");
  await act(async () => {
    offers().again!();
  });
  expect(signal).toHaveBeenCalledTimes(1);
  expect(signal).toHaveBeenCalledWith({ type: "USER_RETRY" });
  expect(demands).toHaveLength(1);
  act(() => tree!.unmount());
});
