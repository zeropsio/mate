import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  isMateStandUpAsk,
  MATE_STAND_UP_MESSAGE,
  mateArrivalHoldsComposer,
  mateStandUpAskLine,
  mateStandUpCleared,
  mateStandUpDecision,
  mateStandUpHoldsComposer,
  mateStandUpPhase,
  mateStandUpSendIds,
  mateStandUpSignedIn,
  type MateStandUpInput,
} from "./mateStandUp";

const ADA = "u-ada";
const FEN = "u-fen";

/** The moment right after Ada's sign-in: every condition of the send holds. */
const DUE: MateStandUpInput = {
  marker: { by: ADA },
  viewer: ADA,
  conversation: "empty",
  signedIn: true,
  sentThisSession: false,
  sendInFlight: false,
};

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
    expect(mateStandUpAskLine({ name: "Fen", project }, asker)).toBe(line);
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

describe("mateArrivalHoldsComposer", () => {
  it.each([
    { standUpHolds: true, signInRequired: false, empty: false, holds: true },
    { standUpHolds: false, signInRequired: true, empty: true, holds: true },
    // A conversation under way keeps its composer, whatever its sign-in says: it is read.
    { standUpHolds: false, signInRequired: true, empty: false, holds: false },
    { standUpHolds: false, signInRequired: false, empty: true, holds: false },
  ])(
    "stand-up $standUpHolds, no agent $signInRequired, empty $empty: holds $holds",
    ({ holds, ...input }) => {
      expect(mateArrivalHoldsComposer(input)).toBe(holds);
    },
  );
});

describe("mateStandUpDecision", () => {
  it.each<{
    readonly name: string;
    readonly input: Partial<MateStandUpInput>;
    readonly expected: string;
  }>([
    { name: "every condition holds", input: {}, expected: "send" },
    { name: "the project asks nothing", input: { marker: undefined }, expected: "nothing" },
    { name: "somebody else asked it", input: { viewer: FEN }, expected: "nothing" },
    { name: "who is looking is not known", input: { viewer: undefined }, expected: "nothing" },
    {
      name: "the conversation has started",
      input: { conversation: "started" },
      expected: "nothing",
    },
    { name: "this session already sent it", input: { sentThisSession: true }, expected: "nothing" },
    {
      name: "already sent, and the conversation shows it",
      input: { sentThisSession: true, conversation: "started" },
      expected: "nothing",
    },
    {
      name: "the conversation is still being read",
      input: { conversation: "unknown" },
      expected: "wait",
    },
    { name: "the agent is not signed in yet", input: { signedIn: false }, expected: "wait" },
    { name: "another send is on its way", input: { sendInFlight: true }, expected: "wait" },
    // The server starts it itself (`capabilities.setup.serverStandUp`): no client sends it.
    { name: "the server stands it up itself", input: { serverStandUp: true }, expected: "nothing" },
    {
      name: "the server stands it up itself, the agent not signed in yet",
      input: { serverStandUp: true, signedIn: false },
      expected: "nothing",
    },
    // An older server says nothing of it: the client still sends it.
    {
      name: "an older server, which says nothing",
      input: { serverStandUp: false },
      expected: "send",
    },
    {
      name: "a reload that reads a conversation holding it",
      input: { conversation: "started", signedIn: true },
      expected: "nothing",
    },
  ])("$name: $expected", ({ input, expected }) => {
    expect(mateStandUpDecision({ ...DUE, ...input })).toBe(expected);
  });

  it("two clients of one person deciding at the same moment send the identical command", () => {
    // The owner's browser and a second one, both Ada's, both watching the
    // sign-in land: each decides to send, and each derives the same ids from
    // the conversation, so the server takes the command once (its receipts).
    const thread = "thread-main";
    const clients = [DUE, { ...DUE }].map((input) => ({
      decision: mateStandUpDecision(input),
      ids: mateStandUpSendIds(thread, 1),
    }));
    expect(clients.map((client) => client.decision)).toEqual(["send", "send"]);
    expect(clients[0]?.ids).toEqual(clients[1]?.ids);
  });
});

