import { describe, expect, it } from "vite-plus/test";

import { readPendingDeployCall } from "./pendingDeployCall.ts";

const CREATED_AT = "2026-09-02T10:00:00.000Z";
const CREATED_AT_MS = Date.parse(CREATED_AT);

describe("readPendingDeployCall", () => {
  it("reads targetService from a Codex-shaped item.input", () => {
    expect(
      readPendingDeployCall({
        toolData: { input: { targetService: "kanbandev" } },
        createdAt: CREATED_AT,
      }),
    ).toEqual({ targetService: "kanbandev", toolStartedAtMs: CREATED_AT_MS });
  });

  it("reads targetService from a flat field", () => {
    expect(
      readPendingDeployCall({ toolData: { targetService: "kanbandev" }, createdAt: CREATED_AT }),
    ).toEqual({ targetService: "kanbandev", toolStartedAtMs: CREATED_AT_MS });
  });

  it("reads targetService from an `arguments` field", () => {
    expect(
      readPendingDeployCall({
        toolData: { arguments: { targetService: "kanbandev" } },
        createdAt: CREATED_AT,
      }),
    ).toEqual({ targetService: "kanbandev", toolStartedAtMs: CREATED_AT_MS });
  });

  it("returns undefined when toolData carries no targetService at all", () => {
    expect(
      readPendingDeployCall({ toolData: { input: {} }, createdAt: CREATED_AT }),
    ).toBeUndefined();
    expect(readPendingDeployCall({ createdAt: CREATED_AT })).toBeUndefined();
  });

  it("returns undefined for an unparseable createdAt", () => {
    expect(
      readPendingDeployCall({ toolData: { targetService: "kanbandev" }, createdAt: "not-a-date" }),
    ).toBeUndefined();
  });
});
