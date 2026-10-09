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
 * Each agent driver's own sentence for a turn it refused for want of a sign-in, as it opens, and
 * what the person signs in to. Whole sentences from their first word, never a phrase anywhere: Git
 * "could not authenticate with the remote" too, and that is no agent signed out.
 */
const SIGN_IN_FAILURES: ReadonlyArray<{
  readonly driver: string;
  readonly agent: string;
  readonly opens: string;
}> = [
  // `claudeSignedOutMessage`.
  {
    driver: "claudeAgent",
    agent: "Claude",
    opens: "Claude could not authenticate. For subscription login",
  },
  // `claudeStreamFailure`: a stream that died signed out.
  { driver: "claudeAgent", agent: "Claude", opens: "Claude's sign-in has expired." },
  // `AntigravityAuth`'s refusal of configured credentials.
  {
    driver: "antigravity",
    agent: "Antigravity",
    opens: "Antigravity could not authenticate with the configured credentials.",
  },
];

/**
 * The agent an error says is signed out, by the name the person signs in to; `null` where it is
 * no agent driver's own sign-in failure — or another driver's than `driver`, the conversation's
 * driver (its session's `providerName`), where that is known.
 */
export function signedOutAgent(
  error: string | null | undefined,
  driver?: string | null,
): string | null {
  if (error === null || error === undefined) return null;
  const said = error.trimStart();
  const failure = SIGN_IN_FAILURES.find(
    (entry) =>
      (driver === undefined || driver === null || driver === entry.driver) &&
      said.startsWith(entry.opens),
  );
  return failure?.agent ?? null;
}

/** Whether an error is an agent refusing for want of credentials (`signedOutAgent`). */
export function agentNeedsSignIn(
  error: string | null | undefined,
  driver?: string | null,
): boolean {
  return signedOutAgent(error, driver) !== null;
}

/** The secondary offer for replacing an existing agent sign-in. */
export const AGENT_OWNERSHIP_RECOVERY_LABEL = "Use my own account instead…";

/** What the banner says in place of a command nobody here can run, where no Mate is named. */
export const AGENT_SIGN_IN_MESSAGE =
  "This agent is not signed in yet. Authorize it here and start a new thread.";

/**
 * An error as a Mate's surface says it: a sign-in failure with the Mate as its subject and the
 * agent only what the person signs in to — "Sage is signed out of Claude. Sign in again to
 * continue." (F7: the driver's words name Claude, and its adapter does not know the Mate). Any
 * other error as it was said.
 */
export function mateErrorWords(
  error: string,
  mate: string | undefined,
  driver?: string | null,
): string {
  const agent = signedOutAgent(error, driver);
  if (agent === null) return error;
  return `${mate === undefined ? "Signed" : `${mate} is signed`} out of ${agent}. Sign in again to continue.`;
}
