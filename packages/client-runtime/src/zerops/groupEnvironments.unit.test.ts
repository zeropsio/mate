import { expect, it } from "vite-plus/test";
import { environmentSlots, halfMadeGroupEnvironments } from "./groupEnvironments.ts";

// witness: packages/client-runtime/src/zerops/groupEnvironments.ts | if (input.operating?.(membership.groupId) === true) continue; → if (input.operating?.(membership.groupId) === false) continue;
it("ZV164: A stage of an application whose environment operation is open is not half made, and the same stage is once none is open; breaks: Finish setting up is offered beside a stage being added, and a second start is refused as operation_in_flight", () => {
  const input = {
    projects: [
      {
        id: "p-stage",
        name: "shop - stage",
        hq: { appId: "shop", appName: "Shop", kind: "stage" as const, mate: null },
      },
    ],
    registry: { groups: [{ groupId: "shop", name: "Shop", projects: [] }] },
    environments: new Map([["shop", []]]),
    mayKey: () => true,
  };
  expect(halfMadeGroupEnvironments({ ...input, operating: (appId) => appId === "shop" })).toEqual(
    [],
  );
  expect(halfMadeGroupEnvironments({ ...input, operating: () => false })).toEqual([
    {
      groupId: "shop",
      projectId: "p-stage",
      projectName: "shop - stage",
      tier: "stage",
      registered: false,
    },
  ]);
});

const productionSlot = (
  facts: Partial<Parameters<typeof environmentSlots>[0]>,
): Extract<ReturnType<typeof environmentSlots>[number], { kind: "slot" }> | undefined =>
  environmentSlots({
    environments: [],
    devstages: [],
    pending: [],
    recipeRead: true,
    recipeTiers: ["production"],
    offered: { stage: true, production: true },
    merged: [{ kind: "recipe" }],
    pullRequests: [],
    changesKnown: true,
    halfMade: [],
    productionRuns: "unknown",
    waiting: { count: 0, atLeast: false },
    mainHasCode: undefined,
    releaseOffered: false,
    releasing: undefined,
    ...facts,
  }).find(
    (row): row is Extract<typeof row, { kind: "slot" }> =>
      row.kind === "slot" && row.tier === "production",
  );

// witness: packages/client-runtime/src/zerops/groupEnvironments.ts | facts.changesKnown === true && → facts.changesKnown !== undefined &&
it("ZV167: A production slot says a code change unlocks Put it live only where HQ offers production, the setup files hold it and HQ's read changes hold no code; breaks: the page hides the verb with no way on, or names a change that is already there or not yet read", () => {
  expect(productionSlot({})?.add).toBe(false);
  expect(productionSlot({})?.unlock).toBeDefined();
  expect(productionSlot({ changesKnown: false })?.unlock).toBeUndefined();
  expect(productionSlot({ offered: { stage: true, production: false } })?.unlock).toBeUndefined();
  expect(productionSlot({ productionOutside: true })?.unlock).toBeUndefined();
  const coded = productionSlot({ pullRequests: [{ kind: "code" }] });
  expect(coded?.add).toBe(true);
  expect(coded?.unlock).toBeUndefined();
});
