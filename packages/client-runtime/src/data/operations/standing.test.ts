/**
 * An accepted operation is a standing demand at its owner: the detail that holds its handle is
 * observed until the operation is settled, through the same holds screens use.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/unstable/reactivity";

import { fixtureWire, settle, type WireRequest } from "../__fixtures__/zeropsWire.ts";
import { zeropsNavigationLink } from "../adapters/zerops.ts";
import { linkKeys, type OperationIntent, type OperationReceipt } from "../model.ts";
import { operationProgressOf } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type ProjectionReads } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { makeOperations, type OperationExecutor } from "./coordinator.ts";
import type { RegisteredOperationKind } from "./kind.ts";
import { OPERATION_KINDS } from "./kinds.ts";
import { holdStandingDemands } from "./standing.ts";

const ORG = "org";
const HISTORY_PATH = "/project/p1/process?limit=100";
const RESTART = { kind: "restart-service", projectId: "p1" } as unknown as OperationIntent;

/** A test-only restart: its process is in the project's history; that process says the end. */
const restartService: RegisteredOperationKind = {
  kind: "restart-service",
  executor: "zerops",
  reflected: (read: ProjectionReads, _intent, receipt: OperationReceipt) =>
    read.fact("process", receipt.handles[0] ?? "").kind === "known",
  settledBy: (read: ProjectionReads, _intent, receipt: OperationReceipt) => {
    const process = read.fact("process", receipt.handles[0] ?? "");
    return process.kind === "known" && process.value.status === "FINISHED"
      ? { kind: "succeeded" }
      : null;
  },
  observedIn: () => ({ family: "process", listing: "history", ownerId: "p1" }),
};
const kinds = [...OPERATION_KINDS, restartService];

const row = (status: string, version: number) => ({
  id: "proc-1",
  projectId: "p1",
  status,
  actionName: "stack.restart",
  created: "2026-10-06T00:00:00Z",
  _version: version,
});

describe("holdStandingDemands", () => {
  it.effect("observes an accepted operation's detail until it settles, across an outage", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let history = [row("RUNNING", 1)];
      const fixture = fixtureWire((request: WireRequest) =>
        Effect.succeed(
          request.method === "GET"
            ? { status: 200, body: { list: history } }
            : request.body?.wsOutputType === "updateStream"
              ? { success: true }
              : { items: [] },
        ),
      );
      const historyReads = () =>
        fixture.requests.filter((request) => request.path === HISTORY_PATH).length;
      const link = zeropsNavigationLink({
        orgId: ORG,
        wire: fixture.wire,
        store,
        makeId: () => "subscription",
      });
      const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
      const fiber = yield* Effect.forkChild(supervisor.run);
      yield* settle;

      const executor: OperationExecutor = {
        submit: (requestId) =>
          Effect.succeed({
            requestId,
            operationId: "proc-1",
            executor: "zerops",
            affected: [{ family: "process", id: "proc-1" }],
            handles: ["proc-1"],
            acceptance: { kind: "accepted" },
            outcome: { kind: "pending" },
          }),
      };
      const stop = holdStandingDemands({ store, kinds, demandDetail: link.demandDetail });
      const requestId = yield* makeOperations({
        store,
        kinds,
        executors: { zerops: executor },
        makeId: () => "request-1",
      }).submit(RESTART);
      yield* settle;
      const progress = () =>
        operationProgressOf(kinds).derive(readsOfState(store.state()), requestId);
      expect(historyReads()).toBe(1);
      expect(progress()).toEqual({ stage: "reflected", operationId: "proc-1" });

      // The restart ends while the socket is down; the next attempt reads the history again.
      history = [row("FINISHED", 2)];
      yield* fixture.drop({ outcome: "transient", message: "socket closed" });
      yield* settle;
      const stream = store.state().streams.get(linkKeys.zerops(ORG));
      yield* TestClock.adjust(stream?.next.kind === "retry" ? stream.next.at : 0);
      yield* settle;

      expect(historyReads()).toBe(2);
      expect(progress()).toEqual({ stage: "done", operationId: "proc-1", outcome: "succeeded" });
      expect(link.details?.()).toEqual([]);
      stop();
      yield* Fiber.interrupt(fiber);
    }),
  );
});
