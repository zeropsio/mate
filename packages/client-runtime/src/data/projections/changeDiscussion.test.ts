import { describe, expect, it } from "vite-plus/test";

import {
  discussionId,
  hqDiscussionScope,
  type HqDiscussionValue,
} from "../families/hqDiscussion.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { changeDiscussion, discussionGate } from "./changeDiscussion.ts";

const ORG = "org";
const LINK = { appId: "shop", repo: "web", number: 7 };
const SCOPE = hqDiscussionScope(ORG, LINK);
const COMMENT = {
  id: "c1",
  authorUserId: "u1",
  authorMateProjectId: null,
  body: "Ship it",
  createdAt: "2026-10-06T10:00:00.000Z",
};

const stream = (key: ScopeKey | ReturnType<typeof linkKeys.hq>, event: StreamEvent) =>
  ({ kind: "stream", key, now: 0, event }) as const satisfies AccountInput;
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);

const demanded = apply(emptyAccount, [
  stream(linkKeys.hq(ORG), { kind: "demand", demanded: true }),
  stream(SCOPE, { kind: "demand", demanded: true }),
  stream(SCOPE, { kind: "attempt" }),
  stream(SCOPE, { kind: "handshake" }),
]);

const revision = { kind: "hq", incarnation: "i", revision: 1 } as const;
const delivered = (value: HqDiscussionValue): AccountInput => ({
  kind: "delivery",
  via: "hq-stream",
  scopes: [{ scope: SCOPE, generation: 1 }],
  reset: true,
  rows: [{ family: "hqDiscussion", id: discussionId(LINK), revision, value }],
  removals: [],
});
const read = apply(demanded, [
  stream(linkKeys.hq(ORG), { kind: "handshake" }),
  stream(linkKeys.hq(ORG), { kind: "baseline-committed" }),
  delivered({ comments: [COMMENT] }),
  { kind: "hq-ready", scopes: [{ scope: SCOPE, generation: 1 }] },
  stream(SCOPE, { kind: "baseline-committed" }),
]);
const broke = {
  kind: "fault",
  fault: { outcome: "transient", message: "HQ's stream broke." },
  jitter: 0,
} as const;
const down = apply(read, [stream(linkKeys.hq(ORG), broke), stream(SCOPE, { kind: "parent-lost" })]);
const neverRead = apply(demanded, [
  stream(linkKeys.hq(ORG), broke),
  stream(SCOPE, { kind: "parent-lost" }),
]);
const refused = apply(demanded, [
  stream(SCOPE, {
    kind: "fault",
    fault: { outcome: "definitive-refusal", message: "You may not read this change." },
    jitter: 0,
  }),
]);

/** HQ's scope error, as the HQ adapter hands it to the scope: its reason, else its code named. */
const scopeError = (
  disposition: "refused" | "transient",
  code: string,
  reason: string | null,
): AccountState =>
  apply(demanded, [
    stream(SCOPE, {
      kind: "fault",
      fault: {
        outcome: disposition === "refused" ? "definitive-refusal" : "transient",
        message: reason ?? `HQ could not read this (${code}).`,
        code,
      },
      jitter: 0,
    }),
  ]);

const discussion = (state: AccountState) =>
  changeDiscussion.derive(readsOfState(state), { orgId: ORG, link: LINK });

describe("changeDiscussion", () => {
  it.each([
    { name: "not asked", state: emptyAccount, expected: { kind: "reading" } },
    { name: "first read", state: demanded, expected: { kind: "reading" } },
    { name: "read", state: read, expected: { kind: "read", comments: [COMMENT] } },
    { name: "HQ down after a read", state: down, expected: { kind: "read", comments: [COMMENT] } },
    {
      name: "HQ down before any read",
      state: neverRead,
      expected: { kind: "failed", reason: "HQ is not answering right now." },
    },
    {
      name: "refused",
      state: refused,
      expected: { kind: "failed", reason: "You may not read this change." },
    },
    {
      name: "a change HQ has no record of",
      state: scopeError("refused", "change_not_found", "change_not_found"),
      expected: { kind: "failed", reason: "HQ has no such change." },
    },
    {
      name: "a refusal HQ gave no reason for",
      state: scopeError("refused", "forbidden", null),
      expected: { kind: "failed", reason: "HQ refused this (forbidden)." },
    },
    {
      name: "HQ failing to read it for now",
      state: scopeError("transient", "read_failed", null),
      expected: { kind: "failed", reason: "HQ is not answering right now." },
    },
    {
      name: "a deadline the supervisor named",
      state: apply(demanded, [
        stream(SCOPE, {
          kind: "fault",
          fault: { outcome: "transient", message: `No answer for ${SCOPE}.` },
          jitter: 0,
        }),
      ]),
      expected: { kind: "failed", reason: "HQ is not answering right now." },
    },
  ])("$name", ({ state, expected }) => {
    expect(discussion(state)).toEqual(expected);
  });
});

const gate = (state: AccountState) =>
  discussionGate.derive(readsOfState(state), { orgId: ORG, link: LINK });

describe("discussionGate", () => {
  it.each([
    {
      name: "no HQ named",
      state: emptyAccount,
      expected: { kind: "failed", reason: "HQ is not answering right now." },
    },
    { name: "first read", state: demanded, expected: { kind: "reading" } },
    { name: "read", state: read, expected: { kind: "read" } },
    {
      name: "HQ let go",
      state: apply(demanded, [stream(linkKeys.hq(ORG), { kind: "demand", demanded: false })]),
      expected: { kind: "failed", reason: "HQ is not answering right now." },
    },
    {
      name: "refused",
      state: refused,
      expected: { kind: "failed", reason: "You may not read this change." },
    },
  ])("$name", ({ state, expected }) => {
    expect(gate(state)).toEqual(expected);
  });
});
