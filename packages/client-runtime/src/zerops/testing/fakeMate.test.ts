import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeFakeMate } from "./fakeMate.ts";

const ORIGIN = "https://zcp-1-abc.prg1.zerops.app";
const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");
const PREPARE = { httpBaseUrl: `${ORIGIN}/mate`, doorToken: "throwaway" };

describe("FakeMate", () => {
  it("answers the door as scripted, then admits", async () => {
    const mate = makeFakeMate({ origin: ORIGIN, projectId: "p", environmentId: ENV_A });
    mate.scriptDoor("500", "read-only");
    const answers = [
      await mate.prepare(PREPARE),
      await mate.prepare(PREPARE),
      await mate.prepare(PREPARE),
    ];
    expect(answers.map((answer) => answer._tag)).toEqual(["Failure", "Failure", "Success"]);
    expect(mate.doorCalls()).toHaveLength(3);
  });

  it("rejects every credential issued before a revocation, and none after", async () => {
    const mate = makeFakeMate({ origin: ORIGIN, projectId: "p", environmentId: ENV_A });
    const first = await mate.prepare(PREPARE);
    if (first._tag !== "Success") throw new Error("not admitted");
    expect(mate.socket(first.value)).toEqual({ phase: "connected" });
    mate.revokeSessions();
    expect(mate.socket(first.value)).toEqual({ phase: "blocked", reason: "authentication" });
    const second = await mate.prepare(PREPARE);
    if (second._tag !== "Success") throw new Error("not admitted");
    expect(mate.socket(second.value)).toEqual({ phase: "connected" });
  });

  it("blocks a credential for a replaced environment on configuration", async () => {
    const mate = makeFakeMate({ origin: ORIGIN, projectId: "p", environmentId: ENV_A });
    const issued = await mate.prepare(PREPARE);
    if (issued._tag !== "Success") throw new Error("not admitted");
    mate.redeploy(ENV_B);
    expect(mate.socket(issued.value)).toEqual({ phase: "blocked", reason: "configuration" });
    expect((await mate.readDescriptor(PREPARE.httpBaseUrl)).environmentId).toBe(ENV_B);
  });

  it("answers as a 0.11.0 server in old-server mode: no identity, no update", async () => {
    const mate = makeFakeMate({
      origin: ORIGIN,
      projectId: "p",
      environmentId: ENV_A,
      oldServer: true,
    });
    const descriptor = await mate.readDescriptor(PREPARE.httpBaseUrl);
    expect(descriptor.serverVersion).toBe("0.11.0");
    expect(descriptor.zerops).toEqual({ projectId: "p" });
    expect(descriptor.update).toBeUndefined();
  });

  it("stops answering while unreachable", async () => {
    const mate = makeFakeMate({ origin: ORIGIN, projectId: "p", environmentId: ENV_A });
    mate.setReachable(false);
    expect(mate.healthz()).toBe("unreachable");
    await expect(mate.readDescriptor(PREPARE.httpBaseUrl)).rejects.toMatchObject({
      _tag: "ConnectionTransientError",
    });
    expect(mate.descriptorReads()).toBe(1);
  });
});
