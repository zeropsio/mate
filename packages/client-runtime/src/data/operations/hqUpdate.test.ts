import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import { operationResult } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import { makeOperations } from "./coordinator.ts";
import { hqUpdateExecutor } from "./executors/hqUpdate.ts";

const UPDATE = {
  kind: "hq-update",
  orgId: ORG,
  projectId: "hq-project",
  serviceId: "hq-svc",
  running: "20261003T080500Z.ba9876543210",
  carried: "20261004T100000Z.0123456789ab",
} as const;
const CORE = {
  build: "20261004T100000Z.0123456789ab",
  archive: new Uint8Array(new ArrayBuffer(3)),
  zeropsYaml: "zerops: []",
};

function account() {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  return store;
}

const deployRow = (
  store: AccountStore,
  status: string,
  version: number,
  name: string | null = `hq-core.${CORE.build}`,
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
        id: "proc-build",
        value: processValue({
          id: "proc-build",
          projectId: "hq-project",
          serviceStackIds: ["hq-svc"],
          status,
          actionName: "stack.build",
          ...(name === null ? {} : { appVersion: { id: "v1", name } }),
        }),
        revision: zeropsVersion(version),
      },
    ],
  });

function operationsOf(
  store: AccountStore,
  failAt?: { readonly step: string; readonly error: Error; readonly before?: () => void },
) {
  const calls: string[] = [];
  const step = <A>(name: string, answer: A) => {
    calls.push(name);
    if (failAt?.step === name) {
      failAt.before?.();
      return Promise.reject(failAt.error);
    }
    return Promise.resolve(answer);
  };
  const submit = hqUpdateExecutor({
    core: async () => CORE,
    createAppVersion: (serviceId, name) => step(`version ${serviceId} ${name}`, { id: "v1" }),
    uploadAppVersionArchive: (id, archive) => step(`upload ${id} ${archive.byteLength}`, undefined),
    buildAndDeployAppVersion: (id, input) =>
      step(`deploy ${id} ${input.setup} ${input.zeropsYaml}`, { processId: "proc-build" }),
  });
  const operations = makeOperations({
    store,
    executors: {
      zerops: {
        submit: (requestId, intent) =>
          intent.kind === "hq-update" ? submit(requestId, intent) : Effect.die("no"),
      },
    },
    makeId: () => "r1",
  });
  return { operations, calls };
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");

describe("hq-update", () => {
  it.effect("deploys the carried Core to HQ's service, and its build's process ends it", () =>
    Effect.gen(function* () {
      for (const [status, outcome] of [
        ["FINISHED", { stage: "done", operationId: "proc-build", outcome: "succeeded" }],
        [
          "FAILED",
          {
            stage: "done",
            operationId: "proc-build",
            outcome: "failed",
            reason: "HQ's update failed. HQ still runs 20261003T080500Z.ba9876543210.",
          },
        ],
      ] as const) {
        const store = account();
        const { operations, calls } = operationsOf(store);
        yield* operations.submit(UPDATE);
        expect(calls).toEqual([
          "version hq-svc hq-core.20261004T100000Z.0123456789ab",
          "upload v1 3",
          "deploy v1 hq zerops: []",
        ]);
        expect(progress(store)).toEqual({ stage: "accepted", operationId: "proc-build" });
        expect(operationResult(store.state().operations.get("r1"), "hq-update")).toEqual({
          processId: "proc-build",
        });
        deployRow(store, "RUNNING", 1);
        expect(progress(store)).toEqual({ stage: "reflected", operationId: "proc-build" });
        deployRow(store, status, 2);
        expect(progress(store)).toEqual(outcome);
      }
    }),
  );

  it.effect("names a Core it cannot name as its Core where HQ's failed update says it", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store);
      yield* operations.submit({ ...UPDATE, running: "" });
      deployRow(store, "CANCELED", 2);
      expect(progress(store)).toMatchObject({
        reason: "HQ's update canceled. HQ still runs its Core.",
      });
    }),
  );

  it.effect("says a person without full access to HQ what Zerops refused", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, {
        step: "version hq-svc hq-core.20261004T100000Z.0123456789ab",
        error: new ZeropsApiError("Forbidden.", "forbidden", 403),
      });
      yield* operations.submit(UPDATE);
      expect(progress(store)).toEqual({
        stage: "refused",
        reason: "Zerops refused: you need full access to Headquarters. Ask an organization owner.",
      });
    }),
  );

  it.effect("a lost answer adopts the build of HQ's service that began meanwhile", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = operationsOf(store, {
        step: "deploy v1 hq zerops: []",
        error: new ZeropsApiError("No answer.", "uncertain"),
        // Zerops started the build, though its answer was lost.
        before: () => {
          store.dispatch({
            kind: "membership",
            scope: runningScope(ORG),
            generation: 1,
            delta: { add: ["proc-build"], remove: [] },
          });
          deployRow(store, "RUNNING", 1);
        },
      });
      yield* operations.submit(UPDATE);
      expect(calls).toHaveLength(3);
      expect(progress(store)).toEqual({ stage: "reflected", operationId: "proc-build" });
      expect(operationResult(store.state().operations.get("r1"), "hq-update")).toEqual({
        processId: "proc-build",
      });
      deployRow(store, "FINISHED", 2);
      expect(progress(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
    }),
  );

  it.effect("a lost answer never adopts an unnamed build or a different Core", () =>
    Effect.gen(function* () {
      for (const name of [null, `hq-core.${UPDATE.running}`, "unrelated-build"]) {
        const store = account();
        const { operations, calls } = operationsOf(store, {
          step: "deploy v1 hq zerops: []",
          error: new ZeropsApiError("No answer.", "uncertain"),
          before: () => {
            store.dispatch({
              kind: "membership",
              scope: runningScope(ORG),
              generation: 1,
              delta: { add: ["proc-build"], remove: [] },
            });
            deployRow(store, "RUNNING", 1, name);
          },
        });
        yield* operations.submit(UPDATE);
        expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
        yield* operations.retry("r1");
        expect(calls).toHaveLength(3);
        expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      }
    }),
  );

  it.effect("refuses a changed Core before making an app version", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = operationsOf(store);
      yield* operations.submit({ ...UPDATE, carried: UPDATE.running });
      expect(progress(store)).toEqual({
        stage: "refused",
        reason:
          "This app's Core changed since the update was reviewed. Reopen Update HQ to review it.",
      });
      expect(calls).toEqual([]);
    }),
  );
});
