/**
 * The sign-in, as one module everywhere a coding agent is signed in (the approved "Arrival" board,
 * S1): two cards with the agents' own logos, each saying whose account it needs — the project's
 * usual agent first — and the chosen card opening in place into two numbered steps. Claude: open
 * Claude, then paste the code it shows, which signs in on paste. Codex: open OpenAI, then type the
 * short code shown here, which finishes by itself. The login itself runs in the Mate
 * (`zerops.agentLogin.start`, walked by `ZeropsAgentLogin`), started as the card opens so its page
 * is ready by the time the person reaches for it; what it prints stays behind *Show what's
 * happening*.
 *
 * Pure: which agents are offered and in what order, which card stands open, and what each step
 * says for where the login stands.
 */
import { agentAuthAction } from "@t3tools/client-runtime/zerops/agentLogin";
import type { ZeropsAgentAuth, ZeropsAgentId, ZeropsAgentLoginState } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export const ZEROPS_AGENT_NAMES = {
  "claude-code": "Claude Code",
  codex: "Codex",
} as const satisfies Record<ZeropsAgentId, string>;

/** Each agent as the sign-in introduces it: its name, whose account it needs, its provider's page. */
export const AGENT_SIGN_IN_CARDS = {
  "claude-code": {
    name: "Claude Code",
    account: "With your Claude account",
    site: "Claude",
    brand: "Claude",
  },
  codex: { name: "Codex", account: "With your ChatGPT account", site: "OpenAI", brand: "ChatGPT" },
} as const satisfies Record<
  ZeropsAgentId,
  {
    readonly name: string;
    readonly account: string;
    readonly site: string;
    /** The subscription it signs in with, as its person knows it. */
    readonly brand: string;
  }
>;

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

/** What the one agent the project's other Mates are signed in with is called on its card. */
export const USUAL_AGENT_WORD = "Usual";

/** Why the card says so. */
export const USUAL_AGENT_TITLE = "The agent this project's other Mates are signed in with";

const AGENT_ORDER: ReadonlyArray<ZeropsAgentId> = ["claude-code", "codex"];

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

const RUNNING_PHASES: ReadonlySet<ZeropsAgentLoginState["phase"]> = new Set([
  "starting",
  "menu",
  "awaiting-browser",
  "awaiting-code",
  "verifying-code",
]);

/** A login still running: the one the sign-in shows, whoever started it and wherever. */
export const loginRunning = (login: ZeropsAgentLoginState | undefined): boolean =>
  login !== undefined && RUNNING_PHASES.has(login.phase);

/**
 * The agents a sign-in offers, the usual one first: those that need a sign-in, and one whose login
 * is under way. Where every agent is signed in by someone else, all of them — signing one in with
 * the person's own account is what makes it theirs.
 */
export function signInAgents(
  agents: ReadonlyArray<ZeropsAgentAuth>,
  usual: ZeropsAgentId | null,
): ReadonlyArray<ZeropsAgentAuth> {
  const needing = agents.filter(
    (agent) => agentAuthAction(agent) === "sign-in" || loginRunning(agent.login),
  );
  const offered = needing.length > 0 ? needing : agents;
  return [...offered].sort(
    (left, right) => Number(right.agentId === usual) - Number(left.agentId === usual),
  );
}

/**
 * Whether a dialog opened on an agent starts its login at once: only where the agent holds no
 * credential. A login started drops the one the agent holds (Toby, 2026-10-02: the dialog opened
 * over a working Codex sign-in, and the probe read it signed out two seconds later), so where one
 * stands — a colleague's, the person's own, one nobody recorded — the person presses first.
 */
export const startsAtOnce = (agent: Partial<Pick<ZeropsAgentAuth, "credPresent">>): boolean =>
  agent.credPresent !== true;

/** The press that starts a login over a sign-in the agent holds. */
export const REPLACE_SIGN_IN_PRESS = "Sign in with your account";

/**
 * What signing in replaces, said before the press: whose sign-in it is where the Mate recorded it,
 * and never an accusation where it did not (`ZeropsAgentAuth.authorizedBy`: absent is unknown).
 */
export function replacedSignInLine(input: {
  readonly agentId: ZeropsAgentId;
  readonly authorizedBy: { readonly subject: string } | undefined;
  readonly viewerSubject: string | undefined;
  /** A member's name by their user id. */
  readonly nameOf: (subject: string) => string | undefined;
}): string {
  const { authorizedBy } = input;
  if (authorizedBy === undefined) {
    return `Signing in replaces the sign-in ${ZEROPS_AGENT_NAMES[input.agentId]} has now.`;
  }
  if (authorizedBy.subject === input.viewerSubject) return "Signing in replaces your own sign-in.";
  const name = input.nameOf(authorizedBy.subject)?.trim();
  return `This replaces ${name || "another project member"}'s sign-in for this agent on this Mate.`;
}

/**
 * The card standing open: the one the person chose, else one whose login is still running — a
 * login started in another tab, or before a reload, opens its own card again.
 */
export function openAgentOf(
  agents: ReadonlyArray<Pick<ZeropsAgentAuth, "agentId" | "login">>,
  chosen: ZeropsAgentId | null,
): ZeropsAgentId | null {
  if (chosen !== null && agents.some((agent) => agent.agentId === chosen)) return chosen;
  return agents.find((agent) => loginRunning(agent.login))?.agentId ?? null;
}

