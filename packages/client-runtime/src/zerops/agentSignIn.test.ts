import { describe, expect, it } from "vite-plus/test";

import { agentNeedsSignIn, mateErrorWords, signedOutAgent } from "./agentSignIn.ts";

const CLAUDE_CANNOT =
  "Claude could not authenticate. For subscription login, run `claude auth login` on this environment's machine, then start a new thread. For API-key authentication, check this instance's configured credentials.";
const CLAUDE_EXPIRED =
  "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.";
const ANTIGRAVITY_CANNOT = "Antigravity could not authenticate with the configured credentials.";

// Only an agent driver's own sentence for a refused sign-in, from its first word, and only that
// driver's where the conversation's driver is known — never another failure that happens to say
// "could not authenticate" (pass 43's review: Git's and a wrapped mirror error read as "Signed
// out of Git" with an Authorize button).
describe("an agent refusing for want of credentials", () => {
  it.each([
    {
      case: "the Claude driver's own sentence",
      error: CLAUDE_CANNOT,
      driver: undefined,
      agent: "Claude",
    },
    {
      case: "a Claude stream that died signed out",
      error: CLAUDE_EXPIRED,
      driver: undefined,
      agent: "Claude",
    },
    {
      case: "Claude's, from a Claude conversation",
      error: CLAUDE_EXPIRED,
      driver: "claudeAgent",
      agent: "Claude",
    },
    {
      case: "Antigravity's own sentence",
      error: ANTIGRAVITY_CANNOT,
      driver: "antigravity",
      agent: "Antigravity",
    },
    {
      case: "Claude's words from another driver's conversation",
      error: CLAUDE_CANNOT,
      driver: "codex",
      agent: null,
    },
    {
      case: "Git refused by its remote",
      error: "Git could not authenticate with the remote.",
      driver: undefined,
      agent: null,
    },
    {
      case: "a wrapped mirror error",
      error: "mirror_error: Git could not authenticate with the remote.",
      driver: undefined,
      agent: null,
    },
    {
      case: "the phrase past a prefix",
      error: `Error: ${CLAUDE_CANNOT}`,
      driver: undefined,
      agent: null,
    },
    {
      case: "any other failure",
      error: "The container is not reachable.",
      driver: undefined,
      agent: null,
    },
    { case: "a usage limit", error: "Claude usage limit reached.", driver: undefined, agent: null },
    { case: "nothing", error: null, driver: undefined, agent: null },
    { case: "no words", error: "", driver: undefined, agent: null },
  ])("names the agent signed out in $case: $agent", ({ error, driver, agent }) => {
    expect(signedOutAgent(error, driver)).toBe(agent);
    expect(agentNeedsSignIn(error, driver)).toBe(agent !== null);
  });
});

// F7: the Mate is the subject; the agent is only what the person signs in to.
describe("mateErrorWords — an error as a Mate's surface says it", () => {
  it.each([
    {
      case: "an expired sign-in, the Mate known",
      error: CLAUDE_EXPIRED,
      mate: "Sage",
      words: "Sage is signed out of Claude. Sign in again to continue.",
    },
    {
      case: "a refused sign-in, the Mate known",
      error: CLAUDE_CANNOT,
      mate: "Sage",
      words: "Sage is signed out of Claude. Sign in again to continue.",
    },
    {
      case: "another driver's",
      error: ANTIGRAVITY_CANNOT,
      mate: "Rune",
      words: "Rune is signed out of Antigravity. Sign in again to continue.",
    },
    {
      case: "a sign-in failure, no Mate known",
      error: CLAUDE_EXPIRED,
      mate: undefined,
      words: "Signed out of Claude. Sign in again to continue.",
    },
    {
      case: "Git's refusal, as it was said",
      error: "Git could not authenticate with the remote.",
      mate: "Sage",
      words: "Git could not authenticate with the remote.",
    },
    {
      case: "any other failure, as it was said",
      error: "Claude Code ran out of memory. Send a message to pick up where it left off.",
      mate: "Sage",
      words: "Claude Code ran out of memory. Send a message to pick up where it left off.",
    },
  ])("$case", ({ error, mate, words }) => {
    expect(mateErrorWords(error, mate)).toBe(words);
  });
});
