/**
 * Agent CLI login presentation — S7 plan D4, server-driven since follow-up
 * F8.
 *
 * The card's "Sign in" button no longer types anything into a terminal
 * itself: it asks the server (`ZeropsAgentLogin`, `zerops.agentLogin.start`)
 * to run the agent CLI's own login command in a dedicated terminal and walk
 * its output. What the user needs to act on rides back on the same
 * `ZeropsAgentAuth` row, in the optional `login` field — this module is the
 * pure classification of that field into what the card renders, mirroring
 * `classifyAgentAuth`'s own shape so a state can never get a label from one
 * branch and a button from another.
 */
import type { AtomCommandResult } from "../state/runtime.ts";
import type {
  ZeropsAgentAuth,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentLoginState,
  ZeropsAgentLoginStartResult,
} from "@t3tools/contracts";

type AgentAuthFields = Pick<ZeropsAgentAuth, "credPresent" | "providerAuth" | "state">;

/**
 * The card's whole decision tree in one place: `agentAuthLabel` and
 * `agentAuthAction` are two views onto the same classification, so a state
 * can never get a label from one branch and a button from another.
 *
 * `state` (the local container/platform-flag matrix) and `providerAuth` (a
 * live check against Claude/Codex's own account endpoint) can disagree — a
 * credential file that is present but expired, revoked, or belongs to a
 * signed-out account. `not-authorized` and `reconnect` have no credential to
 * check, so `providerAuth` is ignored for them; for the three states that
 * imply a credential is present (`authorized`, `authorized-token`,
 * `local-only`), `providerAuth` wins over `state`.
 */
type AgentAuthPresentation =
  | { readonly kind: "not-authorized" }
  | { readonly kind: "reconnect" }
  /** Credential present, but Claude/Codex itself no longer accepts it. */
  | { readonly kind: "needs-reauth" }
  /** Credential present; the live provider check hasn't answered yet. */
  | { readonly kind: "checking" }
  /** `local-only` with nothing contradicting it: the watcher will flip this within seconds. */
  | { readonly kind: "registering" }
  | { readonly kind: "authorized"; readonly token: boolean };

function classifyAgentAuth(agent: AgentAuthFields): AgentAuthPresentation {
  if (agent.state === "not-authorized") {
    return { kind: "not-authorized" };
  }
  if (agent.state === "reconnect") {
    return { kind: "reconnect" };
  }
  // From here, state is authorized | authorized-token | local-only — a
  // credential is present locally, and providerAuth is meaningful.
  if (agent.providerAuth === "unauthenticated") {
    return { kind: "needs-reauth" };
  }
  if (agent.providerAuth === "unknown" && agent.credPresent) {
    return { kind: "checking" };
  }
  if (agent.state === "local-only") {
    return { kind: "registering" };
  }
  return { kind: "authorized", token: agent.state === "authorized-token" };
}

export function agentAuthLabel(agent: AgentAuthFields): string {
  const presentation = classifyAgentAuth(agent);
  switch (presentation.kind) {
    case "not-authorized":
      return "Not signed in";
    case "reconnect":
      return "Reconnect needed — sign in again";
    case "needs-reauth":
      return "Signed in on the container, but Claude/Codex reports not authenticated — sign in again";
    case "checking":
      return "Checking…";
    case "registering":
      return "Signed in on the container — registering with Zerops…";
    case "authorized":
      return presentation.token ? "Authorized (token)" : "Authorized";
  }
}

/** What the row's action slot should render: an enabled sign-in button, a disabled placeholder, or nothing. */
export type ZeropsAgentAuthAction = "sign-in" | "registering" | "checking" | "none";

export function agentAuthAction(agent: AgentAuthFields): ZeropsAgentAuthAction {
  const presentation = classifyAgentAuth(agent);
  switch (presentation.kind) {
    case "not-authorized":
    case "reconnect":
    case "needs-reauth":
      return "sign-in";
    case "checking":
      return "checking";
    case "registering":
      return "registering";
    case "authorized":
      return "none";
  }
}

// ---------------------------------------------------------------------------
// Server-driven login session (S7 follow-up F8)
// ---------------------------------------------------------------------------

/**
 * What the card renders for an in-progress (or just-finished) server-driven
 * login session. `"none"` — no session, or a `cancelled` one (equivalent to
 * having none: the user can start a fresh one) — means the row falls back
 * to the baseline `agentAuthLabel`/`agentAuthAction` classification above.
 */
