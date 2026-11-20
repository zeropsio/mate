import { expect, it } from "vite-plus/test";

import { deployStateOf } from "./crewDeployState.ts";

// witness: apps/server/src/zerops/crew/crewDeployState.ts | if (typeof status !== "string") return "unknown"; → if (typeof status !== "string") continue;
it("CM34: A crew host's deploy still runs while a platform process touching its service by id or by name has not ended; an ended or failed one settles it, and a process without a status is unknown, never settled", () => {
  const service = { host: "appdev", serviceId: "svc-app" };
  const state = (processes: ReadonlyArray<unknown>) => deployStateOf(processes, service);
  expect(state([{ serviceStackId: "svc-other", status: "RUNNING" }])).toBe("settled");
  expect(state([{ serviceStackId: "svc-app", status: "RUNNING" }])).toBe("running");
  expect(state([{ serviceStacks: [{ id: "svc-app" }], status: "PENDING" }])).toBe("running");
  expect(state([{ serviceStackId: "svc-app", status: "FINISHED" }])).toBe("settled");
  expect(state([{ serviceStackName: "appdev", status: "FAILED" }])).toBe("settled");
  expect(state([{ serviceStacks: [{ name: "appdev" }], status: "RUNNING" }])).toBe("running");
  expect(state([{ serviceStackId: "svc-app" }])).toBe("unknown");
});
