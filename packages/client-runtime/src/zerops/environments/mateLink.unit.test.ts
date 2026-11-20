import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { initialEnvironment, type EnvironmentMachine } from "./environmentMachine.ts";
import { rowTarget } from "./mateLink.ts";

const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");

/** Another project's Mate, its credential held in this tab. */
const otherHolding: EnvironmentMachine = {
  ...initialEnvironment({ record: ENV_B }),
  credential: {
    kind: "held",
    environmentId: ENV_B,
    installed: true,
    staleBlock: false,
    rereading: null,
  },
};

/** This project's Mate, remembered from an earlier session. */
const ownRemembered = initialEnvironment({ record: ENV_A });

// witness: packages/client-runtime/src/zerops/environments/mateLink.ts | target !== projectId && targetProject(target) === projectId → target !== projectId
it("EN+8: A project's row links only to its own Mate's machine, never to another project's Mate", () => {
  // The row of a project whose services are not read stands for the whole project (its id).
  const row = { key: "project-1", projectId: "project-1" };

  expect(
    rowTarget({ ...row, machines: new Map([["project-2:service-9", otherHolding]]) }),
  ).toBeUndefined();
  expect(
    rowTarget({
      ...row,
      machines: new Map([
        ["project-2:service-9", otherHolding],
        ["project-1:service-1", ownRemembered],
      ]),
    }),
  ).toBe("project-1:service-1");
});
