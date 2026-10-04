/**
 * Whether a coding agent is signed in on a Zerops project — one answer for
 * every surface that asks: the agent rows, the thread's band, the empty
 * conversation (client) and the model picker (the server's overlay on the
 * provider statuses it sends).
 *
 * The platform flag decides, as it does everywhere else in Zerops: the
 * `ZCP_AGENT_OAUTH_<SUFFIX>` / `ZCP_AGENT_TOKEN_<SUFFIX>` env on the project's
 * zcp service, written by whoever signs the agent in — this server, through
 * the Zerops API; the Zerops GUI; or zcp's own `agent mark-oauth`, used by
 * the VS Code panel — and read by the Zerops GUI, the VS Code panel and Mate
 * alike. The moment it is set, the agent is signed in — its state
 * (`ZeropsAgentAuth.state`, the welcome panel's matrix) says `authorized` and
 * nothing waits for a further check.
 *
 * The agent CLI's own status check (`providerAuth`) runs behind it and only
 * refines the answer: a definite "not logged in" under a set flag means the
 * login this project recorded no longer works here (expired, revoked, the
 * container rebuilt) and the agent must be signed in again. A check that has
 * not answered (`unknown`) changes nothing.
 */
import { agentIdForDriverKind } from "@t3tools/contracts";
import type {
  ServerProvider,
  ZeropsAgentAuth,
  ZeropsAgentId,
  ZeropsAgentLoginState,
  ZeropsLogin,
} from "@t3tools/contracts";

export type ZeropsAgentAuthFields = Pick<ZeropsAgentAuth, "credPresent" | "providerAuth" | "state">;

export type ZeropsAgentAuthKind =
  /** Flag set, nothing contradicting it: the agent can be picked and run. */
  | { readonly kind: "authorized"; readonly token: boolean }
  /** Signed in inside this container, the flag not written yet — seconds, normally. */
  | { readonly kind: "registering" }
  /** The flag is set but this container has no credential for it (a rebuild): sign in again. */
  | { readonly kind: "reconnect" }
  /** The agent's own check says its login no longer works: sign in again. */
  | { readonly kind: "needs-reauth" }
  | { readonly kind: "not-authorized" };

export function classifyZeropsAgentAuth(agent: ZeropsAgentAuthFields): ZeropsAgentAuthKind {
  switch (agent.state) {
    case "not-authorized":
      return { kind: "not-authorized" };
    case "reconnect":
      return { kind: "reconnect" };
    case "local-only":
      return agent.providerAuth === "unauthenticated"
        ? { kind: "needs-reauth" }
        : { kind: "registering" };
    case "authorized":
    case "authorized-token":
      return agent.providerAuth === "unauthenticated"
        ? { kind: "needs-reauth" }
        : { kind: "authorized", token: agent.state === "authorized-token" };
  }
}

const AGENT_NAMES: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

/**
 * What every surface calls a login: the agent, or "Claude API key" for a
 * key, then the name the person gave it — "Claude Code · work". The model
 * picker shows the same words as the instance's display name.
 */
export function zeropsLoginTitle(login: Pick<ZeropsLogin, "agent" | "kind" | "label">): string {
  const base = login.kind === "apiKey" ? "Claude API key" : AGENT_NAMES[login.agent];
  const label = login.label.trim();
  return label.length === 0 ? base : `${base} · ${label}`;
}

/**
 * What an agent that cannot be picked says about it — the model picker's
 * tooltip, and (since D6's `turnRefusal` reuses this classification) the
 * server's own refusal text for the same agent. Neither names a specific
 * place to act: the model picker itself offers sign-in per agent now, the
 * Zerops panel's card still does too, and a future client may offer it
 * somewhere else again — the text says what to do, not where.
 */
