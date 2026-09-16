import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { agentSignInsJustSucceeded } from "./useZeropsAgentSigner";

const snapshot = (
  logins: Readonly<Partial<Record<"claude-code" | "codex", string>>>,
): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: (["claude-code", "codex"] as const).map((agentId) => ({
    agentId,
    credPresent: true,
    flagOAuth: true,
    flagToken: false,
    providerAuth: "authenticated" as const,
    state: "authorized" as const,
    ...(logins[agentId] === undefined
      ? {}
      : {
          login: {
            phase: logins[agentId] as "succeeded" | "starting" | "failed",
            terminalId: "t",
            startedAt: DateTime.makeUnsafe("2026-09-16T10:00:00.000Z"),
          },
        }),
  })),
});

describe("agentSignInsJustSucceeded", () => {
  it("names the agent whose sign-in has just landed", () => {
    expect(
      agentSignInsJustSucceeded(
        snapshot({ "claude-code": "starting" }),
        snapshot({ "claude-code": "succeeded" }),
      ),
    ).toEqual(["claude-code"]);
  });

  // The snapshot republishes for reasons of its own; a record written on every
  // republish would be a project write on every repaint.
  it("names nobody when the success was already there", () => {
    const already = snapshot({ "claude-code": "succeeded" });
    expect(agentSignInsJustSucceeded(already, already)).toEqual([]);
  });

  it("names nobody while a sign-in is merely in progress", () => {
    expect(agentSignInsJustSucceeded(null, snapshot({ "claude-code": "starting" }))).toEqual([]);
  });

  it("names nobody when a sign-in failed", () => {
    expect(agentSignInsJustSucceeded(null, snapshot({ codex: "failed" }))).toEqual([]);
  });

  // The first snapshot this client ever sees may already carry a success — a
  // login another tab drove, or one this page missed. Recording it is right:
  // the write is idempotent and the alternative is a Mate nobody can run.
  it("records a success already present on the first snapshot", () => {
    expect(agentSignInsJustSucceeded(null, snapshot({ codex: "succeeded" }))).toEqual(["codex"]);
  });

  it("names both when two sign-ins land together", () => {
    expect(
      agentSignInsJustSucceeded(null, snapshot({ "claude-code": "succeeded", codex: "succeeded" })),
    ).toEqual(["claude-code", "codex"]);
  });
});
