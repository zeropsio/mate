import { describe, expect, it } from "@effect/vitest";
import type { HqChangeComment } from "@t3tools/shared/hqChanges";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { ORG } from "../__fixtures__/account.ts";
import { discussionId, hqDiscussionScope } from "../families/hqDiscussion.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { HqError } from "../../zerops/hq/client.ts";
import { changeComment } from "./changeComment.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor } from "./executors/hq.ts";

const LINK = { appId: "shop", repo: "web", number: 7 };
const SAY = {
  kind: "change-comment",
  orgId: ORG,
  link: LINK,
  body: "Ship it",
  authorUserId: "u1",
} as const;
const comment = (id: string, over: Partial<HqChangeComment> = {}): HqChangeComment => ({
  id,
  authorUserId: "u1",
  authorMateProjectId: null,
  body: "Ship it",
  createdAt: "2026-10-06T10:00:00.000Z",
  ...over,
});

let revision = 0;
/** HQ's discussion scope delivering the change's whole conversation. */
const discussed = (store: AccountStore, comments: ReadonlyArray<HqChangeComment>) => {
  revision += 1;
  store.dispatch({
    kind: "hq-delivery",
    scopes: [{ scope: hqDiscussionScope(ORG, LINK), generation: 0 }],
    reset: true,
    rows: [
      {
        family: "hqDiscussion",
        id: discussionId(LINK),
        revision: { kind: "hq", incarnation: "i", revision },
        value: { comments },
      },
    ],
    removals: [],
  });
};

function operationsOf(store: AccountStore, post: () => Promise<HqChangeComment>) {
  const calls: string[] = [];
  const operations = makeOperations({
    store,
    executors: {
      hq: makeHqExecutor({
        zerops: {
          mintIntegrationToken: () => Promise.reject(new Error("Unexpected token mint")),
          deleteIntegrationToken: () => Promise.reject(new Error("Unexpected token deletion")),
        },
        apiOf: (orgId) =>
          orgId === ORG
            ? {
                createApp: () => Promise.reject(new Error("Unexpected creation")),
                recordBirth: () => Promise.reject(new Error("Unexpected birth")),
                bindBirth: () => Promise.reject(new Error("Unexpected bind")),
                attachProject: () => Promise.reject(new Error("Unexpected attach")),
                createMate: () => Promise.reject(new Error("Unexpected Mate")),
                recordClosedOff: () => Promise.reject(new Error("Unexpected close-off")),
                keepDeployToken: () => Promise.reject(new Error("Unexpected key")),
                commentOnChange: (link, body) => {
                  calls.push(`${link.repo}#${String(link.number)} ${body}`);
                  return post();
                },
              }
            : null,
      }),
    },
    makeId: () => "r1",
  });
  return { operations, calls };
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");

describe("change-comment", () => {
  it.effect("is accepted with HQ's comment, and ends once HQ's conversation holds it", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const { operations, calls } = operationsOf(store, async () => comment("c1"));
      yield* operations.submit(SAY);
      expect(calls).toEqual(["web#7 Ship it"]);
      expect(progress(store)).toEqual({ stage: "accepted", operationId: "c1" });
      discussed(store, [comment("c0", { body: "Earlier" })]);
      expect(progress(store)).toEqual({ stage: "accepted", operationId: "c1" });
      discussed(store, [comment("c0", { body: "Earlier" }), comment("c1")]);
      expect(progress(store)).toEqual({ stage: "done", operationId: "c1", outcome: "succeeded" });
    }),
  );

  it.effect.each([
    {
      name: "HQ refuses it",
      cause: new HqError({
        kind: "refused",
        code: "forbidden",
        status: 403,
        message: "You may not comment.",
      }),
      expected: { stage: "refused", reason: "You may not comment." },
    },
    {
      name: "HQ cannot be reached",
      cause: new HqError({ kind: "unavailable", code: "network", message: "HQ is down." }),
      expected: { stage: "unsent", next: "send-again", reason: "HQ is down." },
    },
  ])("is not taken when $name", ({ cause, expected }) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const { operations } = operationsOf(store, () => Promise.reject(cause));
      yield* operations.submit(SAY);
      expect(progress(store)).toEqual(expected);
    }),
  );

  it.effect("is refused without an HQ to send it to, and nothing is sent", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const { operations, calls } = operationsOf(store, async () => comment("c1"));
      yield* operations.submit({ ...SAY, orgId: "elsewhere" });
      expect(calls).toEqual([]);
      expect(progress(store)).toEqual({
        stage: "refused",
        reason: "This organization's HQ is not open here.",
      });
    }),
  );

  it.effect("after a lost answer adopts only the person's own words, never sending again", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      discussed(store, [comment("c0", { body: "Earlier" })]);
      const lost = new HqError({ kind: "uncertain", code: "network", message: "No answer." });
      const { operations, calls } = operationsOf(store, () => Promise.reject(lost));
      yield* operations.submit(SAY);
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      // A colleague said the same words: not this comment.
      discussed(store, [comment("c0", { body: "Earlier" }), comment("c9", { authorUserId: "u2" })]);
      yield* operations.retry("r1");
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      discussed(store, [
        comment("c0", { body: "Earlier" }),
        comment("c9", { authorUserId: "u2" }),
        comment("c1"),
      ]);
      yield* operations.retry("r1");
      expect(progress(store)).toEqual({ stage: "done", operationId: "c1", outcome: "succeeded" });
      expect(calls).toEqual(["web#7 Ship it"]);
    }),
  );

  it("never takes a Mate's words for a person whose id is not known", () => {
    const store = makeAccountStore(AtomRegistry.make());
    discussed(store, [comment("c1", { authorUserId: null, authorMateProjectId: "mate-1" })]);
    expect(
      changeComment.effectHandles!(readsOfState(store.state()), { ...SAY, authorUserId: null }),
    ).toEqual([]);
  });
});
