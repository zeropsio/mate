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
 * The agent a driver's words say is signed out, by the name the person signs in to; `null` where
 * they say nothing of the kind.
 *
 * Matched on the phrases the drivers share rather than on any one's full sentence, which carries a
 * configured path and a binary name that differ per environment: "could not authenticate" (Claude's
 * `claudeSignedOutMessage`, Antigravity's) and "'s sign-in has expired" (a Claude stream that died
 * signed out, `claudeStreamFailure`). The name is the one just before the phrase.
 */
export function signedOutAgent(error: string | null | undefined): string | null {
  if (error === null || error === undefined) return null;
  return SIGNED_OUT.exec(error)?.[1] ?? null;
}

const SIGNED_OUT =
  /(?:^|\b)([A-Z][\w-]*(?: [A-Z][\w-]*)?)(?:'s sign-in has expired| could not authenticate)/u;

/** Whether an error is an agent refusing for want of credentials (`signedOutAgent`). */
export function agentNeedsSignIn(error: string | null | undefined): boolean {
  return signedOutAgent(error) !== null;
}

/** What the banner says in place of a command nobody here can run, where no Mate is named. */
export const AGENT_SIGN_IN_MESSAGE =
  "This agent is not signed in yet. Authorize it here and start a new thread.";

/**
 * An error as a Mate's surface says it: a sign-in failure with the Mate as its subject and the
 * agent only what the person signs in to — "Sage is signed out of Claude. Sign in again to
 * continue." (F7: the driver's words name Claude, and its adapter does not know the Mate). Any
 * other error as it was said.
 */
export function mateErrorWords(error: string, mate: string | undefined): string {
  const agent = signedOutAgent(error);
  if (agent === null) return error;
  return `${mate === undefined ? "Signed" : `${mate} is signed`} out of ${agent}. Sign in again to continue.`;
}
