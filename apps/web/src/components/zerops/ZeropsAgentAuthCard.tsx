/**
 * One row per agent CLI (Claude Code, Codex): its authorization state and,
 * when the user needs to act, a "Sign in" button — or, while a server-driven
 * login session (S7 follow-up F8) is actually running, whatever THAT phase
 * needs: a disabled placeholder while the server navigates the CLI's own
 * menus, an "Open sign-in link" + copy actions once a URL (and, for Codex, a
 * device code) is known, a "paste it into the terminal" prompt, or a retry
 * button on failure.
 *
 * The button's handler is a prop — this component never reaches the
 * terminal or the RPC layer itself, so it renders with `renderToStaticMarkup`
 * alone. `useAgentLogin` is what the handler actually does (asks the server
 * to run the login and opens the terminal panel so the user can watch it);
 * deciding whether the card is worth showing at all is
 * `zeropsAgentAuthNeedsAttention` (`@t3tools/client-runtime/zerops/agentLogin`), left to the
 * caller so this stays pure.
 */
import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot, ZeropsAgentId } from "@t3tools/contracts";

import { ClaudeAI, OpenAI } from "~/components/Icons";
import { Button } from "~/components/ui/button";
import {
  agentAuthAction,
  agentAuthLabel,
  agentLoginLabel,
  classifyAgentLogin,
  type ZeropsAgentLoginPresentation,
} from "@t3tools/client-runtime/zerops/agentLogin";
import { FlatCard, StatusDot } from "./primitives";

const AGENT_NAMES: Record<ZeropsAgentId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

const AGENT_SIGN_IN_LABELS: Record<ZeropsAgentId, string> = {
  "claude-code": "Sign in to Claude",
  codex: "Sign in to Codex",
};

export function ZeropsAgentAuthCard({
  snapshot,
  onSignIn,
  onCancel,
}: {
  readonly snapshot: ZeropsAgentAuthSnapshot;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
}) {
  return (
    <FlatCard className="overflow-hidden" data-zerops-agent-auth-card>
      <header className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Authorize coding agents</h3>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          Sign in inside this Zerops Control Plane. Access is shared by this project.
        </p>
      </header>
      <ZeropsAgentAuthRows onCancel={onCancel} onSignIn={onSignIn} snapshot={snapshot} />
    </FlatCard>
  );
}

/**
 * The rows alone — one per agent CLI — for a surface that already says why
 * they are there (an empty conversation asking for a sign-in) and needs no
 * card header repeating it.
 */
export function ZeropsAgentAuthRows({
  snapshot,
  onSignIn,
  onCancel,
}: {
  readonly snapshot: ZeropsAgentAuthSnapshot;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
}) {
  return (
    <div className="divide-y divide-border/60" data-zerops-agent-auth-rows>
      {snapshot.agents.map((agent) => (
        <ZeropsAgentAuthRow
          key={agent.agentId}
          agent={agent}
          onSignIn={onSignIn}
          onCancel={onCancel}
        />
      ))}
    </div>
  );
}

function ZeropsAgentAuthRow({
  agent,
  onSignIn,
  onCancel,
}: {
  readonly agent: ZeropsAgentAuth;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
}) {
  const login = classifyAgentLogin(agent.login);
  const label = login.kind === "none" ? agentAuthLabel(agent) : agentLoginLabel(login);
  const status = agentStatusPresentation(agent, login);

  return (
    <div
      className="flex flex-col items-stretch gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
      data-agent-id={agent.agentId}
      data-agent-state={agent.state}
      data-agent-login-phase={login.kind}
      data-zerops-agent-auth-row
    >
      <div className="flex min-w-0 items-start gap-3" data-zerops-agent-identity>
        <AgentLogo agentId={agent.agentId} />
        <div className="min-w-0">
          <span className="block font-medium text-foreground">{AGENT_NAMES[agent.agentId]}</span>
          <StatusDot className="mt-1" label={status.label} tone={status.tone} />
          {label === status.label ? null : (
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{label}</span>
          )}
        </div>
      </div>
      <ZeropsAgentAuthActionSlot
        agent={agent}
        login={login}
        onSignIn={onSignIn}
        onCancel={onCancel}
      />
    </div>
  );
}

