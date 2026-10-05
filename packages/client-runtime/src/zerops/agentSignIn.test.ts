import { describe, expect, it } from "vite-plus/test";

import { agentNeedsSignIn, mateErrorWords, signedOutAgent } from "./agentSignIn.ts";

const CLAUDE_CANNOT =
  "Claude could not authenticate. For subscription login, run `claude auth login` on this environment's machine, then start a new thread. For API-key authentication, check this instance's configured credentials.";
const CLAUDE_EXPIRED =
  "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.";
const ANTIGRAVITY_CANNOT = "Antigravity could not authenticate with the configured credentials.";

describe("an agent refusing for want of credentials", () => {
  it.each([
    { case: "the Claude driver's own sentence", error: CLAUDE_CANNOT, agent: "Claude" },
    { case: "a Claude stream that died signed out", error: CLAUDE_EXPIRED, agent: "Claude" },
    {
      case: "another driver's, worded differently",
      error: ANTIGRAVITY_CANNOT,
      agent: "Antigravity",
    },
    { case: "words said after a prefix", error: `Error: ${CLAUDE_CANNOT}`, agent: "Claude" },
    { case: "any other failure", error: "The container is not reachable.", agent: null },
    { case: "a usage limit", error: "Claude usage limit reached.", agent: null },
    { case: "nothing", error: null, agent: null },
    { case: "no words", error: "", agent: null },
  ])("names the agent signed out in $case", ({ error, agent }) => {
    expect(signedOutAgent(error)).toBe(agent);
    expect(agentNeedsSignIn(error)).toBe(agent !== null);
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
      case: "any other failure, as it was said",
      error: "Claude Code ran out of memory. Send a message to pick up where it left off.",
      mate: "Sage",
      words: "Claude Code ran out of memory. Send a message to pick up where it left off.",
    },
  ])("$case", ({ error, mate, words }) => {
    expect(mateErrorWords(error, mate)).toBe(words);
  });
});
