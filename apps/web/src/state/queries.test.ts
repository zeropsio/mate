import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { areProjectPathSearchTargetsEqual, connectedEnvironmentIds } from "./queries";

describe("areProjectPathSearchTargetsEqual", () => {
  const target = {
    environmentId: EnvironmentId.make("environment-a"),
    cwd: "/project-a",
    query: "index",
  };

  it("requires the environment, workspace, query, entry kind, and image filter to match", () => {
    expect(areProjectPathSearchTargetsEqual(target, target)).toBe(true);
    expect(
      areProjectPathSearchTargetsEqual(target, {
        ...target,
        environmentId: EnvironmentId.make("environment-b"),
      }),
    ).toBe(false);
    expect(areProjectPathSearchTargetsEqual(target, { ...target, cwd: "/project-b" })).toBe(false);
    expect(areProjectPathSearchTargetsEqual(target, { ...target, query: "readme" })).toBe(false);
    expect(areProjectPathSearchTargetsEqual(target, { ...target, kind: "file" })).toBe(false);
    expect(areProjectPathSearchTargetsEqual(target, { ...target, imageOnly: true })).toBe(false);
  });
});

describe("connectedEnvironmentIds", () => {
  const OPEN = EnvironmentId.make("open-mate");
  const PARKED = EnvironmentId.make("parked-mate");
  const COMING = EnvironmentId.make("coming-mate");
  const UNKNOWN = EnvironmentId.make("unknown-mate");
  const presentations = new Map([
    [OPEN, { connection: { phase: "connected" as const } }],
    [PARKED, { connection: { phase: "available" as const } }],
    [COMING, { connection: { phase: "connecting" as const } }],
  ]);

  it("searches only connected Mates", () => {
    expect(connectedEnvironmentIds([PARKED, OPEN, COMING, UNKNOWN], presentations)).toEqual([OPEN]);
  });
});
