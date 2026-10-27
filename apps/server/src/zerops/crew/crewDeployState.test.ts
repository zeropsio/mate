import { assert, describe, it } from "@effect/vitest";

import { deployStateOf, type DeployState } from "./crewDeployState.ts";

const APPDEV = { host: "appdev", serviceId: "svc-app" };

describe("deployStateOf", () => {
  const cases: ReadonlyArray<readonly [string, ReadonlyArray<unknown>, DeployState]> = [
    [
      "no process touches the service",
      [{ serviceStackId: "svc-other", status: "RUNNING" }],
      "settled",
    ],
    ["its deploy runs", [{ serviceStackId: "svc-app", status: "RUNNING" }], "running"],
    [
      "its deploy waits to start",
      [{ serviceStacks: [{ id: "svc-app" }], status: "PENDING" }],
      "running",
    ],
    ["its deploy ended", [{ serviceStackId: "svc-app", status: "FINISHED" }], "settled"],
    ["its deploy failed", [{ serviceStackName: "appdev", status: "FAILED" }], "settled"],
    [
      "named by its host alone",
      [{ serviceStacks: [{ name: "appdev" }], status: "RUNNING" }],
      "running",
    ],
    ["a process with no status", [{ serviceStackId: "svc-app" }], "unknown"],
  ];
  it.each(
    Array.from(cases, ([title, processes, expected]) => ({
      testTitle: title,
      processes,
      expected,
    })),
  )("$testTitle", ({ processes, expected }) => {
    assert.strictEqual(deployStateOf(processes, APPDEV), expected);
  });
});
