import type { ZeropsAgentAuth, ZeropsAgentLoginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agentAcceptsCode,
  resolveAgentAuthorizationDialog,
} from "./ZeropsAgentAuthorizationDialog.logic";

const login = (
  phase: ZeropsAgentLoginState["phase"],
  overrides: Partial<ZeropsAgentLoginState> = {},
): ZeropsAgentLoginState => ({
  phase,
  terminalId: "agent-login-codex",
  startedAt: new Date("2026-09-01T12:00:00.000Z") as unknown as ZeropsAgentLoginState["startedAt"],
  startedBy: "user-a",
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
      stateLabel: "Paste the code",
    });
    expect(view.action).toBe("paste-code");
  });

  it("checks a submitted code on the verify step, cancellable", () => {
    const view = resolveAgentAuthorizationDialog(agent("claude-code", login("verifying-code")));

    expect(view.activeStepId).toBe("verify");
    expect(view.steps.find((step) => step.id === "verify")?.stateLabel).toBe("Checking");
    expect(view.action).toBe("cancel");
  });

  it.each([
    { name: "Claude's wrong code fails the verify step", agentId: "claude-code", step: "verify" },
    {
      name: "Codex's expired device code fails the browser step",
      agentId: "codex",
      step: "browser",
    },
  ] as const)("$name", ({ agentId, step }) => {
    const view = resolveAgentAuthorizationDialog(
      agent(agentId, login("failed", { url: "https://example.test/authorize" })),
    );

    expect(view.activeStepId).toBe(step);
    expect(view.steps.find((entry) => entry.id === step)?.state).toBe("failed");
    expect(view.action).toBe("retry");
  });

  it.each([
    { phase: "awaiting-browser", agentId: "claude-code", accepts: true },
    { phase: "awaiting-code", agentId: "claude-code", accepts: true },
    { phase: "verifying-code", agentId: "claude-code", accepts: false },
    { phase: "menu", agentId: "claude-code", accepts: false },
    { phase: "awaiting-browser", agentId: "codex", accepts: false },
  ] as const)(
    "a $agentId login in $phase takes a code: $accepts",
    ({ phase, agentId, accepts }) => {
      expect(agentAcceptsCode(agent(agentId, login(phase)))).toBe(accepts);
    },
  );

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
