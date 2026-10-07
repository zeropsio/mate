import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { operationProgress } from "../projections/operation.ts";
import type { OperationReceipt } from "../model.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { HqError, type HqStructure } from "../../zerops/hq/client.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import type { MoveProjectIntent } from "./moveProject.ts";

const MOVE: MoveProjectIntent = {
  kind: "move-project",
  orgId: ORG,
  hqProjectId: "hq-1",
  projectId: "p1",
  from: { appId: "source", kind: "mate" },
  to: { appId: "target", kind: "mate" },
  rename: { from: "Source · Ada", name: "Target · Ada" },
};

function placement(store: AccountStore, appId: string | null, projectId = "p1", kind = "mate") {
  const project = { projectId, name: "Ada", kind, mate: { face: "" } };
  const structure = {
    apps: appId === null ? [] : [{ id: appId, name: appId, projects: [project] }],
    ungrouped: appId === null ? [project] : [],
  } as HqStructure;
  seedHqNavigation(store, ORG, { structure });
}

function account() {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [], projects: [{ id: "p1", name: MOVE.rename.from }] }).forEach(
    store.dispatch,
  );
  placement(store, "source");
  return store;
}

function operationsOf(
  store: AccountStore,
  send: (projectId: string, to: MoveProjectIntent["to"]) => Promise<void>,
  active = () => true,
  hqId = () => "hq-1",
  retained = () => false,
) {
  return makeOperations({
    store,
    makeId: () => "original",
    executors: {
      hq: makeHqExecutor({
        apiOf: () =>
          ({
            lifecycleWrite: async (requestId: string, intent: MoveProjectIntent) => {
              if (
                (intent.from.kind === "mate" || intent.from.kind === "devstage") !==
                (intent.to.kind === "mate" || intent.to.kind === "devstage")
              )
                throw new HqError({
                  kind: "refused",
                  code: "class_move_receipt_required",
                  message: "Class migration needs its lifecycle receipt.",
                });
              await send(intent.projectId, intent.to);
              return { requestId, intent };
            },
            lifecycleReceipt: async (requestId: string) => {
              if (retained()) return { requestId, intent: MOVE };
              throw new HqError({
                kind: "unavailable",
                code: "network",
                message: "HQ cannot read the original receipt.",
              });
            },
          }) as unknown as HqWrites,
        hqProjectIdOf: hqId,
        active,
        zerops: {
          mintIntegrationToken: () => Promise.reject(new Error("no key mint on placement move")),
          deleteIntegrationToken: () =>
            Promise.reject(new Error("no key retirement on placement move")),
        },
      }),
    },
  });
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "original");
const lost = () =>
  Promise.reject(new HqError({ kind: "uncertain", code: "network", message: "Answer lost." }));