function AgentLogo({ agentId }: { readonly agentId: ZeropsAgentId }) {
  const logoClassName = "size-5";

  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background shadow-xs"
      data-zerops-agent-logo={agentId}
    >
      {agentId === "claude-code" ? (
        <ClaudeAI className={logoClassName} />
      ) : (
        <OpenAI className={logoClassName} />
      )}
    </span>
  );
}

function agentStatusPresentation(
  agent: ZeropsAgentAuth,
  login: ZeropsAgentLoginPresentation,
): { readonly label: string; readonly tone: "attention" | "busy" | "failed" | "off" | "ok" } {
  switch (login.kind) {
    case "starting":
    case "menu":
      return { label: "Signing in", tone: "busy" };
    case "awaiting-browser":
    case "awaiting-code":
      return { label: "Action required", tone: "attention" };
    case "succeeded":
      return { label: "Authorized", tone: "ok" };
    case "failed":
      return { label: "Sign-in failed", tone: "failed" };
    case "none": {
      const action = agentAuthAction(agent);
      if (action === "sign-in") return { label: "Action required", tone: "attention" };
      if (action === "registering" || action === "checking") {
        return { label: action === "registering" ? "Registering" : "Checking", tone: "busy" };
      }
      return { label: agentAuthLabel(agent), tone: "ok" };
    }
  }
}

function ZeropsAgentAuthActionSlot({
  agent,
  login,
  onSignIn,
  onCancel,
}: {
  readonly agent: ZeropsAgentAuth;
  readonly login: ZeropsAgentLoginPresentation;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
}) {
  switch (login.kind) {
    case "none":
      return <ZeropsAgentAuthActionButton agent={agent} onSignIn={onSignIn} />;
    case "starting":
    case "menu":
    case "awaiting-browser":
    case "awaiting-code":
      return (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button
            data-zerops-agent-primary-action
            onClick={() => {
              onSignIn(agent.agentId);
            }}
            size="compact"
            variant="pill"
          >
            Continue authorization
          </Button>
          <CancelLoginButton agentId={agent.agentId} onCancel={onCancel} />
        </div>
      );
    case "succeeded":
      return null;
    case "failed":
      return (
        <Button
          onClick={() => {
            onSignIn(agent.agentId);
          }}
          size="compact"
          variant="pill"
        >
          Review authorization
        </Button>
      );
  }
}

function CancelLoginButton({
  agentId,
  onCancel,
}: {
  readonly agentId: ZeropsAgentId;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
}) {
  return (
    <Button
      onClick={() => {
        onCancel(agentId);
      }}
      size="compact"
      variant="ghost"
    >
      Cancel
    </Button>
  );
}

function ZeropsAgentAuthActionButton({
  agent,
  onSignIn,
}: {
  readonly agent: ZeropsAgentAuth;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
}) {
  const action = agentAuthAction(agent);
  if (action === "sign-in") {
    return (
      <Button
        data-zerops-agent-primary-action
        onClick={() => {
          onSignIn(agent.agentId);
        }}
        size="compact"
        variant="pill"
      >
        {AGENT_SIGN_IN_LABELS[agent.agentId]}
      </Button>
    );
  }
  if (action === "registering") {
    // The watcher marks this within seconds of the credential artifact
    // appearing — there is nothing for the user to click while it does.
    return (
      <Button disabled size="compact" variant="outline">
        Registering…
      </Button>
    );
  }
  if (action === "checking") {
    // The live provider check hasn't answered yet — same idea as
    // "registering", worded for what is actually pending.
    return (
      <Button disabled size="compact" variant="outline">
        Checking…
      </Button>
    );
  }
  return null;
}
