import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import type { IntentOf } from "./kind.ts";
import {
  serviceRestartExecutor,
  vaultWriteExecutor,
  type VaultPlatform,
} from "./executors/vaultWrites.ts";

const SHARED = { kind: "shared" } as const;
const APP = { kind: "service", serviceId: "s1" } as const;
const SECRET = "sk_live_do_not_echo";

const intent = (
  scope: IntentOf<"vault-write">["scope"],
  write: IntentOf<"vault-write">["write"],
): IntentOf<"vault-write"> => ({ kind: "vault-write", orgId: ORG, projectId: "p1", scope, write });

const ADD_SHARED = intent(SHARED, {
  kind: "add",
  key: "STRIPE_KEY",
  value: SECRET,
  sensitive: true,
});
const ADD_APP = intent(APP, { kind: "add", key: "LOG_LEVEL", value: "debug", sensitive: false });

const account = () =>
  accountOf(liveZerops({ running: [], services: [{ id: "s1", projectId: "p1" }] }));

const processRow = (
  store: AccountStore,
  id: string,
  status: string,
  actionName: string,
  serviceStackIds: ReadonlyArray<string>,
  version = 1,
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
        value: processValue({ id, projectId: "p1", status, actionName, serviceStackIds }),
        revision: zeropsVersion(version),
      },
    ],
  });

function operationsOf(store: AccountStore, answer: () => Promise<{ processId?: string }>) {
  const calls: Array<readonly [string, ...unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return answer() as Promise<{ readonly processId: string | undefined }>;
    };
  const platform: VaultPlatform = {
    addProjectVariable: record("addProjectVariable"),
    updateProjectVariable: record("updateProjectVariable"),
    removeProjectVariable: record("removeProjectVariable"),
    addServiceVariable: record("addServiceVariable"),
    updateServiceVariable: record("updateServiceVariable"),
    removeServiceVariable: record("removeServiceVariable"),
  };
  return { operations: zeropsOperations(store, vaultWriteExecutor(platform)), calls };
}