describe("mateStandUpHoldsComposer", () => {
  it.each([
    {
      name: "its person, the conversation still empty",
      marker: { by: "u-ada" },
      viewer: "u-ada",
      conversation: "empty" as const,
      failed: false,
      holds: true,
    },
    {
      name: "its person, the conversation not read yet: nothing to type over the headline",
      marker: { by: "u-ada" },
      viewer: "u-ada",
      conversation: "unknown" as const,
      failed: false,
      holds: true,
    },
    {
      name: "the conversation under way",
      marker: { by: "u-ada" },
      viewer: "u-ada",
      conversation: "started" as const,
      failed: false,
      holds: false,
    },
    {
      name: "the stand-up did not go through: the person may write it themselves",
      marker: { by: "u-ada" },
      viewer: "u-ada",
      conversation: "empty" as const,
      failed: true,
      holds: false,
    },
    {
      name: "a colleague",
      marker: { by: "u-ada" },
      viewer: "u-otto",
      conversation: "empty" as const,
      failed: false,
      holds: false,
    },
    {
      name: "a Mate nobody asked it of",
      marker: undefined,
      viewer: "u-ada",
      conversation: "empty" as const,
      failed: false,
      holds: false,
    },
  ])("$name: $holds", ({ marker, viewer, conversation, failed, holds }) => {
    expect(mateStandUpHoldsComposer({ marker, viewer, conversation, failed })).toBe(holds);
  });
});

describe("mateStandUpSendIds", () => {
  it.each([
    { thread: "thread-main", attempt: 1, id: "mate-standup-thread-main-1" },
    { thread: "thread-main", attempt: 2, id: "mate-standup-thread-main-2" },
    { thread: "thread-other", attempt: 1, id: "mate-standup-thread-other-1" },
  ])("are the conversation's own: $thread, attempt $attempt", ({ thread, attempt, id }) => {
    expect(mateStandUpSendIds(thread, attempt)).toEqual({ commandId: id, messageId: id });
  });
});

describe("mateStandUpCleared", () => {
  it.each([
    {
      name: "the conversation holds the ask",
      conversation: "started" as const,
      viewer: ADA,
      expected: true,
    },
    {
      name: "the ask has not landed",
      conversation: "empty" as const,
      viewer: ADA,
      expected: false,
    },
    {
      name: "the conversation is still being read",
      conversation: "unknown" as const,
      viewer: ADA,
      expected: false,
    },
    {
      name: "the ask is somebody else's to clear",
      conversation: "started" as const,
      viewer: FEN,
      expected: false,
    },
  ])("$name: $expected", ({ conversation, viewer, expected }) => {
    expect(mateStandUpCleared({ marker: { by: ADA }, viewer, conversation })).toBe(expected);
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
    { name: "no agent is signed in", agents: snapshot(), local: {}, expected: false },
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
      local: {},
      expected: true,
    },
    {
      name: "the viewer's agent, its record written by this client and not read back yet",
      agents: snapshot(agent({ credPresent: true, flagOAuth: true, state: "authorized" })),
      local: { "claude-code": ADA },
      expected: true,
    },
    {
      name: "the viewer's sign-in just succeeded, its record on its way",
      agents: snapshot(
        agent({ credPresent: true, state: "local-only", login: { ...SUCCEEDED, startedBy: ADA } }),
      ),
      local: {},
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
      local: {},
      expected: false,
    },
    {
      name: "a login nobody recorded",
      agents: snapshot(agent({ credPresent: true, flagOAuth: true, state: "authorized" })),
      local: {},
      expected: false,
    },
    {
      name: "a token the project holds",
      agents: snapshot(agent({ flagToken: true, state: "authorized-token" })),
      local: {},
      expected: true,
    },
  ])("$name: $expected", ({ agents, local, expected }) => {
    expect(mateStandUpSignedIn(agents, ADA, local)).toBe(expected);
  });
});

describe("mateStandUpPhase", () => {
  const ASKED = { marker: { by: ADA }, viewer: ADA, main: true, attempt: "none" as const };
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
      name: "on its way",
      input: { signIn: "signed-in" as const, attempt: "sending" as const },
      expected: "standing-up",
    },
    {
      name: "failed",
      input: { signIn: "signed-in" as const, attempt: "failed" as const },
      expected: "failed",
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
