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
 *
 * Crew mode's *Runs on* (PRD §4.3) makes it a list of logins, not two fixed
 * agents: under each agent's own row come its further logins — a second
 * account, an API key — each saying whose it is and which crewmates run on it,
 * then *Add another login* where the server keeps logins. Without `logins` the
 * card is exactly the two agent rows it always was.
 */
import type {
  ZeropsAgentAuth,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentId,
  ZeropsLoginAddInput,
  ZeropsLoginKind,
} from "@t3tools/contracts";
import {
  agentOwnershipNeedsAttention,
  AGENT_OWNERSHIP_RECOVERY_LABEL,
  agentOwnershipNotice,
  resolveAgentOwnership,
  type ZeropsAgentOwnership,
} from "@t3tools/client-runtime/zerops/agentOwnership";

import { crewLoginRunsWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import { mateLoginSignerLine, type MateLoginRow } from "@t3tools/client-runtime/zerops/logins";
import { Fragment, useId, useState } from "react";

import { formatTimestamp } from "~/timestampFormat";
import { ClaudeAI, OpenAI } from "~/components/Icons";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  agentAuthAction,
  agentAuthLabel,
  agentLoginLabel,
  classifyAgentRowLogin,
  zeropsAgentAuthNeedsAttention,
  type ZeropsAgentLoginPresentation,
} from "@t3tools/client-runtime/zerops/agentLogin";
import { resolveAgentAuthorizer } from "@t3tools/client-runtime/zerops/agentOwnership";
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
  onRecheck,
  signOutSupported,
  onSignOut,
  signOutPending,
  signOutError,
  ...loginProps
}: {
  readonly snapshot: ZeropsAgentAuthSnapshot;
  /** The signed-in Zerops user id, so a row can say whose login it is (D6). */
  readonly viewerSubject?: string | undefined;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
  /** Whether the environment advertises `capabilities.agentSignOut`; absent or false hides Sign out (older servers). */
  readonly signOutSupported?: boolean | undefined;
  readonly onSignOut?: ((agentId: ZeropsAgentId) => void) | undefined;
  readonly signOutPending?: ReadonlySet<ZeropsAgentId> | undefined;
  readonly signOutError?: ReadonlyMap<ZeropsAgentId, string> | undefined;
} & ZeropsLoginsProps) {
  // This is where agents are managed, so it stays up as long as the feed is
  // available; the header alone stops demanding once nothing needs it.
  const needsAttention = zeropsAgentAuthNeedsAttention(snapshot);
  return (
    <FlatCard className="@container overflow-hidden" data-zerops-agent-auth-card>
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
        onRecheck={onRecheck}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
        signOutError={signOutError}
        signOutPending={signOutPending}
        signOutSupported={signOutSupported}
        snapshot={snapshot}
        viewerSubject={viewerSubject}
        {...loginProps}
      />
    </FlatCard>
  );
}

/** No logins beyond the agent rows: a server that lists none. */
const NO_LOGINS: ReadonlyArray<MateLoginRow> = [];

/** A login's pending action and its last failure, from `useMateLogins`. */
export interface ZeropsLoginActionStatus {
  readonly pending: boolean;
  readonly error: string | undefined;
}

/**
 * The logins beyond each agent's own (crew mode's *Runs on*). Every handler
 * absent hides its action; `onAddLogin` absent — a server without
 * `capabilities.mateLogins` — hides *Add another login*.
 */
interface ZeropsLoginsProps {
  readonly onRecheck?: ((agentId: ZeropsAgentId, loginId?: string) => void) | undefined;
  /** Every login, as `mateLoginRows` lists them; the defaults lend their crewmates to the agent rows. */
  readonly logins?: ReadonlyArray<MateLoginRow> | undefined;
  /** A signer's name, where the client knows it. */
  readonly nameOf?: ((userId: string) => string | undefined) | undefined;
  readonly onAddLogin?: ((input: ZeropsLoginAddInput) => void) | undefined;
  /** Why the last add was refused. */
  readonly addLoginError?: string | undefined;
  readonly onSignInLogin?: ((login: MateLoginRow) => void) | undefined;
  readonly onCancelLogin?: ((login: MateLoginRow) => void) | undefined;
  readonly onSignOutLogin?: ((login: MateLoginRow) => void) | undefined;
  readonly onRemoveLogin?: ((login: MateLoginRow) => void) | undefined;
  readonly loginStatus?: ((loginId: string) => ZeropsLoginActionStatus) | undefined;
}

