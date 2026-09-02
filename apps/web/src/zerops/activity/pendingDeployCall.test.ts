import { describe, expect, it } from "vite-plus/test";

import { readPendingDeployCall } from "./pendingDeployCall.ts";

const CREATED_AT = "2026-09-02T10:00:00.000Z";
const CREATED_AT_MS = Date.parse(CREATED_AT);
const STARTED_AT = "2026-09-02T09:59:58.000Z";
const STARTED_AT_MS = Date.parse(STARTED_AT);

describe("readPendingDeployCall", () => {
  it("reads targetService from a Codex-shaped toolData.input", () => {
    expect(
      readPendingDeployCall({
        toolData: { input: { targetService: "kanbandev" } },
        createdAt: CREATED_AT,
      }),
    ).toEqual({ targetService: "kanbandev", toolStartedAtMs: CREATED_AT_MS });
  });

  it("reads targetService from a Claude-shaped toolInput", () => {
    expect(
      readPendingDeployCall({ toolInput: { targetService: "kanbandev" }, createdAt: CREATED_AT }),
    ).toEqual({ targetService: "kanbandev", toolStartedAtMs: CREATED_AT_MS });
  });

  it("prefers toolData.input over toolInput when both are somehow present", () => {
    expect(
      readPendingDeployCall({
        toolData: { input: { targetService: "codex-target" } },
        toolInput: { targetService: "claude-target" },
        createdAt: CREATED_AT,
      }),
    ).toEqual({ targetService: "codex-target", toolStartedAtMs: CREATED_AT_MS });
  });

  it("returns undefined when neither carrier has a targetService", () => {
    expect(
      readPendingDeployCall({ toolData: { input: {} }, toolInput: {}, createdAt: CREATED_AT }),
    ).toBeUndefined();
    expect(readPendingDeployCall({ createdAt: CREATED_AT })).toBeUndefined();
  });

  it("uses startedAt over createdAt for the tool-start timestamp, when present", () => {
    expect(
      readPendingDeployCall({
        toolInput: { targetService: "kanbandev" },
        createdAt: CREATED_AT,
        startedAt: STARTED_AT,
      }),
    ).toEqual({ targetService: "kanbandev", toolStartedAtMs: STARTED_AT_MS });
  });

  it("falls back to createdAt when startedAt is absent", () => {
    expect(
      readPendingDeployCall({ toolInput: { targetService: "kanbandev" }, createdAt: CREATED_AT }),
    ).toEqual({ targetService: "kanbandev", toolStartedAtMs: CREATED_AT_MS });
  });

  it("returns undefined for an unparseable timestamp", () => {
    expect(
      readPendingDeployCall({ toolInput: { targetService: "kanbandev" }, createdAt: "not-a-date" }),
    ).toBeUndefined();
  });
});
