/**
 * The person's Chief registered at HQ, and one decision on a proposal, as the account's
 * operations send them: HQ answers each at once, and a proposal HQ holds another decision of
 * already is refused as decided.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { readsOfState, makeAccountStore, type AccountStore } from "../store.ts";
import { operationProgress } from "../projections/operation.ts";
import { HqError } from "../../zerops/hq/client.ts";
import type { HqProposalDecision } from "../../zerops/hq/chief.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

const REGISTERED = { chief: { projectId: "p-chief", since: "2026-10-12T10:00:00.000Z" } };

const DECIDED: HqProposalDecision = {
  id: "prop-1",
  projectId: "p-chief",
  decision: "approved",
  outcome: null,
  words: null,
  by: "u1",
  at: "2026-10-12T10:00:00.000Z",
};

function account(api: Partial<HqWrites>) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  const executor = makeHqExecutor({
    apiOf: () => api as HqWrites,
    zerops: {
      mintIntegrationToken: () => Promise.reject(new Error("not expected")),
      deleteIntegrationToken: () => Promise.reject(new Error("not expected")),
    },
  });
  const operations = makeOperations({ store, executors: { hq: executor }, makeId: () => "r1" });
  return { store, operations };
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");
const receipt = (store: AccountStore) => store.state().operations.get("r1")?.receipt;

describe("a Chief recorded at HQ", () => {
  it.effect("ends with the registration HQ answered", () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const { store, operations } = account({
        setChief: async (projectId) => {
          asked.push(projectId);
          return REGISTERED;
        },
      });
      yield* operations.submit({ kind: "set-chief", orgId: ORG, projectId: "p-chief" });
      expect(asked).toEqual(["p-chief"]);
      expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
      expect(receipt(store)?.acceptance).toEqual({
        kind: "accepted",
        result: REGISTERED,
      });
    }),
  );

  it.effect("keeps HQ's words where it refused the Chief, and hands nothing", () =>
    Effect.gen(function* () {
      const { store, operations } = account({
        setChief: async () => {
          throw new HqError({
            kind: "refused",
            code: "forbidden",
            message: "Only the project's admin can make it a Chief.",
          });
        },
      });
      yield* operations.submit({ kind: "set-chief", orgId: ORG, projectId: "p-chief" });
      expect(progress(store)).toMatchObject({
        stage: "refused",
        reason: "Only the project's admin can make it a Chief.",
      });
    }),
  );
});

describe("a decision on a proposal written to HQ", () => {
  it.effect("is answered with the decision HQ holds now", () =>
    Effect.gen(function* () {
      const writes: unknown[] = [];
      const { store, operations } = account({
        decideProposal: async (id, write) => {
          writes.push([id, write]);
          return DECIDED;
        },
      });
      yield* operations.submit({
        kind: "decide-proposal",
        orgId: ORG,
        proposalId: "prop-1",
        write: { projectId: "p-chief", decision: "approved" },
      });
      expect(writes).toEqual([["prop-1", { projectId: "p-chief", decision: "approved" }]]);
      expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
      expect(receipt(store)?.acceptance).toEqual({
        kind: "accepted",
        result: { decision: DECIDED },
      });
    }),
  );

  it.effect.each([
    ["HQ holds another decision of it", 409, "conflict", "refused"],
    ["HQ is not serving", 503, "unavailable", "unsent"],
  ] as const)("where %s, says so", ([, status, code, stage]) =>
    Effect.gen(function* () {
      const { store, operations } = account({
        decideProposal: async () => {
          throw new HqError({
            kind: status === 409 ? "refused" : "unavailable",
            code,
            status,
            message: "HQ said no.",
          });
        },
      });
      yield* operations.submit({
        kind: "decide-proposal",
        orgId: ORG,
        proposalId: "prop-1",
        write: { projectId: "p-chief", decision: "declined" },
      });
      expect(progress(store)).toMatchObject(
        stage === "refused" ? { stage, code: "conflict" } : { stage },
      );
    }),
  );
});
