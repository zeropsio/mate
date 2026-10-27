import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { seedHqNavigation } from "../../data/__fixtures__/hqNavigation.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import { makeAccountStore } from "../../data/store.ts";
import { followHqView, hqViewStep, type HqViewChange, type HqViewFrame } from "./hqView.ts";

/** Each change the frames make, in order, as the follower hears them one by one. */
const hqViewChanges = (frames: ReadonlyArray<HqViewFrame>): ReadonlyArray<HqViewChange> => {
  let last: HqViewFrame | null = null;
  const changes: HqViewChange[] = [];
  for (const frame of frames) {
    const step = hqViewStep(last, frame);
    last = step.last;
    if (step.change !== null) changes.push(step.change);
  }
  return changes;
};

const live = (orgId: string, ...placed: string[]): HqViewFrame => ({ orgId, live: true, placed });
const down = (orgId: string, ...placed: string[]): HqViewFrame => ({
  orgId,
  live: false,
  placed,
});

describe("HQ's view of the person", () => {
  it.each([
    {
      name: "a Mate entering",
      frames: [live("org", "p1"), live("org", "p1", "p2"), live("org", "p1", "p2")],
      changes: [{ orgId: "org", entered: ["p2"], left: [] }],
    },
    {
      name: "a Mate leaving",
      frames: [live("org", "p1", "p2"), live("org", "p1"), live("org", "p1")],
      changes: [{ orgId: "org", entered: [], left: ["p2"] }],
    },
    {
      name: "a Mate leaving while HQ reconnects",
      frames: [live("org", "p1", "p2"), down("org"), live("org", "p1")],
      changes: [{ orgId: "org", entered: [], left: ["p2"] }],
    },
  ])(
    "a Mate entering or leaving HQ's view of the person reads the organization's Zerops projects again, once: $name",
    ({ frames, changes }) => {
      expect(hqViewChanges(frames)).toEqual(changes);
    },
  );

  it.each([
    { name: "HQ's first answer", frames: [down("org"), live("org", "p1")] },
    {
      name: "HQ reconnecting with the same Mates",
      frames: [live("org", "p1"), down("org"), live("org", "p1")],
    },
    { name: "another organization shown", frames: [live("org", "p1"), live("other", "p9")] },
    {
      name: "the same Mates, whatever Zerops lists",
      frames: [live("org", "p1"), live("org", "p1")],
    },
  ])("a Mate HQ never placed does not make the listing read again: $name", ({ frames }) => {
    expect(hqViewChanges(frames)).toEqual([]);
  });

  it("HQ placing a Mate in the organization shown is heard once, and a project it lists without a Mate never", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: "org",
      demandDetail: () => () => undefined,
      renewHeld: () => undefined,
    });
    const placed = (...mates: string[]) =>
      seedHqNavigation(store, "org", {
        structure: {
          apps: [
            {
              id: "shop",
              name: "Shop",
              projects: [{ projectId: "plain", name: "plain", kind: "app", mate: null }],
              environments: [],
            },
          ],
          ungrouped: mates.map((projectId) => ({ projectId, name: projectId, mate: { face: "" } })),
        },
      });
    placed("p1");
    const heard: HqViewChange[] = [];
    const stop = followHqView(registry, (change) => heard.push(change));

    placed("p1", "p2");
    placed("p1", "p2");
    stop();
    placed("p1");

    expect(heard).toEqual([{ orgId: "org", entered: ["p2"], left: [] }]);
  });
});
