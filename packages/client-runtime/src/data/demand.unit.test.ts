import { it, expect } from "vite-plus/test";
import { makeDetailDemands } from "./demand.ts";

// witness: packages/client-runtime/src/data/demand.ts | if (released) return; → if (released && !holds.has(scope)) return;
it("ST36: A detail scope is demanded at its first hold and let go only at its last release; a second release of one hold lets nothing go", () => {
  const said: Array<readonly [string, boolean]> = [];
  const demands = makeDetailDemands({ demanded: (scope, on) => said.push([scope, on]) });
  const first = demands.hold("zerops:org:history:p1");
  expect(said).toEqual([["zerops:org:history:p1", true]]);
  const second = demands.hold("zerops:org:history:p1");
  expect(demands.scopes()).toEqual(["zerops:org:history:p1"]);

  first();
  first();
  expect(demands.scopes()).toEqual(["zerops:org:history:p1"]);
  second();
  expect(demands.scopes()).toEqual([]);
  expect(said).toEqual([
    ["zerops:org:history:p1", true],
    ["zerops:org:history:p1", false],
  ]);
});
