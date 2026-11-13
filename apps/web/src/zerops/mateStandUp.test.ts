import { ZeropsUserId } from "@t3tools/contracts";
import type { OtherAgentFields } from "@t3tools/client-runtime/zerops/agentLogin";
import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  mateStandUpConversation,
  isMateStandUpAsk,
  MATE_STAND_UP_MESSAGE,
  mateStandUpAskLine,
  mateStandUpHoldsComposer,
  mateStandUpPhase,
  mateStandUpSignedIn,
  mateSetupRetryState,
  mateStandUpStopped,
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

const ADA = ZeropsUserId.make("u-ada");
const FEN = ZeropsUserId.make("u-fen");

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

describe("mateStandUpConversation", () => {
  it("A conversation that already holds messages gives the composer back while it is still being read", () => {
    expect(mateStandUpConversation({ main: true, messageCount: 3, live: false })).toBe("started");
  });

  it("Only a conversation read live from its Mate is known to be empty", () => {
    expect(mateStandUpConversation({ main: true, messageCount: 0, live: true })).toBe("empty");
    expect(mateStandUpConversation({ main: true, messageCount: 0, live: false })).toBe("unknown");
  });

  it("The stand-up speaks of the Mate's main conversation alone", () => {
    expect(mateStandUpConversation({ main: false, messageCount: 0, live: true })).toBe("unknown");
    expect(mateStandUpConversation({ main: null, messageCount: 0, live: true })).toBe("unknown");
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
  const ASKED = { marker: { by: ADA }, viewer: ADA, awaited: true };
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
      input: { signIn: "signed-in" as const, awaited: false },
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

/** A run of the Mate's main conversation, as its record reads: the stand-up's, ended failed. */
const standUpRun = (
  edit: {
    readonly principal?:
      | { readonly kind: "standup"; readonly startedBy: string }
      | {
          readonly kind: "person";
          readonly subject: string;
        };
    readonly end?:
      | { readonly kind: "failed"; readonly reason: string; readonly next: null }
      | {
          readonly kind: "completed";
        }
      | null;
    readonly state?: "queued" | "running" | "ended";
    readonly items?: number;
  } = {},
) => ({
  principal: edit.principal ?? { kind: "standup" as const, startedBy: ADA },
  end:
    edit.end === undefined
      ? { kind: "failed" as const, reason: "Could not confirm access.", next: null }
      : edit.end,
  state: edit.state ?? ("ended" as const),
  summary: { items: edit.items ?? 0, calls: {}, answerItemId: null, lastItemSeq: null },
});

describe("a setup that never started is the Mate's arrival, not a conversation", () => {
  // witness: apps/web/src/zerops/mateStandUp.ts | if (run.principal.kind !== "standup" || run.summary.items > 0) return null; → if (run.principal.kind !== "standup") return null;
  it("reads a conversation holding only its stand-up's runs that ended before their first step", () => {
    expect(mateStandUpStopped([standUpRun()], false)).toEqual({
      by: ADA,
      failures: 1,
      waiting: false,
    });
    expect(mateStandUpStopped([standUpRun({ items: 3 })], false)).toBeNull();
  });

  // witness: apps/web/src/zerops/mateStandUp.ts | if (personWrote) return null; → if (false) return null;
  it("is a conversation again once its person writes, or anything else ran in it", () => {
    expect(mateStandUpStopped([standUpRun()], true)).toBeNull();
    expect(
      mateStandUpStopped(
        [standUpRun(), standUpRun({ principal: { kind: "person", subject: "zerops-user:u-ada" } })],
        false,
      ),
    ).toBeNull();
    expect(
      mateStandUpStopped([standUpRun(), standUpRun({ end: null, state: "running" })], false),
    ).toBeNull();
  });

  // witness: apps/web/src/zerops/mateStandUp.ts | return by === undefined || failures === 0 ? null : { by, failures, waiting }; → return by === undefined ? null : { by, failures, waiting };
  it("leaves a first stand-up on its way to the conversation, and holds a retried one until it begins", () => {
    expect(mateStandUpStopped([standUpRun({ end: null, state: "queued" })], false)).toBeNull();
    expect(
      mateStandUpStopped([standUpRun(), standUpRun({ end: null, state: "queued" })], false),
    ).toEqual({ by: ADA, failures: 1, waiting: true });
  });
});

describe("Try again on a setup that never started never answers with silence", () => {
  const pressed = (answer: "sending" | "went" | "refused" | "unreachable") => ({
    answer,
    failures: 1,
  });

  // witness: apps/web/src/zerops/mateStandUp.ts | return "refused"; → return "ready";
  it.each([
    { name: "unpressed", press: null, failures: 1, settling: false, state: "ready" },
    { name: "sent", press: pressed("sending"), failures: 1, settling: true, state: "sending" },
    {
      name: "taken by the Mate",
      press: pressed("went"),
      failures: 1,
      settling: true,
      state: "starting",
    },
    { name: "stopped again", press: pressed("went"), failures: 2, settling: false, state: "again" },
    {
      name: "refused by the Mate",
      press: pressed("refused"),
      failures: 1,
      settling: false,
      state: "refused",
    },
    {
      name: "not reaching the Mate",
      press: pressed("unreachable"),
      failures: 1,
      settling: false,
      state: "unreachable",
    },
    {
      name: "a second failure after a reload",
      press: null,
      failures: 2,
      settling: false,
      state: "again",
    },
  ] as const)("$name: $state", ({ press, failures, settling, state }) => {
    expect(mateSetupRetryState({ press, failures, waiting: false, settling })).toBe(state);
  });

  // witness: apps/web/src/zerops/mateStandUp.ts | if (input.waiting) return "starting"; → if (false) return "starting";
  it("shows the Mate starting while a retried attempt waits to begin, whoever pressed", () => {
    expect(mateSetupRetryState({ press: null, failures: 1, waiting: true, settling: false })).toBe(
      "starting",
    );
  });
});
