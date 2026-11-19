import { expect, it } from "vite-plus/test";

import { EnvironmentId, ThreadId, type MateAttention } from "@t3tools/contracts";

import { hqMateAttentionScope, mateAttentionScope } from "../families/mateAttention.ts";
import {
  emptyAccount,
  linkKeys,
  type AccountState,
  type ScopeKey,
  type StreamKey,
} from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { mateAttention } from "./mateAttention.ts";

const ORG = "org";
const PROJECT = "ada";
const RELAYED = hqMateAttentionScope(ORG, PROJECT);
const DIRECT = mateAttentionScope(PROJECT);
const environmentId = EnvironmentId.make("env");
const main = ThreadId.make("main");
const attention: MateAttention = {
  source: { environmentId, epoch: 1, incarnation: "run", revision: 4 },
  mainThreadId: main,
  lastThreadId: main,
  working: 0,
  waiting: 0,
  results: [],
  questions: [],
  truncated: false,
};
const row = {
  family: "mateAttention",
  id: PROJECT,
  revision: {
    kind: "mate-attention",
    environmentId,
    epoch: 1,
    incarnation: "run",
    revision: 4,
    live: true,
  },
  value: attention,
} as Row;
const stream = (key: StreamKey, event: StreamEvent): AccountInput => ({
  kind: "stream",
  key,
  now: 0,
  event,
});
const opened = (key: ScopeKey): ReadonlyArray<AccountInput> => [
  stream(key, { kind: "demand", demanded: true }),
  stream(key, { kind: "attempt" }),
  stream(key, { kind: "handshake" }),
];
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);

// witness: packages/client-runtime/src/data/families/mateAttention.ts | released: "kept", →
it("PJ85: A Mate the person leaves keeps the attention HQ relayed of it, though its own link confirmed it last; breaks: its menu row loses its last message until a reload", () => {
  const left = apply(emptyAccount, [
    stream(linkKeys.hq(ORG), { kind: "demand", demanded: true }),
    stream(linkKeys.hq(ORG), { kind: "handshake" }),
    stream(linkKeys.hq(ORG), { kind: "baseline-committed" }),
    ...opened(RELAYED),
    {
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope: RELAYED, generation: 1 }],
      reset: true,
      rows: [row],
      removals: [],
    },
    stream(linkKeys.mate(PROJECT), { kind: "demand", demanded: true }),
    stream(linkKeys.mate(PROJECT), { kind: "handshake" }),
    stream(linkKeys.mate(PROJECT), { kind: "baseline-committed" }),
    ...opened(DIRECT),
    {
      kind: "rows",
      scope: DIRECT,
      generation: 1,
      method: "baseline",
      via: "mate-direct",
      rows: [row],
    },
    { kind: "release", scopes: [DIRECT], now: 0 },
  ]);
  expect(
    mateAttention.derive(readsOfState(left), { orgId: ORG, projectId: PROJECT }).attention,
  ).toEqual(attention);
});
