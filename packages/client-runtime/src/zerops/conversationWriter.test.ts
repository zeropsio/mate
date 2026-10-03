import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  conversationFooter,
  rememberableWriter,
  resolveConversationWriter,
  type ConversationWriter,
  type ConversationWriterInput,
} from "./conversationWriter.ts";
import type { Known } from "./knowledge/known.ts";

const STAMP = { ordinal: 1, atMs: 0 };

const claude = (fields: Partial<ZeropsAgentAuth> = {}): ZeropsAgentAuth =>
  ({
    agentId: "claude-code",
    state: "authorized",
    flagOAuth: true,
    flagToken: false,
    credPresent: true,
    ...fields,
  }) as ZeropsAgentAuth;

const snapshot = (
  agents: ReadonlyArray<ZeropsAgentAuth>,
  available = true,
): ZeropsAgentAuthSnapshot => ({ available, agents: [...agents] }) as ZeropsAgentAuthSnapshot;

const known = (value: ZeropsAgentAuthSnapshot): Known<ZeropsAgentAuthSnapshot> => ({
  state: "known",
  value,
  asOf: STAMP,
  coverage: "complete",
  freshness: { kind: "live" },
});

const PROVIDERS = [
  { instanceId: "claudeAgent", driver: "claudeAgent" },
  { instanceId: "codex", driver: "codex" },
  { instanceId: "opencode", driver: "opencode" },
];

const input = (fields: Partial<ConversationWriterInput>): ConversationWriterInput => ({
  feed: known(snapshot([claude()])),
  instanceId: "claudeAgent",
  providers: PROVIDERS,
  viewerSubject: "viewer-1",
  ownership: "mine",
  ...fields,
});

describe("resolveConversationWriter", () => {
  it.each<{
    readonly name: string;
    readonly input: ConversationWriterInput;
    readonly expected: ConversationWriter["kind"];
  }>([
    {
      name: "the sign-in feed not read yet is unknown, whatever the ownership defaulted to",
      input: input({ feed: { state: "unread", waitingFor: null }, ownership: "none" }),
      expected: "unknown",
    },
    {
      name: "the sign-in feed being read is unknown",
      input: input({ feed: { state: "reading", sinceMs: 0, attempt: 1 }, ownership: "none" }),
      expected: "unknown",
    },
    {
      name: "the conversation's instance not read yet is unknown",
      input: input({ instanceId: undefined, ownership: "none" }),
      expected: "unknown",
    },
    {
      name: "a signed-in agent missing from the snapshot is unknown, not nobody's",
      input: input({ feed: known(snapshot([])), ownership: "none" }),
      expected: "unknown",
    },
    {
      name: "a viewer not known yet is unknown, not the recorded signer's",
      input: input({ viewerSubject: undefined, ownership: "unrecorded" }),
      expected: "unknown",
    },
    {
      name: "the viewer's own sign-in is theirs to write in",
      input: input({ ownership: "mine" }),
      expected: "you",
    },
    {
      name: "another member's sign-in is someone else's",
      input: input({ ownership: "someone-else" }),
      expected: "someone",
    },
    {
      name: "no credential at all is nobody's yet",
      input: input({ feed: known(snapshot([claude({ credPresent: false })])), ownership: "none" }),
      expected: "nobody-yet",
    },
    {
      name: "a sign-in recorded for nobody is nobody's yet",
      input: input({ ownership: "unrecorded" }),
      expected: "nobody-yet",
    },
    {
      name: "a sign-in recorded for two people is nobody's yet",
      input: input({ ownership: "unsettled" }),
      expected: "nobody-yet",
    },
    {
      name: "the viewer's failed record is nobody's yet",
      input: input({ ownership: "record-failed" }),
      expected: "nobody-yet",
    },
    {
      name: "a token belongs to the project: anyone writes",
      input: input({
        feed: known(snapshot([claude({ flagToken: true, flagOAuth: false })])),
        viewerSubject: undefined,
        ownership: "unrecorded",
      }),
      expected: "you",
    },
    {
      name: "an agent nobody signs in to through Mate is anyone's",
      input: input({ instanceId: "opencode", ownership: "none" }),
      expected: "you",
    },
    {
      name: "outside a Zerops environment nothing is signed in: anyone writes",
      input: input({ feed: known(snapshot([], false)), ownership: "none" }),
      expected: "you",
    },
    {
      name: "with no environment there is no sign-in to wait for",
      input: input({ feed: undefined, ownership: "none" }),
      expected: "you",
    },
    {
      name: "a read that ended without an answer is nobody's yet: the server stays the gate",
      input: input({
        feed: {
          state: "failed",
          failure: { kind: "unsupported", capability: "agentAuth" },
          atMs: 0,
          attempt: 1,
          retryAtMs: null,
        },
        ownership: "none",
      }),
      expected: "nobody-yet",
    },
  ])("$name", ({ input: given, expected }) => {
    expect(resolveConversationWriter(given).kind).toBe(expected);
  });
});

describe("conversationFooter", () => {
  const UNKNOWN: ConversationWriter = { kind: "unknown" };
  it.each<{
    readonly name: string;
    readonly writer: ConversationWriter;
    readonly remembered: ReturnType<typeof rememberableWriter>;
    readonly expected: ReturnType<typeof conversationFooter>;
  }>([
    {
      name: "unknown, nothing remembered: the room held",
      writer: UNKNOWN,
      remembered: undefined,
      expected: "held",
    },
    {
      name: "unknown, remembered yours: the composer",
      writer: UNKNOWN,
      remembered: "you",
      expected: "composer",
    },
    {
      name: "unknown, remembered someone's: the strip",
      writer: UNKNOWN,
      remembered: "someone",
      expected: "read-only",
    },
    {
      name: "unknown, remembered nobody's: the room held",
      writer: UNKNOWN,
      remembered: "nobody-yet",
      expected: "held",
    },
    {
      name: "yours: the composer",
      writer: { kind: "you" },
      remembered: "someone",
      expected: "composer",
    },
    {
      name: "someone's: the strip",
      writer: { kind: "someone" },
      remembered: "you",
      expected: "read-only",
    },
    {
      name: "nobody's yet: the composer, with its sign-in",
      writer: { kind: "nobody-yet" },
      remembered: undefined,
      expected: "composer",
    },
  ])("$name", ({ writer, remembered, expected }) => {
    expect(conversationFooter(writer, remembered)).toBe(expected);
  });

  it("never offers a composer on an unknown answer it does not remember as the viewer's", () => {
    for (const remembered of [undefined, "someone", "nobody-yet"] as const) {
      expect(conversationFooter(UNKNOWN, remembered)).not.toBe("composer");
    }
  });
});

describe("rememberableWriter", () => {
  it.each<{ readonly writer: ConversationWriter; readonly expected: string | undefined }>([
    { writer: { kind: "unknown" }, expected: undefined },
    { writer: { kind: "you" }, expected: "you" },
    { writer: { kind: "someone" }, expected: "someone" },
    { writer: { kind: "nobody-yet" }, expected: "nobody-yet" },
  ])("$writer.kind → $expected", ({ writer, expected }) => {
    expect(rememberableWriter(writer)).toBe(expected);
  });
});
