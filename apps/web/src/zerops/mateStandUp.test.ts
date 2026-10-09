import type { OtherAgentFields } from "@t3tools/client-runtime/zerops/agentLogin";
import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  isMateStandUpAsk,
  MATE_STAND_UP_MESSAGE,
  mateStandUpAskLine,
  mateStandUpHoldsComposer,
  mateStandUpPhase,
  mateStandUpSignedIn,
} from "./mateStandUp";

/** A provider instance as the server sends it: signed in, models listed, unless said otherwise. */
const agentInstance = (driver: string, status = "ready"): OtherAgentFields =>
  ({
    driver,
    enabled: true,
    installed: true,
    status,
    auth: { status: status === "ready" ? "authenticated" : "unauthenticated" },
    models: [{ slug: "m" }],
  }) as unknown as OtherAgentFields;

const ADA = "u-ada";
const FEN = "u-fen";

describe("the stand-up's words", () => {
  it("are the owner's, word for word", () => {
    expect(MATE_STAND_UP_MESSAGE).toBe("Stand up development of the project.");
  });

  // The ask is drawn as a quiet line, never a bubble in the person's words.
  it.each([
    {
      asker: "you" as const,
      project: "Acme Docs",
      line: "You asked Fen to stand up development of Acme Docs",
    },
    {
      asker: "someone" as const,
      project: "Acme Docs",
      line: "Fen was asked to stand up development of Acme Docs",
    },
    {
      asker: "you" as const,
      project: undefined,
      line: "You asked Fen to stand up development of the project",
    },
  ])("draw the ask, for $asker in $project: $line", ({ asker, project, line }) => {
    expect(
      mateStandUpAskLine(
        { name: "Fen", project, standUp: { by: asker === "you" ? "viewer" : "another" } },
        "viewer",
      ),
    ).toBe(line);
  });

  it.each([
    [MATE_STAND_UP_MESSAGE, true],
    [`  ${MATE_STAND_UP_MESSAGE}\n`, true],
    ["Stand up development of the project, then add a blog.", false],
    ["stand up development of the project.", false],
  ])("know the ask by its exact words: %j is %s", (text, ask) => {
    expect(isMateStandUpAsk(text)).toBe(ask);
  });
});

describe("mateStandUpHoldsComposer", () => {
  it.each([
    {
      name: "its person, the conversation still empty",
      marker: { by: "u-ada" },
      viewer: "u-ada",
      conversation: "empty" as const,
      holds: true,
    },
    {
      name: "its person, the conversation not read yet: nothing to type over the headline",
      marker: { by: "u-ada" },
      viewer: "u-ada",
      conversation: "unknown" as const,
      holds: true,
    },
    {
      name: "the conversation under way",
      marker: { by: "u-ada" },
      viewer: "u-ada",
      conversation: "started" as const,
      holds: false,
    },
    {
      name: "a colleague",
      marker: { by: "u-ada" },
      viewer: "u-otto",
      conversation: "empty" as const,
      holds: false,
    },
    {
      name: "a Mate nobody asked it of",
      marker: undefined,
      viewer: "u-ada",
      conversation: "empty" as const,
      holds: false,
    },
  ])("$name: $holds", ({ marker, viewer, conversation, holds }) => {
    expect(mateStandUpHoldsComposer({ marker, viewer, conversation })).toBe(holds);
  });
});

const agent = (overrides: Partial<ZeropsAgentAuth>): ZeropsAgentAuth => ({
  agentId: "claude-code",
  credPresent: false,
  flagOAuth: false,
  flagToken: false,
  providerAuth: "unknown",
  state: "not-authorized",
  ...overrides,
});

const snapshot = (...agents: ReadonlyArray<ZeropsAgentAuth>): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: [...agents, agent({ agentId: "codex" })],
});

