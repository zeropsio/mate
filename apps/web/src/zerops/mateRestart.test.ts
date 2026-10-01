import { describe, expect, it } from "vite-plus/test";

import { restartMateContainer, restartWay } from "./mateRestart";

describe("restartWay", () => {
  it.each([
    { status: "ACTIVE", way: "restart" },
    { status: "STOPPED", way: "restart" },
    { status: "FAILED", way: "stop-then-start" },
    { status: "ACTION_FAILED", way: "stop-then-start" },
    { status: "SERVICE_CONTAINER_FAILED", way: "stop-then-start" },
    { status: undefined, way: "restart" },
  ])("restarts a $status container by $way", ({ status, way }) => {
    expect(restartWay(status)).toBe(way);
  });
});

describe("restartMateContainer", () => {
  function platform(stopStatuses: ReadonlyArray<string>) {
    const calls: Array<string> = [];
    let reads = 0;
    return {
      calls,
      ports: {
        restart: async () => {
          calls.push("restart");
        },
        stop: async () => {
          calls.push("stop");
          return { processId: "process-stop" };
        },
        processStatus: async () => {
          const status = stopStatuses[reads] ?? stopStatuses.at(-1);
          reads += 1;
          calls.push(`read:${status}`);
          return status;
        },
        start: async () => {
          calls.push("start");
        },
        sleep: async () => undefined,
      },
    };
  }

  it("restarts a container that has not failed, as it always did", async () => {
    const { calls, ports } = platform([]);
    await restartMateContainer("ACTIVE", ports);
    expect(calls).toEqual(["restart"]);
  });

  it("stops a FAILED container, waits for the stop, then starts it", async () => {
    // The platform refuses a restart with `serviceStackIsFailed`: "Try to stop the stack and then
    // start it again" (three Mates after a platform outage, 2026-10-01).
    const { calls, ports } = platform(["PENDING", "RUNNING", "FINISHED"]);
    await restartMateContainer("FAILED", ports);
    expect(calls).toEqual(["stop", "read:PENDING", "read:RUNNING", "read:FINISHED", "start"]);
  });

  it("starts it after a stop that failed too: the start is what brings it back", async () => {
    const { calls, ports } = platform(["FAILED"]);
    await restartMateContainer("FAILED", ports);
    expect(calls).toEqual(["stop", "read:FAILED", "start"]);
  });

  it("starts it once the wait for the stop is spent, rather than waiting for ever", async () => {
    const { calls, ports } = platform(["RUNNING"]);
    await restartMateContainer("FAILED", ports);
    expect(calls.at(-1)).toBe("start");
    expect(calls.filter((call) => call.startsWith("read:")).length).toBeGreaterThan(1);
  });
});
