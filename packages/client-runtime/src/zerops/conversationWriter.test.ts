import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  conversationFooter,
  hqConversationWriter,
  resolveConversationWriter,
  signInReadSettled,
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

describe("hqConversationWriter", () => {
  const SIGNERS = { "claude-code": "u-ada", codex: "u-bob" } as const;
  it.each<{
    readonly name: string;
    readonly input: Parameters<typeof hqConversationWriter>[0];
    readonly expected: ConversationWriter["kind"];
  }>([
    {
      name: "the viewer signed the spent agent in: yours",
      input: {
        instanceId: "claudeAgent",
        providers: PROVIDERS,
        signers: SIGNERS,
        viewerSubject: "u-ada",
      },
      expected: "you",
    },
    {
      name: "a colleague signed it in: someone's",
      input: {
        instanceId: "codex",
        providers: PROVIDERS,
        signers: SIGNERS,
        viewerSubject: "u-ada",
      },
      expected: "someone",
    },
    {
      name: "HQ names nobody for the spent agent: nobody's yet",
      input: {
        instanceId: "codex",
        providers: PROVIDERS,
        signers: { "claude-code": "u-ada" },
        viewerSubject: "u-ada",
      },
      expected: "nobody-yet",
    },
    {
      name: "HQ has not said: unknown",
      input: {
        instanceId: "claudeAgent",
        providers: PROVIDERS,
        signers: undefined,
        viewerSubject: "u-ada",
      },
      expected: "unknown",
    },
    {
      name: "the instance is not read yet: unknown",
      input: {
        instanceId: undefined,
        providers: PROVIDERS,
        signers: SIGNERS,
        viewerSubject: "u-ada",
      },
      expected: "unknown",
    },
    {
      name: "the viewer is not known yet: unknown",
      input: {
        instanceId: "claudeAgent",
        providers: PROVIDERS,
        signers: SIGNERS,
        viewerSubject: undefined,
      },
      expected: "unknown",
    },
    {
      // A second login of an agent has its own signer, which only the Mate knows.
      name: "a login beyond the agent's own: unknown",
      input: {
        instanceId: "claudeAgent_work",
        providers: [...PROVIDERS, { instanceId: "claudeAgent_work", driver: "claudeAgent" }],
        signers: SIGNERS,
        viewerSubject: "u-ada",
      },
      expected: "unknown",
    },
    {
      name: "an agent Mate signs nobody in to: yours",
      input: {
        instanceId: "opencode",
        providers: PROVIDERS,
        signers: undefined,
        viewerSubject: undefined,
      },
      expected: "you",
    },
  ])("$name", ({ input, expected }) => {
    expect(hqConversationWriter(input).kind).toBe(expected);
  });
});

describe("conversationFooter", () => {
  const UNKNOWN: ConversationWriter = { kind: "unknown" };
  it.each<{
    readonly name: string;
    readonly mate: ConversationWriter;
    readonly hq: ConversationWriter;
    readonly expected: ReturnType<typeof conversationFooter>;
  }>([
    { name: "neither has said: the room held", mate: UNKNOWN, hq: UNKNOWN, expected: "held" },
    {
      name: "HQ says yours: the composer at once",
      mate: UNKNOWN,
      hq: { kind: "you" },
      expected: "composer",
    },
    {
      name: "HQ says someone's: the strip at once",
      mate: UNKNOWN,
      hq: { kind: "someone" },
      expected: "read-only",
    },
    {
      name: "HQ says nobody's yet: the composer, with its sign-in",
      mate: UNKNOWN,
      hq: { kind: "nobody-yet" },
      expected: "composer",
    },
    // The Mate's own sign-in is the authority: signed out meanwhile, it corrects HQ's word.
    {
      name: "the Mate says yours over HQ's someone",
      mate: { kind: "you" },
      hq: { kind: "someone" },
      expected: "composer",
    },
    {
      name: "the Mate says someone's over HQ's yours",
      mate: { kind: "someone" },
      hq: { kind: "you" },
      expected: "read-only",
    },
    {
      name: "the Mate says nobody's yet",
      mate: { kind: "nobody-yet" },
      hq: UNKNOWN,
      expected: "composer",
    },
  ])("$name", ({ mate, hq, expected }) => {
    expect(conversationFooter(mate, hq)).toBe(expected);
  });
});

describe("signInReadSettled", () => {
  it.each<{
    readonly name: string;
    readonly feed: ConversationWriterInput["feed"];
    readonly settled: boolean;
  }>([
    { name: "no environment", feed: undefined, settled: false },
    { name: "not read yet", feed: { state: "unread", waitingFor: null }, settled: false },
    { name: "being read", feed: { state: "reading", sinceMs: 0, attempt: 1 }, settled: false },
    { name: "read", feed: known(snapshot([claude()])), settled: true },
    {
      name: "failed: nothing more comes of this read",
      feed: {
        state: "failed",
        failure: { kind: "unsupported", capability: "agentAuth" },
        atMs: 0,
        attempt: 1,
        retryAtMs: null,
      },
      settled: true,
    },
  ])("$name → $settled", ({ feed, settled }) => {
    expect(signInReadSettled(feed)).toBe(settled);
  });
});