const SUCCEEDED = {
  phase: "succeeded" as const,
  terminalId: "login-1",
  startedAt: DateTime.makeUnsafe("2026-09-29T10:00:00.000Z"),
};

describe("mateStandUpSignedIn", () => {
  it.each([
    { name: "no agent is signed in", agents: snapshot(), expected: false },
    {
      name: "the viewer's agent, recorded",
      agents: snapshot(
        agent({
          credPresent: true,
          flagOAuth: true,
          state: "authorized",
          authorizedBy: { subject: ADA },
        }),
      ),
      expected: true,
    },
    {
      name: "the viewer's sign-in just succeeded, recorded as theirs with it",
      agents: snapshot(
        agent({
          credPresent: true,
          state: "local-only",
          login: { ...SUCCEEDED, startedBy: ADA },
          authorizedBy: { subject: ADA },
        }),
      ),
      expected: true,
    },
    {
      name: "a colleague's agent: the viewer signs in their own",
      agents: snapshot(
        agent({
          credPresent: true,
          flagOAuth: true,
          state: "authorized",
          authorizedBy: { subject: FEN },
        }),
      ),
      expected: false,
    },
    {
      name: "a login nobody recorded",
      agents: snapshot(agent({ credPresent: true, flagOAuth: true, state: "authorized" })),
      expected: false,
    },
    {
      name: "a token the project holds",
      agents: snapshot(agent({ flagToken: true, state: "authorized-token" })),
      expected: true,
    },
    // An agent Mate never signs anybody in to runs for whoever is looking.
    {
      name: "nobody signed in, Cursor ready",
      agents: snapshot(),
      local: {},
      providers: [agentInstance("cursor")],
      expected: true,
    },
    {
      name: "a colleague's agent, OpenCode ready",
      agents: snapshot(
        agent({
          credPresent: true,
          flagOAuth: true,
          state: "authorized",
          authorizedBy: { subject: FEN },
        }),
      ),
      local: {},
      providers: [agentInstance("opencode")],
      expected: true,
    },
    {
      name: "nobody signed in, Cursor not signed in either",
      agents: snapshot(),
      local: {},
      providers: [agentInstance("cursor", "error")],
      expected: false,
    },
  ])("$name: $expected", ({ agents, providers, expected }) => {
    expect(mateStandUpSignedIn(agents, ADA, providers)).toBe(expected);
  });
});

describe("mateStandUpPhase", () => {
  const ASKED = { marker: { by: ADA }, viewer: ADA, main: true };
  it.each([
    { name: "sign-in required", input: { signIn: "required" as const }, expected: "sign-in" },
    // Nothing painted that a known answer takes back: the common answer for a Mate just made.
    {
      name: "the sign-in still being read",
      input: { signIn: "unknown" as const },
      expected: "sign-in",
    },
    { name: "signed in", input: { signIn: "signed-in" as const }, expected: "standing-up" },
    {
      name: "signed in by a colleague: the viewer signs in their own",
      input: { signIn: "someone-else" as const },
      expected: "sign-in",
    },
    {
      name: "a colleague looking",
      input: { signIn: "required" as const, viewer: FEN },
      expected: null,
    },
    {
      name: "a Mate nobody asked it of",
      input: { signIn: "required" as const, marker: undefined },
      expected: null,
    },
    {
      name: "another of the Mate's chats",
      input: { signIn: "signed-in" as const, main: false },
      expected: null,
    },
  ])("$name: $expected", ({ input, expected }) => {
    expect(mateStandUpPhase({ ...ASKED, ...input })).toBe(expected);
  });
});

describe("a failed stand-up no longer holds a person in an empty conversation", () => {
  it.each(["empty", "unknown"] as const)(
    "releases the composer with the conversation %s",
    (conversation) => {
      expect(
        mateStandUpHoldsComposer({
          marker: { by: "u-ada" },
          viewer: "u-ada",
          conversation,
          failed: true,
        }),
      ).toBe(false);
    },
  );
});
