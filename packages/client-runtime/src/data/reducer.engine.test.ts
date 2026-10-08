import { describe, expect, it } from "vite-plus/test";

import {
  engineConversationLink,
  engineConversationScopes,
  engineFactId,
  type EngineConversationKey,
} from "./families/mateEngine.ts";
import { emptyAccount, type AccountState, type Revision } from "./model.ts";
import { factOf, indexOf, reduceAccount, type AccountInput, type Row } from "./reducer.ts";
import { readsOfState } from "./store.ts";
import {
  engineHeader,
  engineRequest,
  engineRun,
  noteItem,
  personItem,
} from "./__fixtures__/mateEngine.ts";

const ENV = "env-ada";
const ada: EngineConversationKey = { environmentId: ENV, conversationId: "thread-ada" };
const scout: EngineConversationKey = { environmentId: ENV, conversationId: "thread-scout" };

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);

const revision = (seq: number, epoch = 4): Revision => ({
  kind: "mate-conversation",
  environmentId: ENV,
  epoch,
  seq,
});

/** The conversation's link and four scopes demanded and in their first attempt. */
function attached(state: AccountState, key: EngineConversationKey): AccountState {
  const scopes = Object.values(engineConversationScopes(key));
  return apply(state, [
    {
      kind: "stream",
      key: engineConversationLink(key),
      now: 0,
      event: { kind: "demand", demanded: true },
    },
    ...scopes.flatMap((key): AccountInput[] => [
      { kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } },
      { kind: "stream", key, now: 0, event: { kind: "attempt" } },
    ]),
  ]);
}

const scopesOf = (key: EngineConversationKey) =>
  Object.values(engineConversationScopes(key)).map((scope) => ({ scope, generation: 1 }));

/** A conversation's first run: the person's message and the agent's answer. */
function window(key: EngineConversationKey, seq = 3, answer = "Deployed."): ReadonlyArray<Row> {
  const run = engineRun(key.conversationId, 1, { rev: seq });
  const at = (id: string) => engineFactId(key.environmentId, id);
  return [
    {
      family: "mateEngineConversation",
      id: at(key.conversationId),
      value: {
        environmentId: key.environmentId,
        header: engineHeader(key.conversationId),
        window: { oldestOrdinal: 1, earlier: false },
      },
      revision: revision(seq),
    },
    {
      family: "mateEngineRun",
      id: at(run.id),
      value: { ...run, environmentId: key.environmentId },
      revision: revision(seq),
    },
    {
      family: "mateEngineItem",
      id: at(`${run.id}/i/1`),
      value: { ...personItem(run.id, 1, "Deploy the api"), environmentId: key.environmentId },
      revision: revision(1),
    },
    {
      family: "mateEngineItem",
      id: at(`${run.id}/i/2`),
      value: { ...noteItem(run.id, 2, answer, { rev: seq }), environmentId: key.environmentId },
      revision: revision(seq),
    },
    {
      family: "mateEngineRequest",
      id: at(`${run.id}/q/1`),
      value: {
        ...engineRequest(run.id, 1, { kind: "approval", requestKind: "command", detail: "ls" }),
        environmentId: key.environmentId,
      },
      revision: revision(2),
    },
  ];
}

const delivery = (
  key: EngineConversationKey,
  rows: ReadonlyArray<Row>,
  extra: { readonly reset?: boolean; readonly partial?: boolean } = {},
): AccountInput => ({
  kind: "delivery",
  via: "mate-direct",
  scopes: scopesOf(key),
  reset: extra.reset ?? true,
  ...(extra.partial === undefined ? {} : { partial: extra.partial }),
  rows,
  removals: [],
});

describe("an engine conversation in the account", () => {
  it("commits a frame's header, runs, items and requests together, as the Mate's own delivery", () => {
    const state = apply(attached(emptyAccount, ada), [delivery(ada, window(ada))]);
    const run = factOf(state, "mateEngineRun", engineFactId(ENV, "thread-ada/r/1"));
    expect(run?.via).toBe("mate-direct");
    expect(run?.authority).toBe("mate");
    const conversation = engineFactId(ENV, "thread-ada");
    expect(indexOf(state, "engineRunsIn", conversation).size).toBe(1);
    expect(indexOf(state, "engineItemsIn", conversation).size).toBe(2);
    expect(indexOf(state, "engineItemsOfRun", engineFactId(ENV, "thread-ada/r/1")).size).toBe(2);
    expect(indexOf(state, "engineRequestsIn", conversation).size).toBe(1);
    expect(readsOfState(state).members(engineConversationScopes(ada).item).ids).toHaveLength(2);
  });

  it("holds a window snapshot as partial: what it leaves out says nothing", () => {
    const state = apply(attached(emptyAccount, ada), [
      delivery(ada, window(ada), { partial: true }),
    ]);
    for (const scope of Object.values(engineConversationScopes(ada)))
      expect(readsOfState(state).coverage(scope)).toBe("partial");
  });

  it("keeps the newer record whichever order two deliveries arrive in", () => {
    const newer = window(ada, 5, "Deployed, and the worker too.");
    const older = window(ada, 3, "Deployed.");
    const note = engineFactId(ENV, "thread-ada/r/1/i/2");
    for (const order of [
      [newer, older],
      [older, newer],
    ]) {
      const state = apply(
        attached(emptyAccount, ada),
        order.map((rows) => delivery(ada, rows, { reset: false })),
      );
      const fact = factOf(state, "mateEngineItem", note);
      expect(fact?.content.kind === "value" && fact.content.value).toMatchObject({
        text: "Deployed, and the worker too.",
      });
    }
  });

  it("commits nothing a superseded attempt delivers late", () => {
    const state = apply(attached(emptyAccount, ada), [
      {
        ...(delivery(ada, window(ada)) as Extract<AccountInput, { kind: "delivery" }>),
        scopes: scopesOf(ada).map(({ scope }) => ({ scope, generation: 0 })),
      },
    ]);
    expect(factOf(state, "mateEngineRun", engineFactId(ENV, "thread-ada/r/1"))).toBeUndefined();
  });
});
