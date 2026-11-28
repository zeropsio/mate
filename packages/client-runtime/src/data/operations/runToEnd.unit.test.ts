import { expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import { makeAccountStore, type AccountStore } from "../store.ts";
import { ZeropsApiError, ZeropsWriteNotSent } from "../../zerops/errors.ts";
import { makeOperations, type OperationExecutor } from "./coordinator.ts";
import { runToEnd } from "./runToEnd.ts";
import { verb } from "./executors/write.ts";

const DELETE = {
  kind: "delete-service",
  orgId: ORG,
  projectId: "p9",
  serviceId: "db-id",
} as const;

function setUp(submit: OperationExecutor["submit"]) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [] }).forEach(store.dispatch);
  let next = 0;
  const operations = makeOperations({
    store,
    executors: { zerops: { submit } },
    makeId: () => `r${(next += 1)}`,
  });
  return { store, run: runToEnd({ operations, store, registry }) };
}

const accepted = (requestId: string) =>
  Effect.succeed({
    requestId,
    operationId: "proc-delete",
    executor: "zerops" as const,
    affected: [],
    handles: ["proc-delete"],
    acceptance: { kind: "accepted" as const },
    outcome: { kind: "pending" as const },
  });

const failedDeletion = (store: AccountStore) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id: "proc-delete",
        value: processValue({
          id: "proc-delete",
          projectId: "p9",
          status: "FAILED",
          actionName: "stack.delete",
          error: { code: "x", message: "Deletion failed after acceptance." },
        }),
        revision: zeropsVersion(2),
      },
    ],
  });

const rejection = (run: Promise<unknown>) =>
  run.then(
    () => {
      throw new Error("The operation unexpectedly succeeded.");
    },
    (cause: unknown) => cause,
  );

// witness: packages/client-runtime/src/data/operations/runToEnd.ts | acceptance.synchronousRefusal === true → acceptance.kind === "refused"
it("OP6: Only a synchronous refusal of the target write proves that Zerops refused it", async () => {
  const refused = new ZeropsApiError("No room.", "invalid-input", 400);
  const remote = setUp(() => verb(() => Promise.reject(refused), { targetWrite: true }));
  expect(await rejection(remote.run(DELETE, { orgId: ORG, unobserved: "" }))).toMatchObject({
    message: "No room.",
    synchronousRefusal: true,
  });
  const local = setUp(() =>
    verb(() => Promise.reject(new ZeropsWriteNotSent(refused)), { targetWrite: true }),
  );
  expect(await rejection(local.run(DELETE, { orgId: ORG, unobserved: "" }))).toMatchObject({
    synchronousRefusal: false,
  });
  const process = setUp(accepted);
  const ran = process.run(DELETE, { orgId: ORG, unobserved: "" });
  failedDeletion(process.store);
  expect(await rejection(ran)).toMatchObject({ synchronousRefusal: false });
});
