import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { placementFamily, placementsScope } from "../families/hqNavigation.ts";
import { emptyAccount, linkKeys } from "../model.ts";
import { readsOfState, makeAccountStore } from "../store.ts";
import { hqMateSetup } from "./hqMateSetup.ts";

describe("hqMateSetup", () => {
  it("keeps a Mate absent from navigation unknown", () => {
    expect(
      hqMateSetup.derive(readsOfState(emptyAccount), { orgId: "org", projectId: "Ada" }),
    ).toEqual({ closedOff: "unknown", marker: "unknown" });
  });
  it.each([
    { name: "missing Mate fields", mate: undefined },
    { name: "missing setup fields", mate: { face: "" } },
    {
      name: "unreadable setup fields",
      mate: { face: "", closedOff: "damaged", setupMarker: "damaged" },
    },
  ])("$name leaves setup unknown", ({ mate }) => {
    const store = makeAccountStore(AtomRegistry.make());
    seedHqNavigation(store, "org", {
      structure: { apps: [], ungrouped: [] },
    });
    const scope = placementsScope("org");
    const value = placementFamily.hq!.decode({ projectId: "Ada", mate }, "project:Ada");
    expect(value).not.toBeNull();
    store.dispatch({
      kind: "hq-delivery",
      scopes: [{ scope, generation: store.state().streams.get(scope)!.generation }],
      reset: false,
      rows: [
        {
          family: "placement",
          id: "Ada",
          value: value!,
          revision: { kind: "hq", incarnation: "seed", revision: 1_000_000 },
        },
      ],
      removals: [],
    });
    expect(
      hqMateSetup.derive(readsOfState(store.state()), { orgId: "org", projectId: "Ada" }),
    ).toEqual({ closedOff: "unknown", marker: "unknown" });
  });
  it.each([
    { name: "present marker", marker: true, closedOff: false },
    { name: "absent marker", marker: false, closedOff: false },
    { name: "unanswered marker", marker: null, closedOff: false },
    { name: "finished setup", marker: true, closedOff: true },
  ])("$name survives outage, partial coverage and source refusal", ({ marker, closedOff }) => {
    const store = makeAccountStore(AtomRegistry.make());
    seedHqNavigation(store, "org", {
      structure: {
        apps: [],
        ungrouped: [
          { projectId: "Ada", name: "Ada", mate: { face: "", closedOff, setupMarker: marker } },
        ],
      },
    });
    const read = () =>
      hqMateSetup.derive(readsOfState(store.state()), { orgId: "org", projectId: "Ada" });
    expect(read()).toEqual({ closedOff, marker: marker ?? "unknown" });
    expect(
      hqMateSetup.derive(readsOfState(store.state()), { orgId: "another-org", projectId: "Ada" }),
    ).toEqual({ closedOff: "unknown", marker: "unknown" });
    const scope = placementsScope("org");
    const generation = store.state().streams.get(scope)!.generation;
    store.dispatch({
      kind: "hq-delivery",
      scopes: [{ scope, generation }],
      reset: true,
      rows: [],
      removals: [],
    });
    expect(read()).toEqual({ closedOff, marker: marker ?? "unknown" });
    store.dispatch({
      kind: "stream",
      key: linkKeys.hq("org"),
      now: 1,
      event: { kind: "fault", fault: { outcome: "transient", message: "outage" }, jitter: 0 },
    });
    expect(read()).toEqual({
      closedOff: closedOff ? true : "unknown",
      marker: marker ?? "unknown",
    });
    store.dispatch({
      kind: "stream",
      key: scope,
      now: 2,
      event: {
        kind: "fault",
        fault: { outcome: "definitive-refusal", message: "refused" },
        jitter: 0,
      },
    });
    expect(read()).toEqual({
      closedOff: closedOff ? true : "unknown",
      marker: marker ?? "unknown",
    });
    store.dispatch({ kind: "access", family: "placement", id: "Ada", access: "denied" });
    expect(read()).toEqual({ closedOff: "unknown", marker: "unknown" });
  });
});
