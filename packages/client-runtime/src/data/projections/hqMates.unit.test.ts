import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { recorded } from "../__fixtures__/recorded.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { hqAppFamily, placementFamily, placementsScope } from "../families/hqNavigation.ts";
import { makeAccountStore } from "../store.ts";
import { hqMateLinkRefusal, hqMateRefusal, hqMateState } from "./hqMates.ts";

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
  recorded("scope-values", "mate-hq/navigation.birth.link-refused")
    .values.filter((v) => v.key.startsWith("app:"))
    .flatMap((v) => hqAppFamily.hq!.decode(v.value, v.key.slice("app:".length))?.births ?? []);

// witness: packages/client-runtime/src/data/projections/hqMates.ts | if (birth.projectId === projectId) births.push(birth); → births.push(birth);
it("PJ154: A new Mate's refused link is what HQ put on its own project's open birth, and nothing where its birth carries none or only another project's does; breaks: a refused Mate's page waits as coming forever, or a Mate that is coming reads another Mate's refusal", () => {
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
    { code: "key_refused", at: "v14" },
    null,
    null,
  ]);
  registry.dispose();
});

// witness: packages/client-runtime/src/data/projections/hqMates.ts | : { state: mate.state, since: mate.stateSince, why: mate.stateWhy }; → : { state: mate.state, since: mate.bornAt, why: mate.stateWhy };
it("PJ+1: A Mate's state is the one HQ's navigation names for it, with its since and why, a state this build does not know answering itself, and nothing where HQ names none; breaks: a Mate that cannot work reads as one that can, or a state a later HQ names takes the Mate's row away", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  seedHqNavigation(store, "org", {
    structure: { apps: [], ungrouped: [{ projectId: "plain", name: "Plain", mate: { face: "" } }] },
  });
  const frame = recorded("scope-reset", "mate-hq/navigation.mate.cannot-run");
  const project = frame.values.find(
    (v) =>
      v.key.startsWith("project:") &&
      placementFamily.hq!.decode(v.value, v.key)?.mate?.state === "cannot_run",
  )!;
  const recordedId = project.key.slice("project:".length);
  const placed = placementFamily.hq!.decode(project.value, project.key)!;
  const later = placementFamily.hq!.decode(
    {
      ...placed,
      projectId: "later",
      mate: { ...placed.mate, state: "resting", stateWhy: "a_new_why" },
    },
    "project:later",
  )!;
  const scope = placementsScope("org");
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope, generation: store.state().streams.get(scope)?.generation ?? 0 }],
    reset: false,
    rows: [
      {
        family: "placement",
        id: recordedId,
        revision: { kind: "hq", incarnation: "rec", revision: 1 },
        value: placed,
      },
      {
        family: "placement",
        id: "later",
        revision: { kind: "hq", incarnation: "rec", revision: 1 },
        value: later,
      },
    ],
    removals: [],
  });
  const stateOf = (projectId: string) =>
    registry.get(store.data.project(hqMateState, key(projectId)));
  expect([recordedId, "later", "plain"].map(stateOf)).toEqual([
    { state: "cannot_run", since: "2026-11-24T09:01:24.870Z", why: "signed_out" },
    { state: "resting", since: "2026-11-24T09:01:24.870Z", why: "a_new_why" },
    null,
  ]);
  registry.dispose();
});
