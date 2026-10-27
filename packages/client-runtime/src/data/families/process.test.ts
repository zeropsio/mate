import { describe, expect, it } from "vite-plus/test";

import { processFamily } from "./process.ts";

const decode = processFamily.zerops!.decode;

describe("the process family", () => {
  it("reads a whole process row as the surfaces read a process, its version beside it", () => {
    expect(
      decode({
        id: "q1",
        projectId: "p1",
        serviceStackId: "s1",
        serviceStacks: [{ id: "s2" }],
        status: "FAILED",
        actionName: "stack.deploy",
        created: "2026-10-05T18:49:09Z",
        started: "2026-10-05T18:49:10Z",
        finished: "2026-10-05T18:50:00Z",
        appVersion: {
          id: "v1",
          name: "abc",
          status: "BUILD_FAILED",
          build: { serviceStackId: "b1" },
        },
        publicMeta: { failReason: "build failed" },
        _version: 4,
      }),
    ).toEqual({
      id: "q1",
      version: 4,
      value: {
        id: "q1",
        projectId: "p1",
        serviceStackIds: ["s1", "s2"],
        status: "FAILED",
        actionName: "stack.deploy",
        created: "2026-10-05T18:49:09Z",
        started: "2026-10-05T18:49:10Z",
        finished: "2026-10-05T18:50:00Z",
        appVersion: {
          id: "v1",
          name: "abc",
          status: "BUILD_FAILED",
          build: { serviceStackId: "b1" },
        },
        failReason: "build failed",
      },
    });
  });

  it.each([
    {
      name: "without its project",
      row: { id: "q1", status: "RUNNING", actionName: "a", created: "t" },
    },
    { name: "not an object", row: "q1" },
  ])("refuses a row $name", ({ row }) => {
    expect(decode(row)).toBeNull();
  });
});