export type ZeropsAgentLoginPresentation =
  | { readonly kind: "none" }
  | { readonly kind: "starting" }
  | { readonly kind: "menu" }
  | {
      readonly kind: "awaiting-browser";
      readonly url: string | undefined;
      readonly code: string | undefined;
    }
  | { readonly kind: "awaiting-code" }
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed"; readonly message: string | undefined };

export function classifyAgentLogin(
  login: ZeropsAgentLoginState | undefined,
): ZeropsAgentLoginPresentation {
  if (login === undefined || login.phase === "cancelled") {
    return { kind: "none" };
  }
  switch (login.phase) {
    case "starting":
      return { kind: "starting" };
    case "menu":
      return { kind: "menu" };
    case "awaiting-browser":
      return { kind: "awaiting-browser", url: login.url, code: login.code };
    case "awaiting-code":
      return { kind: "awaiting-code" };
    case "succeeded":
      return { kind: "succeeded" };
    case "failed":
      return { kind: "failed", message: login.message };
  }
}

/** The text label for every login-session phase except `awaiting-browser`, which renders structured actions instead (see the card). */
export function agentLoginLabel(presentation: ZeropsAgentLoginPresentation): string {
  switch (presentation.kind) {
    case "none":
      return "";
    case "starting":
      return "Starting…";
    case "menu":
      return "Choosing “Claude account with subscription”…";
    case "awaiting-browser":
      return "Waiting for you to finish signing in";
    case "awaiting-code":
      return "Paste the code into the terminal below";
    case "succeeded":
      return "Authorized";
    case "failed":
      return presentation.message ?? "Sign-in failed";
  }
}

/**
 * What terminal id, if any, the login terminal panel should now focus once
 * `zerops.agentLogin.start` settles (S7 fix2 finding 3). A successful start
 * returns the session's own `terminalId` — the terminal UI store's
 * `ensureTerminal` needs exactly that to bring the login tab into view
 * instead of leaving whatever was previously active in front (an empty
 * shell, while the card says "Waiting for you to finish signing in"). A
 * failed/interrupted start focuses nothing — the caller's own
 * `useAtomCommand` already reports the failure.
 */
export function agentLoginTerminalToFocus(
  result: AtomCommandResult<ZeropsAgentLoginStartResult, unknown>,
): string | undefined {
  return result._tag === "Success" ? result.value.terminalId : undefined;
}

/**
 * Whether the card is worth showing at all: the feed has to be available
 * (this is a Zerops environment) and at least one agent has to need the
 * user's attention. Only the fully-`authorized` classification (state says
 * authorized AND the live provider check agrees, with no login session
 * actively running) doesn't — notably, an agent whose `state` says
 * `authorized*` but whose `providerAuth` disagrees still counts, or the
 * user would never learn they need to re-auth; likewise an agent mid-login
 * (menu/awaiting-browser/awaiting-code) keeps the card visible even if its
 * baseline `state` still reads "authorized" from a previous session.
 */
export function zeropsAgentAuthNeedsAttention(snapshot: ZeropsAgentAuthSnapshot): boolean {
  return (
    snapshot.available &&
    snapshot.agents.some(
      (agent) =>
        classifyAgentAuth(agent).kind !== "authorized" ||
        classifyAgentLogin(agent.login).kind !== "none",
    )
  );
}

/**
 * Whether the band below the thread header should demand a sign-in. One
 * authorized agent is enough to work, so the band asks only when the
 * environment has none: every listed agent is `not-authorized`, `reconnect`,
 * or `needs-reauth`. An agent still `checking`/`registering` is on its way to
 * authorized and must not flash the band while the provider answers; an empty
 * or unavailable feed has nothing to ask for. The per-agent card
 * (`zeropsAgentAuthNeedsAttention`) keeps the wider "any agent" rule.
 */
export function zeropsAgentSignInRequired(snapshot: ZeropsAgentAuthSnapshot): boolean {
  return (
    snapshot.available &&
    snapshot.agents.length > 0 &&
    snapshot.agents.every((agent) => {
      const kind = classifyAgentAuth(agent).kind;
      return kind === "not-authorized" || kind === "reconnect" || kind === "needs-reauth";
    })
  );
}