/**
 * The attempt a card shows: a login still running, however old; a finished one only if it began
 * after the card opened (`since`, wall ms). A failure left from an earlier attempt is not this
 * one's outcome, and the card starts afresh.
 */
export function currentAttempt(
  login: ZeropsAgentLoginState | undefined,
  since: number | null,
): ZeropsAgentLoginState | undefined {
  if (login === undefined || login.phase === "cancelled") return undefined;
  if (loginRunning(login)) return login;
  if (since === null) return undefined;
  return DateTime.toEpochMillis(login.startedAt) >= since ? login : undefined;
}

/** Step one: the provider's page — its address not printed yet, ready, or opened by the person. */
export type SignInPageStep =
  | { readonly state: "preparing" }
  | { readonly state: "ready"; readonly url: string }
  | { readonly state: "opened"; readonly url: string | undefined };

/** Step two: Claude's code to paste, the code being checked, Codex's code to type, or the terminal. */
export type SignInSecondStep =
  | { readonly kind: "paste" }
  | { readonly kind: "checking"; readonly code: string | undefined }
  | { readonly kind: "type"; readonly code: string | undefined }
  | { readonly kind: "terminal" };

export type AgentSignInSteps =
  | {
      readonly kind: "steps";
      readonly page: SignInPageStep;
      readonly second: SignInSecondStep;
    }
  | { readonly kind: "failed"; readonly why: string }
  | { readonly kind: "signed-in" };

/** What a sign-in says where its login stopped without a reason. */
export const SIGN_IN_FAILED_LINE = "The sign-in didn't finish.";

/**
 * The open card's steps for where its login stands: the page is ready once the login printed its
 * address, and opened once the person pressed *Open*; Claude's second step takes the code in a
 * field (or, where the Mate cannot take one, in its terminal) until it is being checked; Codex's
 * shows the code to type on its page.
 */
export function agentSignInSteps(input: {
  readonly agentId: ZeropsAgentId;
  /** The attempt the card shows (`currentAttempt`). */
  readonly login: ZeropsAgentLoginState | undefined;
  /** The person pressed *Open* on this attempt. */
  readonly opened: boolean;
  /** The Mate takes Claude's code in a field (`agentLoginCode`). */
  readonly codeField: boolean;
  /** The code this card sent, while it is checked. */
  readonly sent: string | undefined;
}): AgentSignInSteps {
  const { agentId, login, opened, codeField, sent } = input;
  if (login?.phase === "succeeded") return { kind: "signed-in" };
  if (login?.phase === "failed") {
    const why = login.message?.trim() ?? "";
    return { kind: "failed", why: why.length > 0 ? sentence(why) : SIGN_IN_FAILED_LINE };
  }
  const url = login?.url;
  const page: SignInPageStep = opened
    ? { state: "opened", url }
    : url === undefined
      ? { state: "preparing" }
      : { state: "ready", url };
  if (agentId === "codex")
    return { kind: "steps", page, second: { kind: "type", code: login?.code } };
  const second: SignInSecondStep =
    login?.phase === "verifying-code" || sent !== undefined
      ? { kind: "checking", code: sent }
      : codeField
        ? { kind: "paste" }
        : { kind: "terminal" };
  return { kind: "steps", page, second };
}

function sentence(words: string): string {
  const capital = words.charAt(0).toUpperCase() + words.slice(1);
  return /[.!?]$/u.test(capital) ? capital : `${capital}.`;
}

/** A pasted code as it reads while it is checked: its ends, never the whole of it. */
export function abbreviatedCode(code: string): string {
  const trimmed = code.trim();
  return trimmed.length <= 12 ? trimmed : `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

/** The words of an open card's steps, the Mate's name in them where it has one. */
export function agentSignInWords(agentId: ZeropsAgentId, mateName: string | null) {
  const { site } = AGENT_SIGN_IN_CARDS[agentId];
  const it = mateName ?? "It";
  return {
    open:
      agentId === "claude-code"
        ? `Open Claude and approve ${mateName ?? "the sign-in"}.`
        : "Open OpenAI and sign in with your ChatGPT account.",
    openPress: `Open ${site}`,
    opening: `${site} is opening in a new tab…`,
    opened: `${site} is open in a new tab.`,
    openAgain: "Open again",
    paste: "Paste the code Claude shows you.",
    pastePlaceholder: "Paste the code",
    pasteHint: `${it} signs in as soon as you paste it.`,
    checking: "Checking",
    terminal: "Paste the code into the terminal below.",
    type: "Type this code on OpenAI's page.",
    typeHint: `${it} signs in by itself once you do.`,
    copy: "Copy",
    copied: "Copied",
    tryAgain: "Try again",
    signedIn: `Signed in with ${AGENT_SIGN_IN_CARDS[agentId].name}.`,
    switchTo: `Use ${ZEROPS_AGENT_NAMES[agentId === "claude-code" ? "codex" : "claude-code"]} instead`,
  };
}

/** The open card's foot: whose account the Mate runs on, and who may give it tasks. */
export const signInFoot = (mateName: string | null): string =>
  `${mateName ?? "It"} runs on your account. Only you can give it tasks.`;

export const SHOW_WHATS_HAPPENING = "Show what's happening";
export const HIDE_WHATS_HAPPENING = "Hide what's happening";