/**
 * The rows alone — one per agent CLI, each followed by its further logins —
 * for a surface that already says why they are there (an empty conversation
 * asking for a sign-in) and needs no card header repeating it.
 */
export function ZeropsAgentAuthRows({
  snapshot,
  viewerSubject,
  onSignIn,
  onCancel,
  onRecheck,
  signOutSupported,
  onSignOut,
  signOutPending,
  signOutError,
  logins = NO_LOGINS,
  nameOf,
  onAddLogin,
  addLoginError,
  onSignInLogin,
  onCancelLogin,
  onSignOutLogin,
  onRemoveLogin,
  loginStatus,
}: {
  readonly snapshot: ZeropsAgentAuthSnapshot;
  readonly viewerSubject?: string | undefined;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
  readonly signOutSupported?: boolean | undefined;
  readonly onSignOut?: ((agentId: ZeropsAgentId) => void) | undefined;
  readonly signOutPending?: ReadonlySet<ZeropsAgentId> | undefined;
  readonly signOutError?: ReadonlyMap<ZeropsAgentId, string> | undefined;
} & ZeropsLoginsProps) {
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
        <Fragment key={agent.agentId}>
          <ZeropsAgentAuthRow
            agent={agent}
            runsOn={logins.find((login) => login.default && login.agent === agent.agentId)}
            onCancel={onCancel}
            onRecheck={onRecheck}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            quiet={anotherAuthorized(agent)}
            signOutError={signOutError?.get(agent.agentId)}
            signOutPending={signOutPending?.has(agent.agentId) ?? false}
            signOutSupported={signOutSupported ?? false}
            viewerSubject={viewerSubject}
          />
          {logins
            .filter((login) => !login.default && login.agent === agent.agentId)
            .map((login) => (
              <ZeropsLoginRow
                key={login.id}
                login={login}
                nameOf={nameOf}
                onRecheck={onRecheck}
                onCancel={onCancelLogin}
                onRemove={onRemoveLogin}
                onSignIn={onSignInLogin}
                onSignOut={onSignOutLogin}
                status={loginStatus?.(login.id)}
                viewerSubject={viewerSubject}
              />
            ))}
          {onAddLogin === undefined ? null : (
            <AddLoginControl agentId={agent.agentId} error={addLoginError} onAdd={onAddLogin} />
          )}
        </Fragment>
      ))}
    </div>
  );
}

