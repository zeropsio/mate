import { expect, it } from "vite-plus/test";
import { halfMadeGroupEnvironments } from "./groupEnvironments.ts";

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
