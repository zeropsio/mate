import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { zeropsCardIdentity } from "./identity.ts";
import * as Payloads from "./payloads.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("zeropsCardIdentity", () => {
  it("returns the sessionId-keyed identity for a decodable plan with a sessionId", () => {
    expect(
      zeropsCardIdentity({
        zeropsResult: {
          toolName: "zerops_workflow",
          resultText: JSON.stringify({
            sessionId: "s1",
            progress: { completed: 1, total: 3, steps: [] },
          }),
        },
      }),
    ).toBe("plan:s1");
  });

  it("returns undefined for a plan with no sessionId (route-discovery)", () => {
    expect(
      zeropsCardIdentity({
        zeropsResult: {
          toolName: "zerops_workflow",
          resultText: JSON.stringify({ progress: { completed: 0, total: 1, steps: [] } }),
        },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a non-plan card (e.g. deploy)", () => {
    expect(
      zeropsCardIdentity({
        zeropsResult: {
          toolName: "zerops_deploy",
          resultText: JSON.stringify({ status: "DEPLOYED", targetService: "api" }),
        },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a pending entry (no resultText)", () => {
    expect(zeropsCardIdentity({ zeropsResult: { toolName: "zerops_workflow" } })).toBeUndefined();
  });

  it("returns undefined for a failed entry (decodes to the error card)", () => {
    expect(
      zeropsCardIdentity({
        toolLifecycleStatus: "failed",
        zeropsResult: {
          toolName: "zerops_workflow",
          resultText: JSON.stringify({ code: "SOME_ERROR", error: "boom" }),
        },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a non-JSON result", () => {
    expect(
      zeropsCardIdentity({
        zeropsResult: { toolName: "zerops_workflow", resultText: "workflow is running" },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for an absent entry", () => {
    expect(zeropsCardIdentity(undefined)).toBeUndefined();
    expect(zeropsCardIdentity(null)).toBeUndefined();
  });

  it("returns undefined for an entry with no zeropsResult", () => {
    expect(zeropsCardIdentity({})).toBeUndefined();
  });

  it("decodes the same entry object once", () => {
    const decode = vi.spyOn(Payloads, "decodeZeropsCard");
    const entry = {
      zeropsResult: {
        toolName: "zerops_workflow",
        resultText: JSON.stringify({
          sessionId: "s1",
          progress: { completed: 1, total: 3, steps: [] },
        }),
      },
    };

    expect(zeropsCardIdentity(entry)).toBe("plan:s1");
    expect(zeropsCardIdentity(entry)).toBe("plan:s1");
    expect(decode).toHaveBeenCalledTimes(1);
  });
});