function ZeropsAgentAuthRow({
  agent,
  runsOn,
  viewerSubject,
  quiet,
  onSignIn,
  onCancel,
  onRecheck,
  signOutSupported,
  onSignOut,
  signOutPending,
  signOutError,
}: {
  readonly agent: ZeropsAgentAuth;
  /** This agent's own login, for the crewmates that run on it. */
  readonly runsOn?: Pick<MateLoginRow, "crewmates" | "lead"> | undefined;
  readonly viewerSubject?: string | undefined;
  /** Another agent is signed in, so this one's sign-in is an offer. */
  readonly onRecheck?: ((agentId: ZeropsAgentId, loginId?: string) => void) | undefined;
  readonly quiet: boolean;
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
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
  const ownership = resolveAgentOwnership({
    credPresent: agent.credPresent,
    authorizedBy: resolveAgentAuthorizer(agent, viewerSubject),
    viewerSubject,
  });
  const ownershipNotice = agentOwnershipNotice(ownership);

  return (
    <div
      className="flex flex-col items-stretch gap-2.5 px-4 py-2.5 text-sm @sm:flex-row @sm:items-center @sm:justify-between"
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
          <AuthCheckedAt at={agent.verification?.checkedAt} />
          <RunsOnLine runsOn={runsOn} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1.5 ps-11 @sm:items-end @sm:ps-0">
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
        {agent.verification?.reason === undefined &&
        agent.registration?.reason === undefined ? null : (
          <p className="text-xs leading-4 text-destructive">
            {agent.verification?.reason ?? agent.registration?.reason}
          </p>
        )}
        {agent.registration?.process === undefined ? null : (
          <p className="text-xs leading-4 text-muted-foreground">
            Registration process {agent.registration.process.id}
            {agent.registration.process.status ? ` · ${agent.registration.process.status}` : ""}
          </p>
        )}
        {(agentAuthAction(agent) === "check-again" ||
          agentAuthAction(agent) === "register-again") &&
        onRecheck !== undefined &&
        ownership !== "someone-else" ? (
          <Button size="compact" variant="pill" onClick={() => onRecheck(agent.agentId)}>
            {agentAuthAction(agent) === "check-again" ? "Check again" : "Register again"}
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

/** The receipt's source time, without a clock or a background recheck. */
function AuthCheckedAt({ at }: { readonly at: number | undefined }) {
  if (at === undefined) return null;
  const iso = new Date(at).toISOString();
  return (
    <p className="text-xs leading-4 text-muted-foreground">
      Last checked <time dateTime={iso}>{formatTimestamp(iso, "locale")}</time>
    </p>
  );
}

/** Which crewmates run on a login, the lead named as the lead; nothing when none does. */
function RunsOnLine({
  runsOn,
}: {
  readonly runsOn?: Pick<MateLoginRow, "crewmates" | "lead"> | undefined;
}) {
  if (runsOn === undefined || runsOn.crewmates.length === 0) return null;
  return (
    <p className="mt-0.5 text-xs leading-4 text-muted-foreground" data-zerops-login-crewmates>
      {crewLoginRunsWord(runsOn.crewmates, runsOn.lead)}
    </p>
  );
}

const LOGIN_IN_PROGRESS_PHASES: ReadonlySet<string> = new Set([
  "starting",
  "menu",
  "awaiting-browser",
  "awaiting-code",
  "verifying-code",
]);

/** A further login's status: its login walker while one runs, else its own state. */
function loginStatusPresentation(login: MateLoginRow): {
  readonly label: string;
  readonly tone: "attention" | "busy" | "failed" | "off" | "ok";
} {
  switch (login.login?.phase) {
    case "starting":
    case "menu":
    case "verifying-code":
      return { label: "Signing in", tone: "busy" };
    case "awaiting-browser":
    case "awaiting-code":
      return { label: "Action required", tone: "attention" };
    case "failed":
      if (login.state !== "authorized") return { label: "Sign-in failed", tone: "failed" };
      break;
    default:
      break;
  }
  if (login.verification?.status === "checking") return { label: "Checking", tone: "busy" };
  if (login.verification?.status === "unknown" && login.verification.checkedAt !== undefined)
    return { label: "Couldn't verify", tone: "failed" };
  switch (login.state) {
    case "authorized":
      return { label: login.kind === "apiKey" ? "Added" : "Authorized", tone: "ok" };
    case "registering":
      return { label: "Checking", tone: "busy" };
    case "reconnect":
    case "needs-reauth":
      return { label: "Sign in again", tone: "attention" };
    case "not-authorized":
      return { label: login.kind === "apiKey" ? "No key" : "Not signed in", tone: "off" };
  }
}

/**
 * One login beyond its agent's own: whose it is, which crewmates run on it,
 * and what can be done — sign it in, sign it out (your own account), remove
 * it. A login somebody else signed in serves only their crews (N9).
 */
function ZeropsLoginRow({
  login,
  viewerSubject,
  nameOf,
  status,
  onSignIn,
  onCancel,
  onRecheck,
  onSignOut,
  onRemove,
}: {
  readonly login: MateLoginRow;
  readonly viewerSubject?: string | undefined;
  readonly nameOf?: ((userId: string) => string | undefined) | undefined;
  readonly onRecheck?: ((agentId: ZeropsAgentId, loginId?: string) => void) | undefined;
  readonly status?: ZeropsLoginActionStatus | undefined;
  readonly onSignIn?: ((login: MateLoginRow) => void) | undefined;
  readonly onCancel?: ((login: MateLoginRow) => void) | undefined;
  readonly onSignOut?: ((login: MateLoginRow) => void) | undefined;
  readonly onRemove?: ((login: MateLoginRow) => void) | undefined;
}) {
  const presentation = loginStatusPresentation(login);
  const signer = mateLoginSignerLine(login, viewerSubject, nameOf);
  const someoneElses = login.signedInBy !== undefined && login.signedInBy !== viewerSubject;
  const signerName = login.signedInBy === undefined ? "" : (nameOf?.(login.signedInBy) ?? "");
  const walking = login.login !== undefined && LOGIN_IN_PROGRESS_PHASES.has(login.login.phase);
  const signedIn = login.state === "authorized" || login.state === "registering";
  const pending = status?.pending ?? false;

  return (
    <div
      className="flex flex-col items-stretch gap-2.5 px-4 py-2.5 text-sm @sm:flex-row @sm:items-center @sm:justify-between"
      data-login-id={login.id}
      data-login-state={login.state}
      data-zerops-login-row
    >
      <div className="flex min-w-0 items-center gap-3">
        <AgentLogo agentId={login.agent} />
        <div className="min-w-0">
          <span className="block leading-5 font-medium text-foreground">{login.title}</span>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <StatusDot label={presentation.label} tone={presentation.tone} />
            {signer === presentation.label ? null : (
              <span className="min-w-0 text-xs leading-4 text-muted-foreground">{signer}</span>
            )}
          </div>
          <AuthCheckedAt at={login.verification?.checkedAt} />
          <RunsOnLine runsOn={login} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1.5 ps-11 @sm:items-end @sm:ps-0">
        {someoneElses && signedIn ? (
          <p className="text-xs leading-4 text-muted-foreground">
            {signerName.trim().length === 0
              ? "Only their crews can use it."
              : `Only ${signerName.trim()}'s crews can use it.`}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 @sm:justify-end">
          {walking && onSignIn !== undefined ? (
            <Button
              data-zerops-login-sign-in
              onClick={() => {
                onSignIn(login);
              }}
              size="compact"
              variant="pill"
            >
              Continue authorization
            </Button>
          ) : null}
          {walking && onCancel !== undefined ? (
            <Button
              onClick={() => {
                onCancel(login);
              }}
              size="compact"
              variant="ghost"
            >
              Cancel
            </Button>
          ) : null}
          {!walking &&
          login.verification?.status === "unknown" &&
          login.verification.checkedAt !== undefined &&
          !someoneElses &&
          onRecheck !== undefined ? (
            <Button
              disabled={pending}
              size="compact"
              variant="pill"
              onClick={() => onRecheck(login.agent, login.id)}
            >
              Check again
            </Button>
          ) : null}
          {!walking &&
          login.verification?.status !== "unknown" &&
          login.verification?.status !== "checking" &&
          !signedIn &&
          login.kind === "subscription" &&
          onSignIn !== undefined ? (
            <Button
              data-zerops-login-sign-in
              disabled={pending}
              onClick={() => {
                onSignIn(login);
              }}
              size="compact"
              variant={someoneElses ? "link" : "pill"}
            >
              {someoneElses ? AGENT_OWNERSHIP_RECOVERY_LABEL : "Sign in"}
            </Button>
          ) : null}
          {!walking &&
          signedIn &&
          login.kind === "subscription" &&
          !someoneElses &&
          onSignOut !== undefined ? (
            <Button
              data-zerops-login-sign-out
              disabled={pending}
              onClick={() => {
                onSignOut(login);
              }}
              size="compact"
              variant="ghost"
            >
              Sign out
            </Button>
          ) : null}
          {onRemove === undefined ? null : (
            <Button
              data-zerops-login-remove
              disabled={pending}
              onClick={() => {
                onRemove(login);
              }}
              size="compact"
              variant="ghost"
            >
              {pending ? "Working…" : "Remove"}
            </Button>
          )}
        </div>
        {login.verification?.reason === undefined ? null : (
          <p className="text-xs leading-4 text-destructive">{login.verification.reason}</p>
        )}
        {status?.error === undefined ? null : (
          <p
            className="w-full text-xs leading-4 text-destructive @sm:text-right"
            data-zerops-login-error
          >
            {status.error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * *Add another login* under an agent: for Claude a second account or an API
 * key, for Codex a second account. An account is signed in right after it is
 * added; a key is stored for that login alone.
 */
function AddLoginControl({
  agentId,
  error,
  onAdd,
}: {
  readonly agentId: ZeropsAgentId;
  readonly error?: string | undefined;
  readonly onAdd: (input: ZeropsLoginAddInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ZeropsLoginKind>("subscription");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const labelId = useId();
  const keyId = useId();
  const needsKey = kind === "apiKey";
  const ready = needsKey ? apiKey.trim().length > 0 : label.trim().length > 0;

  if (!open) {
    return (
      // The ghost button's own padding carries its words onto the rows' logo edge.
      <div className="py-2 pr-4 pl-2.5">
        <Button
          data-zerops-add-login={agentId}
          onClick={() => {
            setOpen(true);
          }}
          size="compact"
          variant="ghost"
        >
          + Add another login
        </Button>
        {error === undefined ? null : (
          <p className="ps-1.5 text-xs leading-4 text-destructive">{error}</p>
        )}
      </div>
    );
  }

  return (
    <form
      className="space-y-2 px-4 py-2.5"
      data-zerops-add-login-form={agentId}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onAdd({
          agent: agentId,
          kind,
          label: label.trim(),
          ...(needsKey ? { apiKey: apiKey.trim() } : {}),
        });
        setOpen(false);
        setLabel("");
        setApiKey("");
      }}
    >
      {agentId === "claude-code" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setKind("subscription");
            }}
            size="compact"
            type="button"
            variant={kind === "subscription" ? "pill" : "outline"}
          >
            Another account
          </Button>
          <Button
            onClick={() => {
              setKind("apiKey");
            }}
            size="compact"
            type="button"
            variant={kind === "apiKey" ? "pill" : "outline"}
          >
            API key
          </Button>
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor={labelId}>{needsKey ? "Name (optional)" : "Name"}</Label>
        <Input
          id={labelId}
          maxLength={32}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          placeholder="work"
          value={label}
        />
      </div>
      {needsKey ? (
        <div className="space-y-1">
          <Label htmlFor={keyId}>Anthropic API key</Label>
          <Input
            autoComplete="off"
            id={keyId}
            onChange={(event) => {
              setApiKey(event.target.value);
            }}
            spellCheck={false}
            type="password"
            value={apiKey}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          onClick={() => {
            setOpen(false);
          }}
          size="compact"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button disabled={!ready} size="compact" type="submit" variant="pill">
          {needsKey ? "Add key" : "Add and sign in"}
        </Button>
      </div>
    </form>
  );
}

function AgentLogo({ agentId }: { readonly agentId: ZeropsAgentId }) {
  const logoClassName = "size-4";

  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-accent shadow-xs"
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
      if (action === "check-again" || action === "register-again")
        return { label: agentAuthLabel(agent), tone: "failed" };
      if (action === "registering" && agent.verification?.status === "checking")
        return { label: "Checking", tone: "busy" };
      if (action === "registering" && agent.registration?.status === "accepted")
        return { label: "Registration accepted", tone: "off" };
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
        <div className="flex flex-wrap items-center gap-2 @sm:justify-end">
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
        data-zerops-agent-primary-action={ownership !== "someone-else" || undefined}
        onClick={() => {
          onSignIn(agent.agentId);
        }}
        size="compact"
        variant={ownership === "someone-else" ? "link" : "pill"}
      >
        {ownership === "someone-else"
          ? AGENT_OWNERSHIP_RECOVERY_LABEL
          : AGENT_SIGN_IN_LABELS[agent.agentId]}
      </Button>
    );
  }
  if (action === "registering" && agent.registration?.status === "accepted") return null;
  if (action === "registering") {
    // The watcher marks this within seconds of the credential artifact
    // appearing — there is nothing for the user to click while it does.
    return (
      <Button disabled size="compact" variant="outline">
        {agent.verification?.status === "checking" ? "Checking…" : "Registering…"}
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
    <div className="flex flex-wrap items-center gap-2 @sm:justify-end">
      <Button
        {...(ownership === "mine"
          ? { "data-zerops-agent-switch-account": true }
          : { "data-zerops-agent-use-my-account": true })}
        onClick={() => {
          onSignIn(agent.agentId);
        }}
        size="compact"
        variant={ownership === "someone-else" ? "link" : "outline"}
      >
        {ownership === "mine" ? "Switch account" : AGENT_OWNERSHIP_RECOVERY_LABEL}
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
          className="w-full text-xs leading-4 text-destructive @sm:text-right"
          data-zerops-agent-sign-out-error
        >
          {signOutError}
        </p>
      )}
    </div>
  );
}
