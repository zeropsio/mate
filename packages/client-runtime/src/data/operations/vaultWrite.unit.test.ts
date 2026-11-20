import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError } from "../../zerops/errors.ts";
import type { IntentOf } from "./kind.ts";
import { vaultWriteExecutor, type VaultPlatform } from "./executors/vaultWrites.ts";

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

function operationsOf(
  store: AccountStore,
  answer: () => Promise<{ processId: string | undefined }>,
) {
  const calls: Array<readonly [string, ...unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return answer();
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

// witness: packages/client-runtime/src/data/operations/executors/vaultWrites.ts | platform.updateServiceVariable(write.id, body) → platform.updateProjectVariable(write.id, body)
it.effect("OP23: Each secret write goes to its own vault with its sensitivity always said", () =>
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

// witness: packages/client-runtime/src/data/operations/executors/vaultWrites.ts | fault.message.includes(value) → fault.message === value
it.effect("OP24: A refusal that echoes a secret's value says none of it", () =>
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
