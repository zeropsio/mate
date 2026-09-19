/**
 * Recognising "the agent is not signed in" in a driver's own words.
 *
 * The provider says it the way a terminal would: *run `claude auth login` on
 * this environment's machine, then start a new thread*. On a Zerops Mate that
 * machine is a container the person reaches through this app and has no shell
 * on, so the instruction is one nobody reading it can follow — the same dead
 * end as a link to a Gitea they have no session for. The app can sign the
 * agent in itself (`ZeropsAgentAuthCard`), so the banner offers that instead
 * of repeating the command (the owner, 2026-09-19).
 *
 * The message is the driver's and stays the driver's: `apps/server/src/provider`
 * is a ported zone, and a diverged port is an expensive port next time. This
 * only decides how the client draws what came back.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module agentSignIn
 */

/**
 * Whether an error is an agent refusing for want of credentials.
 *
 * Matched on the one phrase every driver shares — Claude's
 * `claudeSignedOutMessage` and Antigravity's both open with it — rather than
 * on either one's full sentence, which carries a configured path and a binary
 * name that differ per environment.
 */
export function agentNeedsSignIn(error: string | null | undefined): boolean {
  return error !== null && error !== undefined && error.includes("could not authenticate");
}

/** What the banner says in place of a command nobody here can run. */
export const AGENT_SIGN_IN_MESSAGE =
  "This agent is not signed in yet. Authorize it here and start a new thread.";
