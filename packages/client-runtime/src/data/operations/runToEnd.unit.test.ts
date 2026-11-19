import { expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import { makeAccountStore, type AccountStore } from "../store.ts";
import { ZeropsApiError, ZeropsWriteNotSent } from "../../zerops/api.ts";
import { makeOperations, type OperationExecutor } from "./coordinator.ts";
import { runToEnd } from "./runToEnd.ts";
import { verb } from "./executors/write.ts";

const CREATE = { kind: "create-project", orgId: ORG, name: "shop", tagList: [] } as const;

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
    operationId: "p9",
    executor: "zerops" as const,
    affected: [],
    handles: ["p9"],
    acceptance: { kind: "accepted" as const, result: { projectId: "p9" } },
    outcome: { kind: "pending" as const },
  });

const failedCreation = (store: AccountStore) =>
  store.dispatch({
    kind: "rows",
    scope: runningScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id: "proc-create",
        value: processValue({
          id: "proc-create",
          projectId: "p9",
          status: "FAILED",
          actionName: "project.create",
          error: { code: "x", message: "Creation failed after acceptance." },
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
  expect(await rejection(remote.run(CREATE, { orgId: ORG, unobserved: "" }))).toMatchObject({
    message: "No room.",
    synchronousRefusal: true,
  });
  const local = setUp(() =>
    verb(() => Promise.reject(new ZeropsWriteNotSent(refused)), { targetWrite: true }),
  );
  expect(await rejection(local.run(CREATE, { orgId: ORG, unobserved: "" }))).toMatchObject({
    synchronousRefusal: false,
  });
  const process = setUp(accepted);
  const ran = process.run(CREATE, { orgId: ORG, unobserved: "" });
  failedCreation(process.store);
  expect(await rejection(ran)).toMatchObject({ synchronousRefusal: false });
});
