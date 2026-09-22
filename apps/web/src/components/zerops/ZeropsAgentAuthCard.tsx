/**
 * One row per agent CLI (Claude Code, Codex): its authorization state and,
 * when the user needs to act, a "Sign in" button — or, while a server-driven
 * login session (S7 follow-up F8) is actually running, whatever THAT phase
 * needs: a disabled placeholder while the server navigates the CLI's own
 * menus, an "Open sign-in link" + copy actions once a URL (and, for Codex, a
 * device code) is known, a "paste the code" prompt, or a retry
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
import {
  AGENT_OWNERSHIP_RETRY_RECORD_LABEL,
  agentOwnershipNeedsAttention,
  agentOwnershipNotice,
  resolveAgentOwnership,
  type ZeropsAgentOwnership,
} from "@t3tools/client-runtime/zerops/agentOwnership";

import { ClaudeAI, OpenAI } from "~/components/Icons";
import { Button } from "~/components/ui/button";
import {
  agentAuthAction,
  agentAuthLabel,
  agentLoginLabel,
  classifyAgentRowLogin,
  zeropsAgentAuthNeedsAttention,
  type ZeropsAgentLoginPresentation,
} from "@t3tools/client-runtime/zerops/agentLogin";
import { resolveAgentAuthorizer, useLocalAgentSigners } from "~/zerops/useZeropsAgentSigner";
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
  viewerSubject,
  onSignIn,
  onCancel,
  recordFailed,
  onRetryRecord,
  signOutSupported,
  onSignOut,
  signOutPending,
  signOutError,
}: {
  readonly snapshot: ZeropsAgentAuthSnapshot;
  /** The signed-in Zerops user id, so a row can say whose login it is (D6). */
  readonly viewerSubject?: string | undefined;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
  /** Agents whose signer-record write this browser tried and watched fail (H13). */
  readonly recordFailed?: ReadonlySet<ZeropsAgentId> | undefined;
  readonly onRetryRecord?: ((agentId: ZeropsAgentId) => void) | undefined;
  /** Whether the environment advertises `capabilities.agentSignOut`; absent or false hides Sign out (older servers). */
  readonly signOutSupported?: boolean | undefined;
  readonly onSignOut?: ((agentId: ZeropsAgentId) => void) | undefined;
  readonly signOutPending?: ReadonlySet<ZeropsAgentId> | undefined;
  readonly signOutError?: ReadonlyMap<ZeropsAgentId, string> | undefined;
}) {
  // This is where agents are managed, so it stays up as long as the feed is
  // available; the header alone stops demanding once nothing needs it.
  const needsAttention = zeropsAgentAuthNeedsAttention(snapshot);
  return (
    <FlatCard className="overflow-hidden" data-zerops-agent-auth-card>
      <header className="border-b border-border/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">
          {needsAttention ? "Authorize coding agents" : "Coding agents"}
        </h3>
        <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
          Sign in inside this Zerops Control Plane. Access is shared by this project.
        </p>
      </header>
      <ZeropsAgentAuthRows
        onCancel={onCancel}
        onRetryRecord={onRetryRecord}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
        recordFailed={recordFailed}
        signOutError={signOutError}
        signOutPending={signOutPending}
        signOutSupported={signOutSupported}
        snapshot={snapshot}
        viewerSubject={viewerSubject}
      />
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
  viewerSubject,
  onSignIn,
  onCancel,
  recordFailed,
  onRetryRecord,
  signOutSupported,
  onSignOut,
  signOutPending,
  signOutError,
}: {
  readonly snapshot: ZeropsAgentAuthSnapshot;
  readonly viewerSubject?: string | undefined;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
  readonly recordFailed?: ReadonlySet<ZeropsAgentId> | undefined;
  readonly onRetryRecord?: ((agentId: ZeropsAgentId) => void) | undefined;
  readonly signOutSupported?: boolean | undefined;
  readonly onSignOut?: ((agentId: ZeropsAgentId) => void) | undefined;
  readonly signOutPending?: ReadonlySet<ZeropsAgentId> | undefined;
  readonly signOutError?: ReadonlyMap<ZeropsAgentId, string> | undefined;
}) {
  // One authorized agent is enough to work: the other's row is then an
  // offer, not a demand (the audit run, 2026-09-17: Codex's "Action
  // required" stayed lit after Claude Code was signed in).
  const anotherAuthorized = (agent: ZeropsAgentAuth) =>
    snapshot.agents.some(
      (other) => other.agentId !== agent.agentId && agentAuthAction(other) === "none",
    );
  return (
    <div className="divide-y divide-border/60" data-zerops-agent-auth-rows>
      {snapshot.agents.map((agent) => (
        <ZeropsAgentAuthRow
          key={agent.agentId}
          agent={agent}
          onCancel={onCancel}
          onRetryRecord={onRetryRecord}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
          quiet={anotherAuthorized(agent)}
          recordFailed={recordFailed?.has(agent.agentId) ?? false}
          signOutError={signOutError?.get(agent.agentId)}
          signOutPending={signOutPending?.has(agent.agentId) ?? false}
          signOutSupported={signOutSupported ?? false}
          viewerSubject={viewerSubject}
        />
      ))}
    </div>
  );
}

