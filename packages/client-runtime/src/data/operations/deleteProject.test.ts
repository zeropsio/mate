import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/unstable/reactivity";

import { liveZerops, ORG, processValue } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import type { OperationReceipt } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { ZeropsApiError, ZeropsWriteNotSent } from "../../zerops/api.ts";
import { makeOperations } from "./coordinator.ts";
import { deleteProject } from "./deleteProject.ts";
import { deleteProjectExecutor } from "./executors/deleteProject.ts";

const DELETE = { kind: "delete-project", orgId: ORG, projectId: "p1" } as const;

function account() {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [], projects: [{ id: "p1" }] }).forEach(store.dispatch);
  return store;
}

const processRow = (
  store: AccountStore,
  id: string,
  status: string,
  version: number,
  patch: Partial<Parameters<typeof processValue>[0]> = {},
) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id,
        value: processValue({
          id,
          projectId: "p1",
          status,
          actionName: "project.delete",
          ...patch,
        }),
        revision: { kind: "zerops", version },
      },
    ],
  });

function operationsOf(store: AccountStore, deleteCall: () => Promise<{ processId: string }>) {
  const calls: string[] = [];
  const submit = deleteProjectExecutor({
    deleteProject: (projectId) => {
      calls.push(`delete ${projectId}`);
      return deleteCall();
    },
  });
  const operations = makeOperations({
    store,
    executors: {
      zerops: {
        submit: (requestId, intent) =>
          intent.kind === "delete-project" ? submit(requestId, intent) : Effect.die("no"),
      },
    },
    makeId: () => "r1",
  });
  return { operations, calls };
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");

describe("delete-project", () => {
  it.effect("is accepted with its delete process and ended by that process's row alone", () =>
    Effect.gen(function* () {
      for (const [status, patch, outcome] of [
        ["FINISHED", {}, { stage: "done", operationId: "proc-del", outcome: "succeeded" }],
        [
          "FAILED",
          { failReason: "projectHasRunningProcesses" },
          {
            stage: "done",
            operationId: "proc-del",
            outcome: "failed",
            reason: "projectHasRunningProcesses",
          },
        ],
        [
          "CANCELED",
          {},
          {
            stage: "done",
            operationId: "proc-del",
            outcome: "failed",
            reason: "The Zerops deletion process failed or was canceled.",
          },
        ],
      ] as const) {
        const store = account();
        const { operations, calls } = operationsOf(store, async () => ({ processId: "proc-del" }));
        yield* operations.submit(DELETE);
        expect(calls).toEqual(["delete p1"]);
        expect(progress(store)).toEqual({ stage: "accepted", operationId: "proc-del" });
        processRow(store, "proc-del", "RUNNING", 1);
        expect(progress(store)).toEqual({ stage: "reflected", operationId: "proc-del" });
        yield* TestClock.adjust("2 hours");
        expect(progress(store).stage).toBe("reflected");
        processRow(store, "proc-del", status, 2, patch);
        expect(progress(store)).toEqual(outcome);
      }
    }),
  );

  it.effect("succeeds on its project's proven deletion when its process's end went unseen", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, async () => ({ processId: "proc-del" }));
      yield* operations.submit(DELETE);
      processRow(store, "proc-del", "RUNNING", 1);
      // The process ends while the account is away; the project then leaves the roster, proven gone.
      store.dispatch({
        kind: "proven-deletion",
        family: "project",
        id: "p1",
        evidence: "GET /project/p1 answered 404",
      });
      expect(progress(store)).toEqual({
        stage: "done",
        operationId: "proc-del",
        outcome: "succeeded",
      });
    }),
  );

  it.effect("adopts after a lost answer only its project's delete process, never sent again", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = operationsOf(store, () =>
        Promise.reject(new ZeropsApiError("No answer.", "network")),
      );
      yield* operations.submit(DELETE);
      processRow(store, "proc-deploy", "RUNNING", 1, { actionName: "stack.deploy" });
      yield* operations.retry("r1");
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      processRow(store, "proc-del", "RUNNING", 1);
      yield* operations.retry("r1");
      expect(progress(store)).toEqual({ stage: "reflected", operationId: "proc-del" });
      expect(calls).toEqual(["delete p1"]);
    }),
  );

  it.effect(
    "a deletion its admission refused before sending stays refused, never maybe-landed",
    () =>
      Effect.gen(function* () {
        const store = account();
        const { operations } = operationsOf(store, () =>
          Promise.reject(
            new ZeropsWriteNotSent({ message: "Project access could not be verified." }),
          ),
        );
        yield* operations.submit(DELETE);
        expect(progress(store)).toEqual({
          stage: "refused",
          reason: "Project access could not be verified.",
        });
      }),
  );

  it.effect("a refusal says what Zerops said", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, () =>
        Promise.reject(new ZeropsApiError("Project not found.", "not-found", 404)),
      );
      yield* operations.submit(DELETE);
      expect(progress(store)).toEqual({ stage: "refused", reason: "Project not found." });
    }),
  );

  it("holds its project's process history until it ends", () => {
    const receipt = {
      handles: ["proc-del"],
      outcome: { kind: "pending" },
    } as unknown as OperationReceipt;
    expect(deleteProject.observedIn!(DELETE, receipt)).toEqual({
      family: "process",
      listing: "history",
      ownerId: "p1",
    });
  });
});
