import { describe, expect, it } from "vite-plus/test";
import processFixture from "../../zerops/__fixtures__/z3-eval.process.json" with { type: "json" };
import { processFamily } from "./process.ts";

describe("the process family", () => {
  it("reads a whole process row as the surfaces read a process, its version beside it", () => {
    const captured = processFixture.list[3]!;
    expect(
      processFamily.zerops!.decode({
        ...captured,
        status: "FAILED",
        publicMeta: { failReason: "build failed" },
        _version: 4,
        appVersion: { ...captured.appVersion!, status: "BUILD_FAILED" },
      }),
    ).toEqual({
      id: "TEST000000000000000009",
      version: 4,
      value: {
        id: "TEST000000000000000009",
        projectId: "TEST000000000000000023",
        serviceStackIds: ["TEST000000000000000005", "TEST000000000000000022"],
        status: "FAILED",
        actionName: "stack.build",
        created: "2026-09-03T14:14:16.636Z",
        started: "2026-09-03T14:14:16.679Z",
        finished: "2026-09-03T14:15:23.058Z",
        appVersion: {
          id: "TEST000000000000000027",
          name: "sample-service",
          status: "BUILD_FAILED",
          created: "2026-09-03T14:14:16Z",
          source: "CLI",
          activationDate: "2026-09-03T14:15:20.621367472Z",
          build: {
            pipelineStart: "2026-09-03T14:14:16.824671109Z",
            startDate: "2026-09-03T14:14:27.140086848Z",
            endDate: "2026-09-03T14:14:27.911363525Z",
            serviceStackId: "TEST000000000000000022",
            pipelineFinish: "2026-09-03T14:15:20.570792797Z",
            containerCreationStart: "2026-09-03T14:14:19.164292357Z",
            serviceStackName: "buildweatherdashv1788444856",
          },
        },
        failReason: "build failed",
      },
    });
  });
});
