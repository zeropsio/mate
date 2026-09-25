import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { UsageEnvironmentIdentity } from "../../zerops/usageEnvironmentIdentities";
import { limitsPlaceName } from "./UsageLimits";

describe("limitsPlaceName", () => {
  const environmentId = EnvironmentId.make("env-a");
  const label = "node-id-1.runtime.zcp.zerops";

  it.each<{
    readonly name: string;
    readonly identity: UsageEnvironmentIdentity | undefined;
    readonly place: string;
  }>([
    {
      name: "names the Mate and its project",
      identity: { mateName: "Juno", projectName: "Shop", owner: null },
      place: "Juno · Shop",
    },
    {
      name: "names the Mate alone when its project has no real name",
      identity: { mateName: "Juno", projectName: null, owner: null },
      place: "Juno",
    },
    {
      name: "falls back to the environment's label outside Zerops",
      identity: undefined,
      place: label,
    },
  ])("$name", ({ identity, place }) => {
    const identities = new Map(identity ? [[environmentId, identity]] : []);
    expect(limitsPlaceName(environmentId, identities, label)).toBe(place);
  });
});