describe("placement Move receipts", () => {
  it.effect("a class-changing Move waits for the owner's credential/job completion receipt", () =>
    Effect.gen(function* () {
      const store = account();
      const intent: MoveProjectIntent = { ...MOVE, to: { appId: "target", kind: "production" } };
      const accepted: OperationReceipt = {
        requestId: "original",
        operationId: "move-1",
        executor: "hq",
        affected: [{ family: "placement", id: "p1" }],
        handles: ["move-1"],
        acceptance: { kind: "accepted" },
        outcome: { kind: "pending" },
      };
      const operations = makeOperations({
        store,
        makeId: () => "original",
        executors: {
          hq: {
            submit: (requestId, sent) =>
              Effect.sync(() => {
                expect(requestId).toBe("original");
                expect(sent).toEqual(intent);
                return accepted;
              }),
          },
        },
      });
      yield* operations.submit(intent);
      placement(store, "target", "p1", "production");
      expect(progress(store).stage).toBe("reflected");
      store.dispatch({
        kind: "operation-receipt",
        receipt: {
          ...accepted,
          outcome: {
            kind: "succeeded",
            evidence: "HQ retained Mate history and replaced project-bound credentials and jobs",
          },
        },
      });
      expect(progress(store).stage).toBe("done");
    }),
  );

  it.effect("a legacy placement-only HQ cannot claim class-change completion", () =>
    Effect.gen(function* () {
      const store = account();
      let sends = 0;
      yield* operationsOf(store, async () => {
        sends++;
      }).submit({ ...MOVE, to: { appId: "target", kind: "stage" } });
      expect(progress(store)).toMatchObject({
        stage: "refused",
        code: "class_move_receipt_required",
      });
      expect(sends).toBe(0);
    }),
  );

  it.effect.each([
    { label: "not observed yet", target: "source", expected: "uncertain" },
    { label: "exact destination", target: "target", expected: "done" },
    { label: "another destination", target: "other", expected: "uncertain" },
  ])("a lost Move stays truthful: $label", ({ target, expected }) =>
    Effect.gen(function* () {
      const store = account();
      const calls: string[] = [];
      let retained = false;
      const operations = operationsOf(
        store,
        async (id, to) => {
          expect(store.state().operations.get("original")?.intent).toEqual(MOVE);
          calls.push(id);
          expect(to).toEqual(MOVE.to);
          return lost();
        },
        () => true,
        () => "hq-1",
        () => retained,
      );
      yield* operations.submit(MOVE);
      expect(progress(store).stage).toBe("uncertain");
      placement(store, target);
      retained = target === "target";
      yield* operations.retry("original");
      yield* operations.submit(MOVE, "original");
      expect(progress(store).stage).toBe(expected);
      expect(calls).toEqual(["p1"]);
    }),
  );

  it.effect.each(["unknown", "already-there", "sibling", "denied"] as const)(
    "a lost answer cannot adopt $0 evidence",
    (evidence) =>
      Effect.gen(function* () {
        const store = evidence === "unknown" ? makeAccountStore(AtomRegistry.make()) : account();
        if (evidence === "already-there") placement(store, "target");
        const operations = operationsOf(store, lost);
        yield* operations.submit(MOVE);
        placement(store, "target", evidence === "sibling" ? "p2" : "p1");
        if (evidence === "denied")
          store.dispatch({ kind: "access", family: "placement", id: "p1", access: "denied" });
        yield* operations.retry("original");
        expect(progress(store).stage).toBe("uncertain");
      }),
  );

  it.effect("resumes a retained Move by its original baseline without another write", () =>
    Effect.gen(function* () {
      const store = account();
      placement(store, "target");
      const operations = operationsOf(
        store,
        () => Promise.reject(new Error("must not send")),
        () => true,
        () => "hq-1",
        () => true,
      );
      yield* operations.resume("original", MOVE, [], []);
      expect(progress(store)).toEqual({
        stage: "done",
        operationId: "original",
        outcome: "succeeded",
      });
      expect(store.state().operations.get("original")?.receipt?.requestId).toBe("original");
    }),
  );

  it.effect.each(["ended", "replaced"] as const)(
    "an $0 authority cannot receive a Move",
    (change) =>
      Effect.gen(function* () {
        const store = account();
        const calls: string[] = [];
        const operations = operationsOf(
          store,
          async (id) => {
            calls.push(id);
          },
          () => change !== "ended",
          () => (change === "replaced" ? "hq-2" : "hq-1"),
        );
        yield* operations.submit(MOVE);
        expect(progress(store).stage).toBe("refused");
        expect(calls).toEqual([]);
      }),
  );

  it.effect.each(["ended", "replaced"] as const)(
    "an $0 authority cannot prove the original lost Move from another owner's facts",
    (change) =>
      Effect.gen(function* () {
        const store = account();
        let active = true;
        let hqId = "hq-1";
        let sends = 0;
        const operations = operationsOf(
          store,
          () => {
            sends++;
            return lost();
          },
          () => active,
          () => hqId,
        );
        yield* operations.submit(MOVE);
        placement(store, "target");
        if (change === "ended") active = false;
        else hqId = "hq-2";
        yield* operations.retry("original");
        expect(progress(store)).toMatchObject({ stage: "unresolved", nextActor: "person" });
        expect(sends).toBe(1);
      }),
  );
});
