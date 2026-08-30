import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { LIVE_DEPLOY_ERROR_RESULT, LIVE_VERIFY_RESULT } from "./liveFixtures.ts";
import { isZeropsMilestone, MILESTONE_KINDS } from "./milestone.ts";
import * as Payloads from "./payloads.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isZeropsMilestone", () => {
  it.each([
    ["ordinary tool", {}, false],
    [
      "deploy",
      {
        zeropsResult: {
          toolName: "zerops_deploy",
          resultText: JSON.stringify({ status: "DEPLOYED", targetService: "kanbandev" }),
        },
      },
      true,
    ],
    [
      "verify",
      { zeropsResult: { toolName: "zerops_verify", resultText: LIVE_VERIFY_RESULT } },
      true,
    ],
    [
      "import",
      {
        zeropsResult: {
          toolName: "zerops_import",
          resultText: JSON.stringify({ processes: [{ service: "api", status: "FINISHED" }] }),
        },
      },
      true,
    ],
    [
      "plan",
      {
        zeropsResult: {
          toolName: "zerops_workflow",
          resultText: JSON.stringify({ progress: { completed: 1, total: 2, steps: [] } }),
        },
      },
      true,
    ],
    [
      "error",
      {
        toolLifecycleStatus: "failed" as const,
        zeropsResult: { toolName: "zerops_deploy", resultText: LIVE_DEPLOY_ERROR_RESULT },
      },
      true,
    ],
    [
      "mount",
      {
        zeropsResult: {
          toolName: "zerops_mount",
          resultText: JSON.stringify({ hostname: "api", status: "MOUNTED" }),
        },
      },
      false,
    ],
    [
      "subdomain",
      {
        zeropsResult: {
          toolName: "zerops_subdomain",
          resultText: JSON.stringify({ serviceHostname: "api", action: "enable" }),
        },
      },
      false,
    ],
    [
      "non-JSON result",
      { zeropsResult: { toolName: "zerops_workflow", resultText: "workflow is running" } },
      false,
    ],
    ["truncated result", { zeropsResult: { toolName: "zerops_deploy", truncated: true } }, false],
    ["JSON array", { zeropsResult: { toolName: "zerops_deploy", resultText: "[]" } }, false],
    ["unknown tool", { zeropsResult: { toolName: "zerops_future", resultText: "{}" } }, false],
  ] as const)("classifies %s from the card decoder result", (_, entry, expected) => {
    expect(isZeropsMilestone(entry)).toBe(expected);
  });

  it("keeps the milestone kind policy in one explicit set", () => {
    expect([...MILESTONE_KINDS]).toEqual(["plan", "import", "deploy", "verify", "error"]);
  });

  it("returns false for an absent entry", () => {
    expect(isZeropsMilestone(undefined)).toBe(false);
  });

  it("decodes the same entry object once", () => {
    const decode = vi.spyOn(Payloads, "decodeZeropsCard");
    const entry = {
      zeropsResult: {
        toolName: "zerops_deploy",
        resultText: JSON.stringify({ status: "DEPLOYED", targetService: "kanbandev" }),
      },
    };

    expect(isZeropsMilestone(entry)).toBe(true);
    expect(isZeropsMilestone(entry)).toBe(true);
    expect(decode).toHaveBeenCalledTimes(1);
  });
});