function ZeropsAgentAuthRow({
  agent,
  viewerSubject,
  quiet,
  recordFailed,
  onSignIn,
  onCancel,
  onRetryRecord,
  signOutSupported,
  onSignOut,
  signOutPending,
  signOutError,
}: {
  readonly agent: ZeropsAgentAuth;
  readonly viewerSubject?: string | undefined;
  /** Another agent is signed in, so this one's sign-in is an offer. */
  readonly quiet: boolean;
  /** This browser's own signer-record write for this agent failed (H13). */
  readonly recordFailed: boolean;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
  readonly onRetryRecord?: ((agentId: ZeropsAgentId) => void) | undefined;
  readonly signOutSupported: boolean;
  readonly onSignOut?: ((agentId: ZeropsAgentId) => void) | undefined;
  readonly signOutPending: boolean;
  readonly signOutError?: string | undefined;
}) {
  const login = classifyAgentRowLogin(agent);
  const label = login.kind === "none" ? agentAuthLabel(agent) : agentLoginLabel(login);
  const status = agentStatusPresentation(agent, login, quiet);
  // Whose subscription a turn here would spend. Silent for your own agent —
  // telling someone their own login is theirs is noise on every screen.
  // The record this client wrote itself counts until the snapshot carries it.
  const localSigners = useLocalAgentSigners();
  const ownership = resolveAgentOwnership({
    credPresent: agent.credPresent,
    authorizedBy: resolveAgentAuthorizer(agent.agentId, agent.authorizedBy, localSigners),
    viewerSubject,
    recordFailed,
  });
  const ownershipNotice = agentOwnershipNotice(ownership);

  return (
    <div
      className="flex flex-col items-stretch gap-2.5 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
      data-agent-id={agent.agentId}
      data-agent-state={agent.state}
      data-agent-login-phase={login.kind}
      data-zerops-agent-auth-row
    >
      <div className="flex min-w-0 items-center gap-3" data-zerops-agent-identity>
        <AgentLogo agentId={agent.agentId} />
        <div className="min-w-0">
          <span className="block leading-5 font-medium text-foreground">
            {AGENT_NAMES[agent.agentId]}
          </span>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <StatusDot label={status.label} tone={status.tone} />
            {label === status.label ? null : (
              <span className="min-w-0 text-xs leading-4 text-muted-foreground">{label}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-col items-stretch gap-1.5 sm:items-end">
        {ownershipNotice === undefined ? null : (
          <p
            className={
              agentOwnershipNeedsAttention(ownership)
                ? "text-xs leading-4 text-warning"
                : "text-xs leading-4 text-muted-foreground"
            }
            data-zerops-agent-ownership={ownership}
          >
            {ownershipNotice}
          </p>
        )}
        {ownership === "record-failed" && onRetryRecord !== undefined ? (
          <Button
            data-zerops-agent-retry-record
            onClick={() => {
              onRetryRecord(agent.agentId);
            }}
            size="compact"
            variant="pill"
          >
            {AGENT_OWNERSHIP_RETRY_RECORD_LABEL}
          </Button>
        ) : (
          <ZeropsAgentAuthActionSlot
            agent={agent}
            login={login}
            onCancel={onCancel}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            ownership={ownership}
            signOutError={signOutError}
            signOutPending={signOutPending}
            signOutSupported={signOutSupported}
          />
        )}
      </div>
    </div>
  );
}

function AgentLogo({ agentId }: { readonly agentId: ZeropsAgentId }) {
  const logoClassName = "size-4";

  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background shadow-xs"
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
  quiet: boolean,
): { readonly label: string; readonly tone: "attention" | "busy" | "failed" | "off" | "ok" } {
  switch (login.kind) {
    case "starting":
    case "menu":
      return { label: "Signing in", tone: "busy" };
    case "verifying-code":
      return { label: "Checking the code", tone: "busy" };
    case "confirming":
      return { label: "Confirming", tone: "busy" };
    case "awaiting-browser":
    case "awaiting-code":
      return { label: "Action required", tone: "attention" };
    case "succeeded":
      return { label: "Authorized", tone: "ok" };
    case "failed":
      return { label: "Sign-in failed", tone: "failed" };
    case "none": {
      const action = agentAuthAction(agent);
      if (action === "sign-in") {
        return quiet
          ? { label: agentAuthLabel(agent), tone: "off" }
          : { label: "Action required", tone: "attention" };
      }
      if (action === "registering") {
        return { label: "Registering", tone: "busy" };
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
  onSignOut,
  ownership,
  signOutSupported,
  signOutPending,
  signOutError,
}: {
  readonly agent: ZeropsAgentAuth;
  readonly login: ZeropsAgentLoginPresentation;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
  readonly onSignOut?: ((agentId: ZeropsAgentId) => void) | undefined;
  readonly ownership: ZeropsAgentOwnership;
  readonly signOutSupported: boolean;
  readonly signOutPending: boolean;
  readonly signOutError?: string | undefined;
}) {
  switch (login.kind) {
    case "none":
      return (
        <ZeropsAgentAuthActionButton
          agent={agent}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
          ownership={ownership}
          signOutError={signOutError}
          signOutPending={signOutPending}
          signOutSupported={signOutSupported}
        />
      );
    case "starting":
    case "menu":
    case "awaiting-browser":
    case "awaiting-code":
    case "verifying-code":
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
    case "confirming":
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

/**
 * Once an agent is fully authorized (D6 round 5), the row is never a dead
 * end: a token-authorized agent belongs to the project, not a person, so
 * there is nothing to switch or sign out (`ZeropsAgentLoginErrorReason`'s
 * `"token-authorized"` is the server saying the same thing); everyone else
 * gets an account action (their own login: "Switch account"; anybody
 * else's, or nobody recorded: "Use my account") and, only where the
 * environment advertises `capabilities.agentSignOut`, "Sign out".
 */
function ZeropsAgentAuthActionButton({
  agent,
  onSignIn,
  onSignOut,
  ownership,
  signOutSupported,
  signOutPending,
  signOutError,
}: {
  readonly agent: ZeropsAgentAuth;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onSignOut?: ((agentId: ZeropsAgentId) => void) | undefined;
  readonly ownership: ZeropsAgentOwnership;
  readonly signOutSupported: boolean;
  readonly signOutPending: boolean;
  readonly signOutError?: string | undefined;
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
  if (action !== "none") return null;

  if (agent.state === "authorized-token") {
    return <p className="text-xs leading-4 text-muted-foreground">Authorized by a project token</p>;
  }

  if (ownership !== "mine" && ownership !== "someone-else" && ownership !== "unrecorded") {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        {...(ownership === "mine"
          ? { "data-zerops-agent-switch-account": true }
          : { "data-zerops-agent-use-my-account": true })}
        onClick={() => {
          onSignIn(agent.agentId);
        }}
        size="compact"
        variant="outline"
      >
        {ownership === "mine" ? "Switch account" : "Use my account"}
      </Button>
      {signOutSupported && onSignOut !== undefined ? (
        <Button
          data-zerops-agent-sign-out
          disabled={signOutPending}
          onClick={() => {
            onSignOut(agent.agentId);
          }}
          size="compact"
          variant="ghost"
        >
          {signOutPending ? "Signing out…" : "Sign out"}
        </Button>
      ) : null}
      {signOutError === undefined ? null : (
        <p
          className="w-full text-right text-xs leading-4 text-destructive"
          data-zerops-agent-sign-out-error
        >
          {signOutError}
        </p>
      )}
    </div>
  );
}
