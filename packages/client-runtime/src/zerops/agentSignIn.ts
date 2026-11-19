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
import type { ZeropsAgentId } from "@t3tools/contracts";

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

// What a person is told they sign a Mate in with, and which agent is a project's usual one.

export const ZEROPS_AGENT_NAMES = {
  "claude-code": "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  grok: "Grok",
  cursor: "Cursor",
} as const satisfies Record<ZeropsAgentId, string>;

/**
 * How an agent's sign-in finishes once its page is open (`ZEROPS_AGENT_LOGIN_COMMANDS`):
 * - `paste` — the page shows a code the person pastes back (Claude Code, Antigravity);
 * - `code` — the person confirms the code the sign-in shows on the page (Codex, Grok);
 * - `approve` — the person approves on the page and the agent sees it by itself (Cursor).
 */
export type AgentSignInFlow = "paste" | "code" | "approve";

/** Each agent as the sign-in introduces it: its name, whose account it needs, its provider's page. */
export const AGENT_SIGN_IN_CARDS = {
  "claude-code": {
    name: "Claude Code",
    account: "With your Claude account",
    site: "Claude",
    brand: "Claude",
    flow: "paste",
  },
  codex: {
    name: "Codex",
    account: "With your ChatGPT account",
    site: "OpenAI",
    brand: "ChatGPT",
    flow: "code",
  },
  antigravity: {
    name: "Antigravity",
    account: "With your Google account",
    site: "Google",
    brand: "Google",
    flow: "paste",
  },
  grok: {
    name: "Grok",
    account: "With your Grok account",
    site: "xAI",
    brand: "Grok",
    flow: "code",
  },
  cursor: {
    name: "Cursor",
    account: "With your Cursor account",
    site: "Cursor",
    brand: "Cursor",
    flow: "approve",
  },
} as const satisfies Record<
  ZeropsAgentId,
  {
    readonly name: string;
    readonly account: string;
    readonly site: string;
    /** The subscription it signs in with, as its person knows it. */
    readonly brand: string;
    readonly flow: AgentSignInFlow;
  }
>;

/**
 * The press that signs an agent in, by the short name the person knows it by — "Sign in to
 * Claude", not the CLI's own "Claude Code".
 */
export const AGENT_SIGN_IN_LABELS = {
  "claude-code": "Sign in to Claude",
  codex: "Sign in to Codex",
  antigravity: "Sign in to Antigravity",
  grok: "Sign in to Grok",
  cursor: "Sign in to Cursor",
} as const satisfies Record<ZeropsAgentId, string>;

/** A piece of the words that tell a person they will sign a Mate in: plain, or an agent's brand. */
export interface SignInPhrasePart {
  readonly text: string;
  /** The agent whose subscription this names, whose logo it wears. */
  readonly agentId?: ZeropsAgentId;
}

/**
 * The person's own step wherever it is told ahead — the arrival's steps, the add dialogs' *What
 * happens next*: what they sign the Mate in with, every subscription the sign-in offers named by
 * its brand, in the sign-in's own order (the owner, 2026-09-30).
 */
export function signInPhrase(mateName: string): ReadonlyArray<SignInPhrasePart> {
  const brands = AGENT_ORDER.flatMap((agentId, index): ReadonlyArray<SignInPhrasePart> => [
    ...(index === 0 ? [] : [{ text: index === AGENT_ORDER.length - 1 ? " or " : ", " }]),
    { text: AGENT_SIGN_IN_CARDS[agentId].brand, agentId },
  ]);
  return [{ text: `You sign ${mateName} in with your ` }, ...brands, { text: " subscription" }];
}

/** The words of {@link signInPhrase}, whole. */
export const signInPhraseWords = (parts: ReadonlyArray<SignInPhrasePart>): string =>
  parts.map((part) => part.text).join("");

const AGENT_ORDER: ReadonlyArray<ZeropsAgentId> = [
  "claude-code",
  "codex",
  "antigravity",
  "grok",
  "cursor",
];

const isAgentId = (value: string): value is ZeropsAgentId =>
  (AGENT_ORDER as ReadonlyArray<string>).includes(value);

/**
 * The project's usual agent: the one its other Mates are signed in with (`agentSelection.ts`, one
 * list per Mate). Where they use both, the one more of them use; a tie goes to the first in the
 * agents' own order. `null` where none of them is signed in with anything.
 */
export function usualAgentOf(perMate: ReadonlyArray<ReadonlyArray<string>>): ZeropsAgentId | null {
  const counts = new Map<ZeropsAgentId, number>();
  for (const agents of perMate) {
    for (const agent of new Set(agents)) {
      if (isAgentId(agent)) counts.set(agent, (counts.get(agent) ?? 0) + 1);
    }
  }
  let usual: ZeropsAgentId | null = null;
  for (const agent of AGENT_ORDER) {
    const count = counts.get(agent) ?? 0;
    if (count > 0 && (usual === null || count > (counts.get(usual) ?? 0))) usual = agent;
  }
  return usual;
}
