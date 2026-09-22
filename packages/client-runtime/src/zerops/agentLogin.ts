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
import {
  classifyZeropsAgentAuth,
  type ZeropsAgentAuthFields,
} from "@t3tools/shared/zeropsAgentAuth";

type AgentAuthFields = ZeropsAgentAuthFields;

/**
 * The card's labels and actions are two views onto the one classification
 * every surface shares (`@t3tools/shared/zeropsAgentAuth`): the platform flag
 * decides, the agent CLI's own check only refines it. So a state can never get
 * a label from one branch and a button from another, and the row can never
 * disagree with the model picker.
 */
const classifyAgentAuth = classifyZeropsAgentAuth;

export function agentAuthLabel(agent: AgentAuthFields): string {
  const presentation = classifyAgentAuth(agent);
  switch (presentation.kind) {
    case "not-authorized":
      return "Not signed in";
    case "reconnect":
      return "This container has no login for it — sign in again";
    case "needs-reauth":
      return "Its login no longer works — sign in again";
    case "registering":
      return "Signed in — registering with Zerops…";
    case "authorized":
      return presentation.token ? "Authorized (token)" : "Authorized";
  }
}

/** What the row's action slot should render: an enabled sign-in button, a disabled placeholder, or nothing. */
export type ZeropsAgentAuthAction = "sign-in" | "registering" | "none";

export function agentAuthAction(agent: AgentAuthFields): ZeropsAgentAuthAction {
  const presentation = classifyAgentAuth(agent);
  switch (presentation.kind) {
    case "not-authorized":
    case "reconnect":
    case "needs-reauth":
      return "sign-in";
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
  | { readonly kind: "verifying-code" }
  /** The login succeeded and the agent's own check has not answered yet — row only, see {@link classifyAgentRowLogin}. */
  | { readonly kind: "confirming" }
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
    case "verifying-code":
      return { kind: "verifying-code" };
    case "succeeded":
      return { kind: "succeeded" };
    case "failed":
      return { kind: "failed", message: login.message };
  }
}

/**
 * The login as an agent's row shows it, next to the verified status. A login
 * still running is what the row is about; a finished one steps aside, or it
 * would outlive the truth — a `succeeded` session stays in the feed until the
 * next start, and the row said "Authorized" long after a sign-out. So
 * `succeeded` shows the verified status itself once the agent's check has
 * answered (the server resets it to `unknown` when the login succeeds), and
 * is `confirming` until then — never "signed out" over a login that just
 * succeeded. `failed` shows the verified status too once that says the agent
 * is signed in after all (the terminal, another browser). The dialog reads the raw phase: it is the one place a finished
 * attempt is still the subject.
 */
export function classifyAgentRowLogin(
  agent: AgentAuthFields & Pick<ZeropsAgentAuth, "login">,
): ZeropsAgentLoginPresentation {
  const login = classifyAgentLogin(agent.login);
  if (login.kind === "succeeded") {
    return classifyAgentAuth(agent).kind !== "authorized" && agent.providerAuth === "unknown"
      ? { kind: "confirming" }
      : { kind: "none" };
  }
  if (login.kind === "failed" && classifyAgentAuth(agent).kind === "authorized") {
    return { kind: "none" };
  }
  return login;
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
      return "Paste the code from your browser";
    case "verifying-code":
      return "Checking the code…";
    case "confirming":
      return "Confirming the sign-in…";
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
 * user would never learn they need to re-auth; likewise an agent mid-login,
 * or whose last attempt failed ({@link classifyAgentRowLogin}), keeps the
 * card visible even if its baseline `state` still reads "authorized" from a
 * previous session.
 */
export function zeropsAgentAuthNeedsAttention(snapshot: ZeropsAgentAuthSnapshot): boolean {
  return (
    snapshot.available &&
    snapshot.agents.some(
      (agent) =>
        classifyAgentAuth(agent).kind !== "authorized" ||
        classifyAgentRowLogin(agent).kind !== "none",
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
