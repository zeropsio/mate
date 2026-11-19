import { expect, it } from "@effect/vitest";
import type { HqChangeComment } from "@t3tools/shared/hqChanges";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { ORG } from "../__fixtures__/account.ts";
import { discussionId, hqDiscussionScope } from "../families/hqDiscussion.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { HqError } from "../../zerops/hq/client.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

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

// witness: packages/client-runtime/src/data/operations/changeComment.ts | said.authorUserId === intent.authorUserId && said.body === intent.body → said.body === intent.body
it.effect(
  "OP41: After a lost answer a change comment adopts only the person's own words and is never sent again",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const discussed = (revision: number, comments: ReadonlyArray<HqChangeComment>) => {
        store.dispatch({
          kind: "delivery",
          via: "hq-stream",
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

      discussed(1, [comment("c0", { body: "Earlier" })]);
      const lost = new HqError({ kind: "uncertain", code: "network", message: "No answer." });
      const calls: string[] = [];
      const writes: Partial<HqWrites> = {
        commentOnChange: async (link, body) => {
          calls.push(`${link.repo}#${link.number} ${body}`);
          throw lost;
        },
      };
      const operations = makeOperations({
        store,
        makeId: () => "r1",
        executors: {
          hq: makeHqExecutor({
            apiOf: () => writes as HqWrites,
            zerops: {
              mintIntegrationToken: () => Promise.reject(new Error("Unexpected token mint")),
              deleteIntegrationToken: () => Promise.reject(new Error("Unexpected token deletion")),
            },
          }),
        },
      });
      const progress = () => operationProgress.derive(readsOfState(store.state()), "r1");
      yield* operations.submit(SAY);
      expect(progress()).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      // A colleague said the same words: not this comment.
      discussed(2, [comment("c0", { body: "Earlier" }), comment("c9", { authorUserId: "u2" })]);
      yield* operations.retry("r1");
      expect(progress()).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      discussed(3, [
        comment("c0", { body: "Earlier" }),
        comment("c9", { authorUserId: "u2" }),
        comment("c1"),
      ]);
      yield* operations.retry("r1");
      expect(progress()).toEqual({ stage: "done", operationId: "c1", outcome: "succeeded" });
      expect(calls).toEqual(["web#7 Ship it"]);
    }),
);
