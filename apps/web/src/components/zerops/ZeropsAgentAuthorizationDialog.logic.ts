import type { ZeropsAgentAuth } from "@t3tools/contracts";

import type { ProcessStep, ProcessStepState } from "./primitives";

export const ZEROPS_AGENT_NAMES = {
  "claude-code": "Claude Code",
  codex: "Codex",
} as const satisfies Record<ZeropsAgentAuth["agentId"], string>;

export type AgentAuthorizationDialogAction =
  | "cancel"
  | "close"
  | "open-browser"
  | "paste-code"
  | "retry"
  | "start";

export interface AgentAuthorizationDialogView {
  readonly action: AgentAuthorizationDialogAction;
  readonly activeStepId: string;
  readonly agentName: string;
  readonly description: string;
  readonly steps: ReadonlyArray<ProcessStep>;
}

const CODEX_STEPS = [
  { id: "start", label: "Start" },
  { id: "initialize", label: "Initialize session" },
  { id: "browser", label: "Authorize in browser" },
  { id: "complete", label: "Complete" },
] as const;

const CLAUDE_STEPS = [
  { id: "start", label: "Start" },
  { id: "initialize", label: "Initialize session" },
  { id: "browser", label: "Authorize in browser" },
  { id: "verify", label: "Verify code" },
  { id: "complete", label: "Complete" },
] as const;

const activeStepFor = (agent: ZeropsAgentAuth): string => {
  switch (agent.login?.phase) {
    case undefined:
    case "cancelled":
      return "start";
    case "starting":
    case "menu":
    case "failed":
      return "initialize";
    case "awaiting-browser":
      return "browser";
    case "awaiting-code":
      return agent.agentId === "claude-code" ? "verify" : "browser";
    case "succeeded":
      return "complete";
  }
};

const actionFor = (agent: ZeropsAgentAuth): AgentAuthorizationDialogAction => {
  switch (agent.login?.phase) {
    case undefined:
    case "cancelled":
      return "start";
    case "starting":
    case "menu":
      return "cancel";
    case "awaiting-browser":
      return "open-browser";
    case "awaiting-code":
      return "paste-code";
    case "succeeded":
      return "close";
    case "failed":
      return "retry";
  }
};

const descriptionFor = (agent: ZeropsAgentAuth): string => {
  const agentName = ZEROPS_AGENT_NAMES[agent.agentId];
  switch (agent.login?.phase) {
    case undefined:
      return "The login command runs inside this isolated ZCP container. Start when you are ready; browser authorization remains under your control.";
    case "starting":
      return "Creating a dedicated terminal session inside this ZCP…";
    case "menu":
      return "Preparing the provider's own secure login flow…";
    case "awaiting-browser":
      return agent.agentId === "codex" && agent.login.code !== undefined
        ? "Copy the device code, open the authorization page and approve access. Completion is detected automatically."
        : "Open the authorization page and approve access. Return here if the terminal asks for a verification code.";
    case "awaiting-code":
      return "Paste the code from your browser directly into the terminal. The code stays between you and the provider CLI.";
    case "succeeded":
      return `${agentName} is authorized in this ZCP. You can close the dialog and start working.`;
    case "failed":
      return agent.login.message ?? "Authorization failed. You can safely retry the login flow.";
    case "cancelled":
      return "Authorization was cancelled. Start again whenever you are ready.";
  }
};

const runningLabel = (agent: ZeropsAgentAuth, stepId: string): string => {
  switch (stepId) {
    case "start":
      return "Ready";
    case "initialize":
      return agent.login?.phase === "starting" ? "Initializing" : "Preparing login";
    case "browser":
      return "Open browser";
    case "verify":
      return "Paste into terminal";
    case "complete":
      return "Complete";
    default:
      return "In progress";
  }
};

export function resolveAgentAuthorizationDialog(
  agent: ZeropsAgentAuth,
): AgentAuthorizationDialogView {
  const definitions = agent.agentId === "claude-code" ? CLAUDE_STEPS : CODEX_STEPS;
  const activeStepId = activeStepFor(agent);
  const activeIndex = definitions.findIndex((step) => step.id === activeStepId);
  const succeeded = agent.login?.phase === "succeeded";
  const failed = agent.login?.phase === "failed";
  const steps = definitions.map((step, index): ProcessStep => {
    let state: ProcessStepState;
    if (succeeded || index < activeIndex) state = "done";
    else if (index > activeIndex) state = "queued";
    else if (failed) state = "failed";
    else state = "running";

    return {
      ...step,
      state,
      stateLabel:
        state === "done"
          ? "Complete"
          : state === "queued"
            ? "Waiting"
            : state === "failed"
              ? "Failed"
              : runningLabel(agent, step.id),
    };
  });

  return {
    action: actionFor(agent),
    activeStepId,
    agentName: ZEROPS_AGENT_NAMES[agent.agentId],
    description: descriptionFor(agent),
    steps,
  };
}
