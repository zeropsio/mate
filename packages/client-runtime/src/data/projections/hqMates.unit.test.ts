import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { recorded } from "../__fixtures__/recorded.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { hqAppFamily } from "../families/hqNavigation.ts";
import { makeAccountStore } from "../store.ts";
import { hqMateLinkRefusal, hqMateRefusal } from "./hqMates.ts";

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

/** The births HQ's recorded navigation shows on its application, read as the web reads them. */
const recordedBirths = () =>
  recorded("scope-values", "mate-hq/navigation.birth.running")
    .values.filter((v) => v.key.startsWith("app:"))
    .flatMap((v) => hqAppFamily.hq!.decode(v.value, v.key.slice("app:".length))?.births ?? []);

// witness: packages/client-runtime/src/data/projections/hqMates.ts | if (birth.projectId === projectId) births.push(birth); → births.push(birth);
it("PJ+1: A new Mate's refused link is what HQ put on its own project's open birth, and nothing where its birth carries none or only another project's does; breaks: a refused Mate's page waits as coming forever, or a Mate that is coming reads another Mate's refusal", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const refused = recordedBirths().find((birth) => birth.linkRefusal !== undefined)!;
  const quiet = { ...refused, id: "quiet", projectId: "quiet" };
  delete (quiet as { linkRefusal?: unknown }).linkRefusal;
  seedHqNavigation(store, "org", {
    structure: {
      apps: [{ id: "app", name: "Shop", projects: [], births: [refused, quiet] }],
      ungrouped: [],
    },
  });
  const refusalOf = (projectId: string) =>
    registry.get(store.data.project(hqMateLinkRefusal, key(projectId)));
  expect([refused.projectId!, "quiet", "other"].map(refusalOf)).toEqual([
    { code: "key_refused", at: "v17" },
    null,
    null,
  ]);
  registry.dispose();
});
