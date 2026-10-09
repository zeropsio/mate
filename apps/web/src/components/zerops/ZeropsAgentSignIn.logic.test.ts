import type { ZeropsAgentAuth, ZeropsAgentLoginState } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  abbreviatedCode,
  agentSignInSteps,
  currentAttempt,
  openAgentOf,
  signInAgents,
  signInPhrase,
  SIGN_IN_FAILED_LINE,
  usualAgentOf,
  replacedSignInLine,
  startsAtOnce,
} from "./ZeropsAgentSignIn.logic";

const at = (iso: string): DateTime.Utc => Option.getOrThrow(DateTime.make(iso));

const login = (
  phase: ZeropsAgentLoginState["phase"],
  overrides: Partial<ZeropsAgentLoginState> = {},
): ZeropsAgentLoginState => ({
  phase,
  terminalId: "agent-login-claude-code",
  startedAt: at("2026-09-30T10:00:00.000Z"),
  ...overrides,
});

const agent = (
  agentId: ZeropsAgentAuth["agentId"],
  overrides: Partial<ZeropsAgentAuth> = {},
): ZeropsAgentAuth => ({
  agentId,
  credPresent: false,
  flagOAuth: false,
  flagToken: false,
  providerAuth: "unknown",
  state: "not-authorized",
  ...overrides,
});

const signedIn = (agentId: ZeropsAgentAuth["agentId"]) =>
  agent(agentId, {
    credPresent: true,
    flagOAuth: true,
    providerAuth: "authenticated",
    state: "authorized",
    authorizedBy: { subject: "u-other" },
  });

describe("usualAgentOf", () => {
  it.each([
    { name: "no other Mate", perMate: [], usual: null },
    { name: "other Mates signed in with nothing", perMate: [[], []], usual: null },
    { name: "all with Codex", perMate: [["codex"], ["codex"]], usual: "codex" },
    { name: "one with Claude Code", perMate: [["claude-code"]], usual: "claude-code" },
    {
      name: "more with Codex than with Claude Code",
      perMate: [["codex"], ["codex", "claude-code"], ["codex"]],
      usual: "codex",
    },
    {
      name: "a tie, which goes to the agents' own order",
      perMate: [["codex"], ["claude-code"]],
      usual: "claude-code",
    },
    { name: "an agent this sign-in does not offer", perMate: [["cursor"]], usual: null },
  ])("$name: $usual", ({ perMate, usual }) => {
    expect(usualAgentOf(perMate)).toBe(usual);
  });
});

describe("signInAgents", () => {
  it.each([
    {
      name: "both need a sign-in, no usual one",
      agents: [agent("claude-code"), agent("codex")],
      usual: null,
      offered: ["claude-code", "codex"],
    },
    {
      name: "the usual one comes first",
      agents: [agent("claude-code"), agent("codex")],
      usual: "codex" as const,
      offered: ["codex", "claude-code"],
    },
    {
      name: "one signed in by someone else: the other is offered",
      agents: [signedIn("claude-code"), agent("codex")],
      usual: null,
      offered: ["codex"],
    },
    {
      name: "one signing in right now stays offered",
      agents: [{ ...signedIn("claude-code"), login: login("awaiting-browser") }, agent("codex")],
      usual: null,
      offered: ["claude-code", "codex"],
    },
    {
      name: "every agent someone else's: all, to sign in with the person's own account",
      agents: [signedIn("claude-code"), signedIn("codex")],
      usual: null,
      offered: ["claude-code", "codex"],
    },
  ])("$name", ({ agents, usual, offered }) => {
    expect(signInAgents(agents, usual).map((entry) => entry.agentId)).toEqual(offered);
  });
});

describe("openAgentOf", () => {
  it.each([
    { name: "nothing chosen, nothing running", chosen: null, running: null, open: null },
    { name: "the chosen card", chosen: "codex" as const, running: null, open: "codex" },
    {
      name: "a login still running opens its card again after a reload",
      chosen: null,
      running: "claude-code" as const,
      open: "claude-code",
    },
    {
      name: "the person's choice over another running login",
      chosen: "codex" as const,
      running: "claude-code" as const,
      open: "codex",
    },
  ])("$name", ({ chosen, running, open }) => {
    const agents = [agent("claude-code"), agent("codex")].map((entry) =>
      entry.agentId === running ? { ...entry, login: login("awaiting-browser") } : entry,
    );
    expect(openAgentOf(agents, chosen)).toBe(open);
  });
});

describe("currentAttempt", () => {
  const since = DateTime.toEpochMillis(at("2026-09-30T10:00:00.000Z"));

  it.each(["starting", "menu", "awaiting-browser", "awaiting-code", "verifying-code"] as const)(
    "shows a login still running (%s), however old",
    (phase) => {
      const old = login(phase, { startedAt: at("2026-09-30T08:00:00.000Z") });
      expect(currentAttempt(old, since)).toEqual(old);
    },
  );

  it.each(["failed", "succeeded"] as const)(
    "never shows an earlier attempt's %s as this one's outcome",
    (phase) => {
      expect(
        currentAttempt(login(phase, { startedAt: at("2026-09-30T09:59:00.000Z") }), since),
      ).toBeUndefined();
      expect(currentAttempt(login(phase), null)).toBeUndefined();
    },
  );

  it.each(["failed", "succeeded"] as const)("shows this attempt's own %s", (phase) => {
    const own = login(phase, { startedAt: at("2026-09-30T10:00:02.000Z") });
    expect(currentAttempt(own, since)).toEqual(own);
  });

  it("reads a cancelled login as none", () => {
    expect(currentAttempt(login("cancelled"), since)).toBeUndefined();
  });
});

