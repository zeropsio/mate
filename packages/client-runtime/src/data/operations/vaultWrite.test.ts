import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { runningScope } from "../families/process.ts";
import { projectVariablesScope, type VariableRow } from "../families/projectVariables.ts";
import { serviceVariablesScope } from "../families/serviceVariables.ts";
import type { ScopeKey } from "../model.ts";
import type { AccountInput, Row } from "../reducer.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/api.ts";
import type { IntentOf } from "./kind.ts";
import { vaultWrite } from "./vaultWrite.ts";
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

const T = (hour: number) => `2026-10-07T${String(hour).padStart(2, "0")}:00:00Z`;

/** A variable row as the vault families keep it. */
const variable = (
  id: string,
  key: string,
  value: string | null,
  patch: Partial<VariableRow> = {},
): VariableRow => ({
  id,
  key,
  type: "USER",
  editable: true,
  sensitive: false,
  value,
  created: T(8),
  lastUpdate: T(8),
  ...patch,
});

const HELD_SHARED = [variable("e1", "LOG_LEVEL", "info")];
const HELD_APP = [variable("u1", "TOKEN", "t1")];

const stream = (key: string, event: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event }) as AccountInput;

/** The project's vault as its two listings show it now: each a baseline, as a frame lists it. */
function vaultShows(
  store: AccountStore,
  shown: {
    readonly shared?: ReadonlyArray<VariableRow>;
    readonly services?: ReadonlyArray<VariableRow>;
    readonly sharedComplete?: boolean;
  },
  first = false,
) {
  const listings: Array<readonly [ScopeKey, ReadonlyArray<Row>]> = [];
  if (shown.shared !== undefined)
    listings.push([
      projectVariablesScope(ORG, "p1"),
      [
        {
          family: "projectVariables",
          id: "p1",
          value: { rows: shown.shared, complete: shown.sharedComplete ?? true },
          revision: { kind: "zerops", version: null },
        },
      ],
    ]);
  if (shown.services !== undefined)
    listings.push([
      serviceVariablesScope(ORG, "p1"),
      shown.services.map(({ id, ...row }) => ({
        family: "serviceVariable",
        id,
        value: { ...row, serviceId: "s1" },
        revision: { kind: "zerops", version: null },
      })),
    ]);
  for (const [scope, rows] of listings) {
    if (first)
      for (const event of [
        { kind: "demand", demanded: true },
        { kind: "attempt" },
        { kind: "handshake" },
      ])
        store.dispatch(stream(scope, event));
    store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
    store.dispatch({
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-realtime",
      members: rows.map((row) => row.id),
      rows,
    });
    if (first) store.dispatch(stream(scope, { kind: "baseline-committed" }));
  }
}

