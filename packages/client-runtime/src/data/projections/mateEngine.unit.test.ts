import { expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import type { Item, Request, RunRecord } from "@t3tools/contracts";
import {
  engineConversationId,
  engineConversationScopes,
  engineFactId,
  type EngineConversationKey,
} from "../families/mateEngine.ts";
import { emptyAccount, type AccountState, type Revision } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { engineHeader, engineRun, personItem } from "../__fixtures__/mateEngine.ts";
import { engineRunCards, engineStopTarget, engineThread } from "./mateEngine.ts";
const ENV = "env-ada";
const key: EngineConversationKey = { environmentId: ENV, conversationId: "thread-ada" };
const run1 = "thread-ada/r/1";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);
const revision = (seq: number): Revision => ({
  kind: "mate-conversation",
  environmentId: ENV,
  epoch: 1,
  seq,
});

function held(
  records: {
    readonly runs?: ReadonlyArray<RunRecord>;
    readonly items?: ReadonlyArray<Item>;
    readonly requests?: ReadonlyArray<Request>;
    readonly header?: Parameters<typeof engineHeader>[1];
  },
  extra: ReadonlyArray<AccountInput> = [],
  at: EngineConversationKey = key,
): AccountState {
  const scopes = Object.values(engineConversationScopes(at));
  const active = records.runs?.findLast((run) => run.turnState === "running");
  const latest = active ?? records.runs?.findLast((run) => run.state === "ended");
  const rows: Row[] = [
    {
      family: "mateEngineConversation",
      id: engineConversationId(at),
      value: {
        environmentId: ENV,
        header: engineHeader(at.conversationId, {
          activeRunId: active?.id ?? null,
          latestRunId: latest?.id ?? null,
          runStatus:
            active !== undefined ? "running" : latest?.turnState === "error" ? "error" : "ready",
          ...records.header,
        }),
        window: { oldestOrdinal: 1, earlier: false },
      },
      revision: revision(99),
    },
    ...(records.runs ?? []).map((run): Row => ({
      family: "mateEngineRun",
      id: engineFactId(ENV, run.id),
      value: { ...run, environmentId: ENV },
      revision: revision(run.rev),
    })),
    ...(records.items ?? []).map((item): Row => ({
      family: "mateEngineItem",
      id: engineFactId(ENV, item.id),
      value: { ...item, environmentId: ENV },
      revision: revision(item.rev),
    })),
    ...(records.requests ?? []).map((request): Row => ({
      family: "mateEngineRequest",
      id: engineFactId(ENV, request.id),
      value: { ...request, environmentId: ENV },
      revision: revision(request.rev),
    })),
  ];
  return apply(emptyAccount, [
    // Held: a view demands it, so its records are observed.
    ...scopes.map((scope): AccountInput => ({
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    })),
    {
      kind: "delivery",
      via: "mate-direct",
      scopes: scopes.map((scope) => ({ scope, generation: 0 })),
      reset: true,
      partial: true,
      rows,
      removals: [],
    },
    ...extra,
  ]);
}

const thread = (state: AccountState, at: EngineConversationKey = key) =>
  Option.getOrNull(engineThread.derive(readsOfState(state), at).data);

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | ...(item.runId !== null && queued(item.runId) ? { heldRunId: item.runId } : {}), → ...(item.runId !== null && !queued(item.runId) ? { heldRunId: item.runId } : {}),
it("PJ71: A message no agent has taken yet can be withdrawn; one the agent took cannot", () => {
  const run2 = "thread-ada/r/2";
  const state = held({
    runs: [
      engineRun("thread-ada", 1, { end: { kind: "usage-limit", resetsAt: 9 } }),
      engineRun("thread-ada", 2, { state: "queued", end: null, endedAt: null, startedAt: null }),
    ],
    items: [personItem(run1, 1, "Deploy the api"), personItem(run2, 1, "Still there?")],
    header: { pausedUntil: 9 },
  });
  expect(
    thread(state)?.messages.map((message) => [
      message.text,
      (message as { readonly heldRunId?: string }).heldRunId ?? null,
    ]),
  ).toEqual([
    ["Deploy the api", null],
    ["Still there?", run2],
  ]);
});

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | if (item.delivery.state === "refused" && refusedAtAdmission(item.runId)) return null; → if (item.delivery.state === "queued" && refusedAtAdmission(item.runId)) return null;
it("PJ72: A message whose admission was refused before anything ran goes back to its sender, never into the conversation", () => {
  const state = held({
    runs: [
      engineRun("thread-ada", 1, {
        startedAt: null,
        end: {
          kind: "failed",
          reason: "Claude's sign-in has expired.",
          next: null,
          admission: { loginId: "claude-code", reason: "expired-login" },
        },
      }),
    ],
    items: [personItem(run1, 1, "Start work", { delivery: { state: "refused", at: null } })],
  });
  expect(thread(state)?.messages.map((message) => message.text)).toEqual([]);
  expect(engineRunCards.derive(readsOfState(state), key)?.[run1]?.refused).toEqual({
    messageId: `send-${run1}-1`,
    text: "Start work",
  });
});

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | stream.fault?.outcome === "authoritative-denial"; → stream.fault?.outcome === "definitive-refusal";
it("PJ73: An engine conversation shows nothing it held while its Mate withholds access", () => {
  const scope = engineConversationScopes(key).item;
  const state = held({ runs: [engineRun("thread-ada", 1)] }, [
    { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
    {
      kind: "stream",
      key: scope,
      now: 0,
      event: {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "authoritative-denial", message: "No longer yours." },
      },
    },
  ]);
  expect(engineThread.derive(readsOfState(state), key).data).toEqual(Option.none());
});

// witness: packages/client-runtime/src/data/projections/mateEngine.ts | return active !== undefined && rootOf(active).id === turnId ? active.id : turnId; → return active !== undefined && active.id === turnId ? active.id : turnId;
it("PJ74: Stop on a card that a continuing run shares ends the run that works", () => {
  const state = held({
    runs: [
      engineRun("thread-ada", 1),
      engineRun("thread-ada", 2, {
        joins: run1 as never,
        trigger: { kind: "wake", cause: "self", wakeId: null } as never,
        state: "running",
        end: null,
        endedAt: null,
      }),
    ],
  });
  expect(thread(state)?.session?.activeTurnId).toBe(run1);
  expect(engineStopTarget(readsOfState(state), key, run1)).toBe("thread-ada/r/2");
  expect(engineStopTarget(readsOfState(state), key, "thread-ada/r/9")).toBe("thread-ada/r/9");
});
