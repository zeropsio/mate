import type { ZeropsAgentAuth, ZeropsAgentLoginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveAgentAuthorizationDialog } from "./ZeropsAgentAuthorizationDialog.logic";

const login = (
  phase: ZeropsAgentLoginState["phase"],
  overrides: Partial<ZeropsAgentLoginState> = {},
): ZeropsAgentLoginState => ({
  phase,
  terminalId: "agent-login-codex",
  startedAt: new Date("2026-09-01T12:00:00.000Z") as unknown as ZeropsAgentLoginState["startedAt"],
  ...overrides,
});

const agent = (
  agentId: ZeropsAgentAuth["agentId"],
  agentLogin?: ZeropsAgentLoginState,
): ZeropsAgentAuth => ({
  agentId,
  credPresent: false,
  flagOAuth: false,
  flagToken: false,
  providerAuth: "unknown",
  state: "not-authorized",
  ...(agentLogin === undefined ? {} : { login: agentLogin }),
});

describe("resolveAgentAuthorizationDialog", () => {
  it("uses the four-step browser-poll flow for Codex", () => {
    expect(resolveAgentAuthorizationDialog(agent("codex")).steps).toEqual([
      { id: "start", label: "Start", state: "running", stateLabel: "Ready" },
      { id: "initialize", label: "Initialize session", state: "queued", stateLabel: "Waiting" },
      { id: "browser", label: "Authorize in browser", state: "queued", stateLabel: "Waiting" },
      { id: "complete", label: "Complete", state: "queued", stateLabel: "Waiting" },
    ]);
  });

  it("uses the five-step paste-code flow for Claude", () => {
    const view = resolveAgentAuthorizationDialog(agent("claude-code", login("awaiting-code")));

    expect(view.steps.map((step) => step.id)).toEqual([
      "start",
      "initialize",
      "browser",
      "verify",
      "complete",
    ]);
    expect(view.steps.find((step) => step.id === "verify")).toEqual({
      id: "verify",
      label: "Verify code",
      state: "running",
      stateLabel: "Paste into terminal",
    });
    expect(view.action).toBe("paste-code");
  });

  it.each([
    ["starting", "initialize", "cancel"],
    ["menu", "initialize", "cancel"],
    ["awaiting-browser", "browser", "open-browser"],
    ["succeeded", "complete", "close"],
    ["failed", "initialize", "retry"],
    ["cancelled", "start", "start"],
  ] as const)("maps %s to the %s step and %s action", (phase, activeStep, action) => {
    const view = resolveAgentAuthorizationDialog(agent("codex", login(phase)));

    expect(view.activeStepId).toBe(activeStep);
    expect(view.action).toBe(action);
  });

  it("marks every step complete only after the server reports success", () => {
    const view = resolveAgentAuthorizationDialog(agent("claude-code", login("succeeded")));

    expect(view.steps.every((step) => step.state === "done")).toBe(true);
  });

  it("marks a failed session without pretending to know a later completed phase", () => {
    const view = resolveAgentAuthorizationDialog(
      agent("codex", login("failed", { message: "Authentication failed." })),
    );

    expect(view.steps).toEqual([
      { id: "start", label: "Start", state: "done", stateLabel: "Complete" },
      { id: "initialize", label: "Initialize session", state: "failed", stateLabel: "Failed" },
      { id: "browser", label: "Authorize in browser", state: "queued", stateLabel: "Waiting" },
      { id: "complete", label: "Complete", state: "queued", stateLabel: "Waiting" },
    ]);
    expect(view.description).toBe("Authentication failed.");
  });
});
