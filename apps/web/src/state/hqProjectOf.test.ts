import type { HqMateIdentity } from "@t3tools/client-runtime/data";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { hqProjectOrRemembered, type HqMatesView } from "./zerops";
import type { MateMemory } from "../zerops/mateIdentityMemory";

const ENV = EnvironmentId.make("env-cyd");
const NAMED: HqMateIdentity = {
  projectId: "Cyd",
  environmentId: ENV,
  fullName: "Cyd",
  name: "Cyd",
  tint: "sky",
  shape: "hexagon",
  project: undefined,
  projectUrl: "https://app.zerops.io/project/Cyd",
};
const remembered: MateMemory = { [ENV]: NAMED };
const view = (mates: HqMatesView["mates"]): HqMatesView => ({
  organizationId: "org",
  mates,
  current: true,
});

describe("the project an environment belongs to", () => {
  it("is the remembered project while navigation precedes the overview that names the environment", () => {
    const awaitingOverview = view(new Map([["Cyd", { identity: undefined }]]) as never);
    expect(hqProjectOrRemembered(awaitingOverview, ENV, remembered)).toBe("Cyd");
  });

  it("is the project the overview names, whatever was remembered", () => {
    const named = view(new Map([["Other", { identity: { environmentId: ENV } }]]) as never);
    expect(hqProjectOrRemembered(named, ENV, remembered)).toBe("Other");
  });

  it("is none where nothing names or remembers the environment", () => {
    expect(hqProjectOrRemembered(view(new Map()), ENV, {})).toBeNull();
  });
});