/** The account with the project's vault observed: Shared holds LOG_LEVEL, the service TOKEN. */
const vaultAccount = () => {
  const store = account();
  vaultShows(store, { shared: HELD_SHARED, services: HELD_APP }, true);
  return store;
};

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

  it.effect.each([
    {
      name: "Shared, once its value shows",
      write: ADD_SHARED,
      action: "stack.updateProjectEnvs",
      shown: () => ({ shared: [variable("e9", "STRIPE_KEY", null, { sensitive: true })] }),
    },
    {
      name: "a service, once its value shows",
      write: ADD_APP,
      action: "stack.updateUserData",
      shown: () => ({ services: [variable("u9", "LOG_LEVEL", "debug")] }),
    },
  ])(
    "is done when its process finished and the vault shows it — $name",
    ({ write, action, shown }) =>
      Effect.gen(function* () {
        const store = vaultAccount();
        const { operations } = operationsOf(store, async () => ({ processId: "proc-env" }));
        yield* operations.submit(write);
        expect(progressOf(store)).toEqual({ stage: "accepted", operationId: "proc-env" });
        processRow(
          store,
          "proc-env",
          "FINISHED",
          action,
          write.scope.kind === "shared" ? [] : ["s1"],
        );
        // The process ended; the vault still shows what was there before.
        expect(progressOf(store)).toEqual({ stage: "accepted", operationId: "proc-env" });
        vaultShows(store, shown());
        expect(progressOf(store)).toEqual({
          stage: "done",
          operationId: "proc-env",
          outcome: "succeeded",
        });
      }),
  );

  it.effect("ends with its process where the vault is no longer observed", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations } = operationsOf(store, async () => ({ processId: "proc-env" }));
      yield* operations.submit(ADD_SHARED);
      processRow(store, "proc-env", "FINISHED", "stack.updateProjectEnvs", []);
      expect(progressOf(store)).toEqual({
        stage: "done",
        operationId: "proc-env",
        outcome: "succeeded",
      });
    }),
  );

  it.effect("fails as its process failed", () =>
    Effect.gen(function* () {
      const store = vaultAccount();
      const { operations } = operationsOf(store, async () => ({ processId: "proc-env" }));
      yield* operations.submit(ADD_SHARED);
      processRow(store, "proc-env", "FAILED", "stack.updateProjectEnvs", []);
      expect(progressOf(store)).toEqual({
        stage: "done",
        operationId: "proc-env",
        outcome: "failed",
        reason: "Saving STRIPE_KEY ended FAILED.",
      });
    }),
  );

  it.effect.each([
    {
      name: "an added key now in its vault",
      write: ADD_SHARED,
      shown: { shared: [...HELD_SHARED, variable("e9", "stripe_key", null, { sensitive: true })] },
    },
    {
      name: "a removed row gone",
      write: intent(SHARED, { kind: "remove", id: "e1", key: "LOG_LEVEL" }),
      shown: { shared: [] },
    },
    {
      name: "a plain update's value",
      write: intent(APP, { kind: "update", id: "u1", key: "TOKEN", value: "t2", sensitive: false }),
      shown: { services: [variable("u1", "TOKEN", "t2", { lastUpdate: T(12) })] },
    },
    {
      name: "a sensitive update's row written since",
      write: intent(APP, {
        kind: "update",
        id: "u1",
        key: "TOKEN",
        value: SECRET,
        sensitive: true,
      }),
      shown: { services: [variable("u1", "TOKEN", null, { sensitive: true, lastUpdate: T(12) })] },
    },
  ])(
    "after a lost answer, adopts nothing another writer runs and is done once the vault shows $name",
    ({ write, shown }) =>
      Effect.gen(function* () {
        const store = vaultAccount();
        const { operations, calls } = operationsOf(store, () =>
          Promise.reject(new ZeropsApiError("No answer.", "network")),
        );
        yield* operations.submit(write);
        // Its own process already finished; zcp's variables write runs meanwhile.
        processRow(store, "proc-own", "FINISHED", "stack.updateUserData", ["s1"]);
        processRow(store, "proc-zcp", "RUNNING", "stack.updateProjectEnvs", []);
        processRow(store, "proc-zcp2", "RUNNING", "stack.updateUserData", ["s1"]);
        yield* operations.retry("r1");
        expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
        vaultShows(store, shown);
        yield* operations.retry("r1");
        expect(progressOf(store)).toMatchObject({ stage: "done", outcome: "succeeded" });
        expect(calls).toHaveLength(1);
      }),
  );

  it.effect.each([
    { name: "known-complete", succeeds: true },
    { name: "known-incomplete", succeeds: false },
    { name: "unknown", succeeds: false },
    { name: "withheld", succeeds: false },
    { name: "deleted", succeeds: false },
  ])("Shared removal needs complete known contents — $name", ({ name, succeeds }) =>
    Effect.gen(function* () {
      const store = vaultAccount();
      const { operations, calls } = operationsOf(store, () =>
        Promise.reject(new ZeropsApiError("No answer.", "network")),
      );
      const write = intent(SHARED, { kind: "remove", id: "e1", key: "LOG_LEVEL" });
      yield* operations.submit(write);
      const scope = projectVariablesScope(ORG, "p1");
      if (name === "known-complete" || name === "known-incomplete") {
        vaultShows(store, { shared: [], sharedComplete: succeeds });
      } else if (name === "unknown") {
        store.dispatch({ kind: "forget", scopes: [scope] });
        store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
        store.dispatch({
          kind: "baseline-commit",
          scope,
          generation: 1,
          via: "zerops-realtime",
          members: ["p1"],
          rows: [],
        });
      } else if (name === "withheld") {
        store.dispatch({ kind: "access", family: "projectVariables", id: "p1", access: "denied" });
      } else {
        store.dispatch({
          kind: "proven-deletion",
          family: "projectVariables",
          id: "p1",
          evidence: "owner",
        });
      }
      const read = readsOfState(store.state());
      expect(read.fact("projectVariables", "p1").kind).toBe(
        name.startsWith("known") ? "known" : name,
      );
      expect(vaultWrite.effectHandles?.(read, write)).toEqual(succeeds ? ["vault:gone:e1"] : []);
      yield* operations.retry("r1");
      expect(progressOf(store)).toMatchObject(
        succeeds
          ? { stage: "done", outcome: "succeeded" }
          : { stage: "uncertain", next: "ask-owner-again" },
      );
      expect(calls).toHaveLength(1);
    }),
  );

  it.effect.each([
    { name: "complete absence", succeeds: true },
    { name: "partial listing", succeeds: false },
    { name: "unknown listed row", succeeds: false },
    { name: "withheld listed row", succeeds: false },
    { name: "owner-deleted target", succeeds: true },
  ])("service removal needs owner evidence — $name", ({ name, succeeds }) =>
    Effect.gen(function* () {
      const store = vaultAccount();
      const { operations, calls } = operationsOf(store, () =>
        Promise.reject(new ZeropsApiError("No answer.", "network")),
      );
      const write = intent(APP, { kind: "remove", id: "u1", key: "TOKEN" });
      yield* operations.submit(write);
      const scope = serviceVariablesScope(ORG, "p1");
      if (name === "complete absence") {
        vaultShows(store, { services: [] });
      } else if (name === "withheld listed row") {
        store.dispatch({ kind: "access", family: "serviceVariable", id: "u1", access: "denied" });
      } else if (name === "owner-deleted target") {
        store.dispatch({
          kind: "proven-deletion",
          family: "serviceVariable",
          id: "u1",
          evidence: "owner",
        });
      } else {
        store.dispatch({ kind: "forget", scopes: [scope] });
        if (name === "partial listing") {
          store.dispatch({
            kind: "delivery",
            via: "zerops-realtime",
            scopes: [{ scope, generation: 1 }],
            reset: false,
            partial: true,
            rows: [],
            removals: [],
          });
        } else {
          store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
          store.dispatch({
            kind: "baseline-commit",
            scope,
            generation: 1,
            via: "zerops-realtime",
            members: ["u1"],
            rows: [],
          });
        }
      }
      expect(vaultWrite.effectHandles?.(readsOfState(store.state()), write)).toEqual(
        succeeds ? ["vault:gone:u1"] : [],
      );
      yield* operations.retry("r1");
      expect(progressOf(store)).toMatchObject(
        succeeds
          ? { stage: "done", outcome: "succeeded" }
          : { stage: "uncertain", next: "ask-owner-again" },
      );
      expect(calls).toHaveLength(1);
    }),
  );

  it.effect("after a lost answer, never adopts a key its vault held before the send", () =>
    Effect.gen(function* () {
      const store = vaultAccount();
      const { operations } = operationsOf(store, () =>
        Promise.reject(new ZeropsApiError("No answer.", "network")),
      );
      yield* operations.submit(
        intent(SHARED, { kind: "add", key: "log_level", value: "x", sensitive: false }),
      );
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
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