describe("vault-write", () => {
  it.effect("sends each write to its vault, its sensitivity always said", () =>
    Effect.gen(function* () {
      for (const [write, call] of [
        [
          ADD_SHARED,
          ["addProjectVariable", "p1", { key: "STRIPE_KEY", content: SECRET, sensitive: true }],
        ],
        [
          intent(SHARED, {
            kind: "update",
            id: "e1",
            key: "LOG_LEVEL",
            value: "warn",
            sensitive: false,
          }),
          ["updateProjectVariable", "e1", { key: "LOG_LEVEL", content: "warn", sensitive: false }],
        ],
        [
          intent(SHARED, { kind: "remove", id: "e1", key: "LOG_LEVEL" }),
          ["removeProjectVariable", "e1"],
        ],
        [
          ADD_APP,
          ["addServiceVariable", "s1", { key: "LOG_LEVEL", content: "debug", sensitive: false }],
        ],
        [
          intent(APP, { kind: "update", id: "u1", key: "TOKEN", value: "t", sensitive: true }),
          ["updateServiceVariable", "u1", { key: "TOKEN", content: "t", sensitive: true }],
        ],
        [intent(APP, { kind: "remove", id: "u1", key: "TOKEN" }), ["removeServiceVariable", "u1"]],
      ] as const) {
        const { operations, calls } = operationsOf(account(), async () => ({ processId: "proc" }));
        yield* operations.submit(write);
        expect(calls).toEqual([call]);
      }
    }),
  );

  it.effect("is followed by its process to that process's end", () =>
    Effect.gen(function* () {
      for (const [status, expected] of [
        ["FINISHED", { stage: "done", operationId: "proc-env", outcome: "succeeded" }],
        [
          "FAILED",
          {
            stage: "done",
            operationId: "proc-env",
            outcome: "failed",
            reason: "Saving STRIPE_KEY ended FAILED.",
          },
        ],
      ] as const) {
        const store = account();
        const { operations } = operationsOf(store, async () => ({ processId: "proc-env" }));
        yield* operations.submit(ADD_SHARED);
        expect(progressOf(store)).toEqual({ stage: "accepted", operationId: "proc-env" });
        processRow(store, "proc-env", "RUNNING", "stack.updateProjectEnvs", []);
        expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "proc-env" });
        processRow(store, "proc-env", status, "stack.updateProjectEnvs", [], 2);
        expect(progressOf(store)).toEqual(expected);
      }
    }),
  );

  it.effect.each([
    {
      name: "Shared: the project's variables write, never a service's",
      write: ADD_SHARED,
      other: ["stack.updateUserData", ["s1"]],
      own: ["stack.updateProjectEnvs", []],
    },
    {
      name: "a service: its own variables write, never another's or the project's",
      write: ADD_APP,
      other: ["stack.updateUserData", ["s2"]],
      own: ["stack.updateUserData", ["s1"]],
    },
  ] as const)(
    "adopts after a lost answer only its own vault's write — $name",
    ({ write, other, own }) =>
      Effect.gen(function* () {
        const store = account();
        const { operations, calls } = operationsOf(store, () =>
          Promise.reject(new ZeropsApiError("No answer.", "network")),
        );
        yield* operations.submit(write);
        processRow(store, "proc-other", "RUNNING", other[0], other[1]);
        processRow(store, "proc-project", "RUNNING", "stack.restart", ["s1"]);
        yield* operations.retry("r1");
        expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
        processRow(store, "proc-own", "RUNNING", own[0], own[1]);
        yield* operations.retry("r1");
        expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "proc-own" });
        expect(calls).toHaveLength(1);
      }),
  );

  it.effect.each([
    {
      name: "a key Shared holds",
      write: ADD_SHARED,
      code: "projectEnvDuplicateKey",
      reason: "STRIPE_KEY is already in Shared.",
    },
    {
      name: "a key the service holds",
      write: ADD_APP,
      code: "userDataDuplicateKey",
      reason: "LOG_LEVEL is already in this service, as a value or in its zerops.yml.",
    },
    {
      name: "a key Zerops does not take",
      write: ADD_SHARED,
      code: "projectEnvKeyInvalid",
      reason: "STRIPE_KEY is not a name Zerops takes: letters, digits and underscores.",
    },
  ])("a refusal names $name and keeps its code", ({ write, code, reason }) =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, () =>
        Promise.reject(new ZeropsApiError("Bad.", "invalid-input", 400, code, "Bad.")),
      );
      yield* operations.submit(write);
      expect(progressOf(store)).toEqual({ stage: "refused", reason, code });
    }),
  );

  it.effect("a refusal echoing the value says none of it", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, () =>
        Promise.reject(
          new ZeropsApiError(
            "Bad.",
            "invalid-input",
            400,
            "contentInvalid",
            `content ${SECRET} is invalid`,
          ),
        ),
      );
      yield* operations.submit(ADD_SHARED);
      expect(progressOf(store)).toEqual({
        stage: "refused",
        reason: "Zerops did not take STRIPE_KEY.",
        code: "contentInvalid",
      });
    }),
  );
});

describe("service-restart", () => {
  const RESTART = {
    kind: "service-restart",
    orgId: ORG,
    projectId: "p1",
    serviceId: "s1",
  } as const;

  function restartsOf(store: AccountStore, answer: () => Promise<{ processId?: string }>) {
    const calls: string[] = [];
    const submit = serviceRestartExecutor({
      restartService: (serviceId) => {
        calls.push(serviceId);
        return answer() as Promise<{ readonly processId: string | undefined }>;
      },
    });
    return { operations: zeropsOperations(store, submit), calls };
  }

  it.effect("is followed by its restart process to that process's end", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = restartsOf(store, async () => ({ processId: "proc-restart" }));
      yield* operations.submit(RESTART);
      processRow(store, "proc-restart", "RUNNING", "stack.restart", ["s1"]);
      expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "proc-restart" });
      processRow(store, "proc-restart", "FAILED", "stack.restart", ["s1"], 2);
      expect(progressOf(store)).toEqual({
        stage: "done",
        operationId: "proc-restart",
        outcome: "failed",
        reason: "The restart ended FAILED.",
      });
    }),
  );

  it.effect("adopts after a lost answer only a restart running for its service", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = restartsOf(store, () =>
        Promise.reject(new ZeropsApiError("No answer.", "network")),
      );
      yield* operations.submit(RESTART);
      processRow(store, "proc-other", "RUNNING", "stack.restart", ["s2"]);
      processRow(store, "proc-start", "RUNNING", "stack.start", ["s1"]);
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      processRow(store, "proc-restart", "RUNNING", "stack.restart", ["s1"]);
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "reflected", operationId: "proc-restart" });
      expect(calls).toEqual(["s1"]);
    }),
  );
});
