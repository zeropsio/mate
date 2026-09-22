/**
 * Whether a coding agent is signed in on a Zerops project — one answer for
 * every surface that asks: the agent rows, the thread's band, the empty
 * conversation (client) and the model picker (the server's overlay on the
 * provider statuses it sends).
 *
 * The platform flag decides, as it does everywhere else in Zerops: the
 * `ZCP_AGENT_OAUTH_<SUFFIX>` / `ZCP_AGENT_TOKEN_<SUFFIX>` env on the project's
 * zcp service, written by whoever signs the agent in (this app through
 * `zcp agent mark-oauth`, or the Zerops GUI) and read by the Zerops GUI, the
 * VS Code panel and Mate alike. The moment it is set, the agent is signed in
 * — its state (`ZeropsAgentAuth.state`, the welcome panel's matrix) says
 * `authorized` and nothing waits for a further check.
 *
 * The agent CLI's own status check (`providerAuth`) runs behind it and only
 * refines the answer: a definite "not logged in" under a set flag means the
 * login this project recorded no longer works here (expired, revoked, the
 * container rebuilt) and the agent must be signed in again. A check that has
 * not answered (`unknown`) changes nothing.
 */
import type { ZeropsAgentAuth, ZeropsAgentId } from "@t3tools/contracts";

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
 * What an agent that cannot be picked says about it — the model picker's
 * tooltip. Each names the one thing to do, where it is done.
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
      return `${name} is signed in on this project, but this container has no login for it (it was rebuilt). Sign in again from the Zerops panel.`;
    case "needs-reauth":
      return `${name}'s login on this project no longer works. Sign in again from the Zerops panel.`;
    case "not-authorized":
      return `${name} is not signed in on this project. Sign in from the Zerops panel.`;
  }
}