export function zeropsAgentUnavailableReason(
  agentId: ZeropsAgentId,
  kind: Exclude<ZeropsAgentAuthKind["kind"], "authorized">,
): string {
  const name = AGENT_NAMES[agentId];
  switch (kind) {
    case "registering":
      return `${name} is signed in and being registered with Zerops. It will be ready in a moment.`;
    case "reconnect":
      return `${name} is signed in on this project, but this container has no login for it (it was rebuilt). Sign in again.`;
    case "needs-reauth":
      return `${name}'s login on this project no longer works. Sign in again.`;
    case "not-authorized":
      return `${name} is not signed in on this project. Sign it in to use it.`;
  }
}

/**
 * {@link zeropsAgentUnavailableReason} for a login. A default login is its
 * agent's; another login has no platform flag, so "registering" is its own
 * check still answering and a lost login is simply one to sign in again.
 */
export function zeropsLoginUnavailableReason(
  login: Pick<ZeropsLogin, "agent" | "kind" | "label" | "default">,
  kind: Exclude<ZeropsAgentAuthKind["kind"], "authorized">,
): string {
  if (login.default) return zeropsAgentUnavailableReason(login.agent, kind);
  const title = zeropsLoginTitle(login);
  switch (kind) {
    case "registering":
      return `${title} is signed in and being checked. It will be ready in a moment.`;
    case "reconnect":
    case "needs-reauth":
      return `${title}'s login on this project no longer works. Sign in again.`;
    case "not-authorized":
      return login.kind === "apiKey"
        ? `${title} has no key stored on this project. Add it again.`
        : `${title} is not signed in on this project. Sign it in to use it.`;
  }
}

/**
 * The latest sign-in of a login that succeeded, whatever was started after it: this attempt if it
 * succeeded, else the success it carries (`lastSucceeded`). An attempt started, cancelled or
 * failed after a sign-in changes nothing about whose credential it is.
 */
export function latestSucceededSignIn<At>(
  login:
    | (Pick<ZeropsAgentLoginState, "phase" | "startedBy"> & {
        readonly startedAt: At;
        readonly lastSucceeded?:
          | { readonly startedAt: At; readonly startedBy?: string | undefined }
          | undefined;
      })
    | undefined,
): { readonly startedAt: At; readonly startedBy?: string | undefined } | undefined {
  if (login === undefined) return undefined;
  if (login.phase === "succeeded") {
    return login.startedBy === undefined
      ? { startedAt: login.startedAt }
      : { startedAt: login.startedAt, startedBy: login.startedBy };
  }
  return login.lastSucceeded;
}

/** What {@link isProviderReadyToRun} reads of a provider instance (`ServerProvider`). */
export type ProviderReadinessFields = Pick<
  ServerProvider,
  "driver" | "enabled" | "installed" | "availability" | "status" | "auth"
> & { readonly models: ReadonlyArray<unknown> };

/**
 * Whether a turn can start on a provider instance — one test for the browser's gates and the
 * server's choices (the bootstrap thread's model, the stand-up's agent). `status === "ready"` is
 * the driver's own verdict; a driver that says ready while knowing it has no session is refused
 * by its auth, and one listing no models is refused too: a model it has not confirmed it serves
 * is the failure this exists to prevent.
 */
export const isProviderReadyToRun = (provider: ProviderReadinessFields): boolean =>
  provider.enabled &&
  provider.installed &&
  provider.availability !== "unavailable" &&
  provider.status === "ready" &&
  provider.auth.status !== "unauthenticated" &&
  provider.models.length > 0;

/**
 * Whether an instance is a ready agent Mate signs nobody in to — Cursor, OpenCode, Grok,
 * Antigravity: ready to run, and its sign-in read as signed in. Grok and Cursor can say `ready`
 * with a sign-in they could not read (`unknown`); that one never stands in for a sign-in. Claude
 * Code and Codex never count: the agent-auth feed answers for them, and the person (D6).
 */
export const isAgentWithoutSignInReady = (provider: ProviderReadinessFields): boolean =>
  agentIdForDriverKind(provider.driver) === undefined &&
  isProviderReadyToRun(provider) &&
  provider.auth.status === "authenticated";
