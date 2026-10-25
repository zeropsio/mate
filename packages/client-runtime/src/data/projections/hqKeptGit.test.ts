import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { HqError } from "../../zerops/hq/client.ts";
import { makeOperations } from "../operations/coordinator.ts";
import { makeHqExecutor, type HqWrites } from "../operations/executors/hq.ts";
import { hqKeptGitFamily, hqKeptGitScope } from "../families/hqKeptGit.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { hqKeptGitQuestions } from "./hqKeptGit.ts";

const raw = {
  appId: "shop",
  appName: "Shop",
  projectId: "gone",
  projectName: "Production",
  askedAt: "2026-10-25T09:00:00Z",
};
const scope = hqKeptGitScope("org");
const baseline: AccountInput = {
  kind: "baseline-commit",
  via: "hq-stream",
  scope,
  generation: 0,
  members: ["shop"],
  rows: [
    {
      family: "hqKeptGit",
      id: "shop",
      value: hqKeptGitFamily.hq!.decode(raw, "keptGit:shop")!,
      revision: { kind: "hq", incarnation: "i", revision: 1 },
    },
  ],
};
const known = reduceAccount(emptyAccount, baseline).state;
it("shows the exact question that arrives after the first navigation paint", () => {
  expect(hqKeptGitQuestions.derive(readsOfState(emptyAccount), "org")).toEqual([]);
  expect(hqKeptGitQuestions.derive(readsOfState(known), "org")).toEqual([
    {
      question: raw,
      requestId: "kept-git/org/shop/2026-10-25T09%3A00%3A00Z/1",
      pending: false,
      message: null,
    },
  ]);
});
it.each(["deleted", "no-access"] as const)(
  "withdraws a kept-Git question when HQ says %s",
  (reason) => {
    const state = reduceAccount(known, {
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: 0 }],
      reset: false,
      rows: [],
      removals: [{ family: "hqKeptGit", id: "shop", reason }],
    }).state;
    expect(hqKeptGitQuestions.derive(readsOfState(state), "org")).toEqual([]);
  },
);
it("keeps an unanswered Git question through a lost connection without inventing deletion", () => {
  const state = reduceAccount(known, {
    kind: "stream",
    key: scope,
    now: 0,
    event: { kind: "parent-lost" },
  }).state;
  expect(hqKeptGitQuestions.derive(readsOfState(state), "org")[0]?.question).toEqual(raw);
});

const zerops = {
  mintIntegrationToken: async () => {
    throw new Error("A kept Git answer never mints a key.");
  },
  deleteIntegrationToken: async () => {
    throw new Error("A kept Git answer never deletes a key.");
  },
};

it.effect(
  "keeps the same pending request while HQ receives a kept-Git answer and until its question closes",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      store.dispatch(baseline);
      const question = () => hqKeptGitQuestions.derive(readsOfState(store.state()), "org")[0]!;
      const requestId = question().requestId;
      const api = {
        answerKeptGit: async () => {
          expect(question()).toMatchObject({
            requestId,
            pending: true,
            message: "Sending your answer…",
          });
        },
      } as unknown as HqWrites;
      const operations = makeOperations({
        store,
        makeId: () => "unexpected",
        executors: { hq: makeHqExecutor({ apiOf: () => api, zerops }) },
      });
      yield* operations.submit(
        { kind: "answer-kept-git", orgId: "org", appId: "shop", answer: "keep" },
        requestId,
      );
      expect(question()).toMatchObject({
        requestId,
        pending: true,
        message: "Answer sent. Waiting for HQ to close this question.",
      });
      store.dispatch({
        kind: "delivery",
        via: "hq-stream",
        scopes: [{ scope, generation: 0 }],
        reset: false,
        rows: [],
        removals: [{ family: "hqKeptGit", id: "shop", reason: "no-access" }],
      });
      expect(hqKeptGitQuestions.derive(readsOfState(store.state()), "org")).toEqual([]);
    }),
);

it.effect(
  "keeps a lost kept-Git answer pending under its original request so remounting cannot send another answer",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      store.dispatch(baseline);
      const question = () => hqKeptGitQuestions.derive(readsOfState(store.state()), "org")[0]!;
      const requestId = question().requestId;
      let sends = 0;
      const api = {
        answerKeptGit: async () => {
          sends += 1;
          throw new HqError({ kind: "uncertain", code: "network", message: "Answer lost." });
        },
      } as unknown as HqWrites;
      const operations = makeOperations({
        store,
        makeId: () => "unexpected",
        executors: { hq: makeHqExecutor({ apiOf: () => api, zerops }) },
      });
      const intent = {
        kind: "answer-kept-git",
        orgId: "org",
        appId: "shop",
        answer: "delete",
      } as const;
      yield* operations.submit(intent, requestId);
      expect(question()).toMatchObject({ requestId, pending: true });
      const remounted = hqKeptGitQuestions.derive(readsOfState(store.state()), "org")[0]!;
      yield* operations.submit(intent, remounted.requestId);
      expect(sends).toBe(1);
      expect(question()).toMatchObject({ requestId, pending: true });
    }),
);

it.effect.each([
  {
    kind: "refused",
    code: "conflict",
    reason: "not_asked",
    message: "This question is already closed.",
  },
  { kind: "unavailable", code: "network", message: "HQ could not be reached." },
] as const)("offers a fresh kept-Git request only after HQ reports $kind", (fault) =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    store.dispatch(baseline);
    const question = () => hqKeptGitQuestions.derive(readsOfState(store.state()), "org")[0]!;
    const requestId = question().requestId;
    let sends = 0;
    const api = {
      answerKeptGit: async () => {
        if (++sends === 1) throw new HqError(fault);
      },
    } as unknown as HqWrites;
    const operations = makeOperations({
      store,
      makeId: () => "unexpected",
      executors: { hq: makeHqExecutor({ apiOf: () => api, zerops }) },
    });
    yield* operations.submit(
      { kind: "answer-kept-git", orgId: "org", appId: "shop", answer: "delete" },
      requestId,
    );
    expect(question()).toMatchObject({ pending: false, message: fault.message });
    expect(question().requestId).toBe("kept-git/org/shop/2026-10-25T09%3A00%3A00Z/2");
    const nextId = question().requestId;
    yield* operations.submit(
      { kind: "answer-kept-git", orgId: "org", appId: "shop", answer: "keep" },
      nextId,
    );
    expect(sends).toBe(2);
    expect(question()).toMatchObject({ requestId: nextId, pending: true });
  }),
);
