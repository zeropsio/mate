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
import { useState } from "react";
import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot, ZeropsAgentId } from "@t3tools/contracts";

import { Button } from "~/components/ui/button";
import {
  agentAuthAction,
  agentAuthLabel,
  agentLoginLabel,
  classifyAgentLogin,
  type ZeropsAgentLoginPresentation,
} from "@t3tools/client-runtime/zerops/agentLogin";

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
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-zerops-agent-auth-card>
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

  return (
    <div
      className="flex items-center justify-between gap-3 text-sm"
      data-agent-id={agent.agentId}
      data-agent-state={agent.state}
      data-agent-login-phase={login.kind}
      data-zerops-agent-auth-row
    >
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">{AGENT_NAMES[agent.agentId]}</span>
        <span className="text-muted-foreground text-xs">{label}</span>
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
      // The server is running/navigating the CLI's own login flow — nothing
      // for the user to click until it needs them, other than giving up.
      return (
        <div className="flex items-center gap-2">
          <Button disabled size="compact" variant="outline">
            Signing in…
          </Button>
          <CancelLoginButton agentId={agent.agentId} onCancel={onCancel} />
        </div>
      );
    case "awaiting-browser":
      return (
        <div className="flex items-center gap-2">
          <ZeropsAgentLoginAwaitingBrowser
            agentId={agent.agentId}
            url={login.url}
            code={login.code}
          />
          <CancelLoginButton agentId={agent.agentId} onCancel={onCancel} />
        </div>
      );
    case "awaiting-code":
      // The label above already says to paste into the terminal; the
      // terminal pane is what the user acts on next — Cancel is still
      // offered, for a code the user decides not to paste after all.
      return <CancelLoginButton agentId={agent.agentId} onCancel={onCancel} />;
    case "succeeded":
      return null;
    case "failed":
      return (
        <Button
          onClick={() => {
            onSignIn(agent.agentId);
          }}
          size="compact"
          variant="outline"
        >
          Sign in again
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

function ZeropsAgentLoginAwaitingBrowser({
  agentId,
  url,
  code,
}: {
  readonly agentId: ZeropsAgentId;
  readonly url: string | undefined;
  readonly code: string | undefined;
}) {
  return (
    <div className="flex items-center gap-2" data-zerops-agent-login-awaiting-browser>
      {url !== undefined && (
        <a
          className="text-primary text-xs underline underline-offset-2"
          href={url}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open sign-in link
        </a>
      )}
      {url !== undefined && <CopyButton label="Copy link" value={url} />}
      {agentId === "codex" && code !== undefined && (
        <CopyButton label={`Copy code ${code}`} value={code} />
      )}
    </div>
  );
}

/** How long the "Copied!" feedback stays on screen — mirrors the GUI walker's own `COPY_FEEDBACK_DURATION_MS`. */
const COPY_FEEDBACK_DURATION_MS = 2000;

function CopyButton({ label, value }: { readonly label: string; readonly value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, COPY_FEEDBACK_DURATION_MS);
          })
          .catch(() => {
            // Clipboard access can be denied (permissions, insecure
            // context); the sign-in link/code is still visible/openable
            // even if copying silently fails.
          });
      }}
      size="compact"
      variant="outline"
    >
      {copied ? "Copied!" : label}
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
        onClick={() => {
          onSignIn(agent.agentId);
        }}
        size="compact"
        variant="outline"
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