describe("agentSignInSteps", () => {
  const URL = "https://claude.example/oauth/authorize?code=true";

  it.each([
    {
      name: "Claude, its login starting: the page is being readied, the field waits",
      agentId: "claude-code" as const,
      login: login("starting"),
      opened: false,
      steps: { kind: "steps", page: { state: "preparing" }, second: { kind: "paste" } },
    },
    {
      name: "Claude, its page ready",
      agentId: "claude-code" as const,
      login: login("awaiting-browser", { url: URL }),
      opened: false,
      steps: { kind: "steps", page: { state: "ready", url: URL }, second: { kind: "paste" } },
    },
    {
      name: "Claude, its page opened",
      agentId: "claude-code" as const,
      login: login("awaiting-browser", { url: URL }),
      opened: true,
      steps: { kind: "steps", page: { state: "opened", url: URL }, second: { kind: "paste" } },
    },
    {
      name: "Claude, the code being checked",
      agentId: "claude-code" as const,
      login: login("verifying-code", { url: URL }),
      opened: true,
      sent: "Hk2p9wQ4xR7mQ7w",
      steps: {
        kind: "steps",
        page: { state: "opened", url: URL },
        second: { kind: "checking", code: "Hk2p9wQ4xR7mQ7w" },
      },
    },
    {
      name: "Claude on a Mate that cannot take the code in a field",
      agentId: "claude-code" as const,
      login: login("awaiting-browser", { url: URL }),
      opened: true,
      codeField: false,
      steps: { kind: "steps", page: { state: "opened", url: URL }, second: { kind: "terminal" } },
    },
    {
      name: "Codex, the code to type on its page",
      agentId: "codex" as const,
      login: login("awaiting-browser", { url: "https://openai.example/device", code: "K7QF-2M9D" }),
      opened: true,
      steps: {
        kind: "steps",
        page: { state: "opened", url: "https://openai.example/device" },
        second: { kind: "type", code: "K7QF-2M9D" },
      },
    },
    {
      name: "a failure, in its own words",
      agentId: "codex" as const,
      login: login("failed", { message: "device code expired" }),
      opened: true,
      steps: { kind: "failed", why: "Device code expired." },
    },
    {
      name: "a failure that says nothing",
      agentId: "claude-code" as const,
      login: login("failed"),
      opened: true,
      steps: { kind: "failed", why: SIGN_IN_FAILED_LINE },
    },
    {
      name: "signed in",
      agentId: "claude-code" as const,
      login: login("succeeded"),
      opened: true,
      steps: { kind: "signed-in" },
    },
  ])("$name", ({ agentId, login: attempt, opened, codeField = true, sent, steps }) => {
    expect(agentSignInSteps({ agentId, login: attempt, opened, codeField, sent })).toEqual(steps);
  });
});

describe("abbreviatedCode", () => {
  it.each([
    ["Hk2p9wQ4xR7mQ7w", "Hk2p9w…mQ7w"],
    ["  short-code  ", "short-code"],
  ])("%s reads %s", (code, shown) => {
    expect(abbreviatedCode(code)).toBe(shown);
  });
});

// The owner, 2026-09-30: "'You sign … in' … should convey you sign in with your agent
// subscription … show the logos for brand recognition". The words name every subscription the
// sign-in offers, each brand marked with the agent whose logo it wears, in the sign-in's order.
describe("signInPhrase", () => {
  it.each([
    { name: "Wren", words: "You sign Wren in with your Claude or ChatGPT subscription" },
    { name: "the Mate", words: "You sign the Mate in with your Claude or ChatGPT subscription" },
  ])("$words", ({ name, words }) => {
    const parts = signInPhrase(name);
    expect(parts.map((part) => part.text).join("")).toBe(words);
    expect(
      parts.flatMap((part) => (part.agentId === undefined ? [] : [[part.agentId, part.text]])),
    ).toEqual([
      ["claude-code", "Claude"],
      ["codex", "ChatGPT"],
    ]);
  });
});

describe("startsAtOnce: a dialog's login starts without a press only where nothing is held", () => {
  it.each([
    [{}, true],
    [{ credPresent: false }, true],
    [{ credPresent: true }, false],
  ])("%o starts at once: %s", (agent, starts) => {
    expect(startsAtOnce(agent)).toBe(starts);
  });
});

describe("replacedSignInLine: whose sign-in a login replaces, said before the press", () => {
  const nameOf = (subject: string) => (subject === "u-ann" ? "Ann" : undefined);
  it.each([
    ["nobody recorded", undefined, "Signing in replaces the sign-in Codex has now."],
    ["the person's own", { subject: "u-bo" }, "Signing in replaces your own sign-in."],
    [
      "a colleague, by name",
      { subject: "u-ann" },
      "This replaces Ann's sign-in for this agent on this Mate.",
    ],
    [
      "a colleague not named",
      { subject: "u-cy" },
      "This replaces another project member's sign-in for this agent on this Mate.",
    ],
  ] as const)("%s", (_case, authorizedBy, line) => {
    expect(
      replacedSignInLine({ agentId: "codex", authorizedBy, viewerSubject: "u-bo", nameOf }),
    ).toBe(line);
  });
});
