import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { makeAccountStore } from "../store.ts";
import { hqMateRefusal } from "./hqMates.ts";

const key = (projectId: string) => ({ orgId: "org", projectId });

// witness: packages/client-runtime/src/data/projections/hqMates.ts | const byId = people.get(reason)?.name; → const byId = undefined;
it("PJ11: A Chief refusal that gives its owner's Zerops user id names that person from the organization's member list, and somebody the list does not hold as another person", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  seedHqNavigation(store, "org", { mates: {}, people: { "u-karlos": { name: "Karlos" } } });
  const refuse = (projectId: string, reason: string) =>
    store.dispatch({
      kind: "stream",
      key: hqMateScope("org", projectId),
      now: 100,
      event: {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "definitive-refusal", code: "chief_owner_required", message: reason },
      },
    });
  refuse("karlos-chief", "u-karlos");
  refuse("stranger-chief", "u-stranger");
  expect(registry.get(store.data.project(hqMateRefusal, key("karlos-chief")))).toEqual({
    kind: "refused-role",
    chiefOwnerName: "Karlos",
  });
  expect(registry.get(store.data.project(hqMateRefusal, key("stranger-chief")))).toEqual({
    kind: "refused-role",
    chiefOwnerName: "another person",
  });
  registry.dispose();
});

// witness: packages/client-runtime/src/data/projections/hqMates.ts | stream.phase === "refused" && stream.fault?.code === "chief_owner_required" → stream.phase === "refused"
it("PJ41: A generic refusal or a transient error from HQ does not claim who owns a Chief", () => {
  const faults = [
    { outcome: "definitive-refusal", code: "forbidden" },
    { outcome: "definitive-refusal", code: undefined },
    { outcome: "transient", code: "chief_owner_required" },
  ] as const;
  for (const fault of faults) {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    store.dispatch({
      kind: "stream",
      key: hqMateScope("org", "hidden-chief"),
      now: 100,
      event: {
        kind: "fault",
        jitter: 0,
        fault: {
          outcome: fault.outcome,
          ...(fault.code === undefined ? {} : { code: fault.code }),
          message: "Karlos",
        },
      },
    });
    expect(registry.get(store.data.project(hqMateRefusal, key("hidden-chief")))).toBeNull();
    registry.dispose();
  }
});
