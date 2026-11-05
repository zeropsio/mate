import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import { linkKeys } from "../model.ts";
import { makeAccountStore, type AccountStore } from "../store.ts";
import { ZeropsApiError, ZeropsTargetWriteRefused, ZeropsWriteNotSent } from "../../zerops/api.ts";
import { isUncertainZeropsFailure } from "../../zerops/errors.ts";
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

const creation = (store: AccountStore, status: string, message?: string) =>
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
          status,
          actionName: "project.create",
          ...(message === undefined ? {} : { error: { code: "x", message } }),
        }),
        revision: zeropsVersion(2),
      },
    ],
  });

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (cause) {
    return { message: (cause as Error).message, uncertain: isUncertainZeropsFailure(cause) };
  }
  throw new Error("It did not stop.");
};

describe("runToEnd", () => {
  it.each([401, 429])("a sent create or import answered %s remains uncertain", async (status) => {
    const reply = new ZeropsApiError(
      "The target did not give a definitive answer.",
      "invalid-input",
      status,
    );
    const create = await Effect.runPromise(
      Effect.result(verb(() => Promise.reject(reply), { targetWrite: true })),
    );
    const imported = await Effect.runPromise(
      Effect.result(verb(() => Promise.reject(new ZeropsTargetWriteRefused(reply)))),
    );
    expect(create).toMatchObject({ failure: { outcome: "uncertain-acceptance" } });
    expect(imported).toMatchObject({ failure: { outcome: "uncertain-acceptance" } });
  });

  it("a failure before the target write is sent retains that proof", async () => {
    const local = setUp(() =>
      verb(() => Promise.reject(new ZeropsWriteNotSent(new Error("Key unavailable.")))),
    );
    await expect(local.run(CREATE, { orgId: ORG, unobserved: "" })).rejects.toMatchObject({
      message: "Key unavailable.",
      writeNotSent: true,
    });
    const remote = setUp(() =>
      verb(() => Promise.reject(new ZeropsApiError("No room.", "invalid-input", 400)), {
        targetWrite: true,
      }),
    );
    await expect(remote.run(CREATE, { orgId: ORG, unobserved: "" })).rejects.toMatchObject({
      writeNotSent: false,
    });
    const process = setUp(accepted);
    const ran = process.run(CREATE, { orgId: ORG, unobserved: "" });
    creation(process.store, "FAILED", "Failed after acceptance.");
    await expect(ran).rejects.toMatchObject({ writeNotSent: false });
  });

  it("only a synchronous refusal of the target write proves it was refused by Zerops", async () => {
    const refused = new ZeropsApiError("No room.", "invalid-input", 400);
    const remote = setUp(() => verb(() => Promise.reject(refused), { targetWrite: true }));
    await expect(remote.run(CREATE, { orgId: ORG, unobserved: "" })).rejects.toMatchObject({
      message: "No room.",
      synchronousRefusal: true,
    });
    const local = setUp(() =>
      verb(() => Promise.reject(new ZeropsWriteNotSent(refused)), { targetWrite: true }),
    );
    await expect(local.run(CREATE, { orgId: ORG, unobserved: "" })).rejects.toMatchObject({
      synchronousRefusal: false,
    });
    const process = setUp(accepted);
    const ran = process.run(CREATE, { orgId: ORG, unobserved: "" });
    creation(process.store, "FAILED", "Creation failed after acceptance.");
    await expect(ran).rejects.toMatchObject({ synchronousRefusal: false });
  });

  it("resolves with the operation's result once its owner's facts end it", async () => {
    const { store, run } = setUp(accepted);
    const ran = run(CREATE, { orgId: ORG, unobserved: "Not followed." });
    creation(store, "FINISHED");
    expect(await ran).toEqual({ projectId: "p9" });
  });

  it("tells the step what its owner accepted before it waits for the end", async () => {
    const { store, run } = setUp(accepted);
    const seen: unknown[] = [];
    let told: () => void = () => {};
    const tellingDone = new Promise<void>((resolve) => (told = resolve));
    const ran = run(CREATE, {
      orgId: ORG,
      unobserved: "Not followed.",
      accepted: (result) => {
        seen.push(result);
        told();
      },
    });
    await tellingDone;
    expect(seen).toEqual([{ projectId: "p9" }]);
    creation(store, "FAILED", "The name is taken.");
    await expect(ran).rejects.toThrow("The name is taken.");
    expect(seen).toEqual([{ projectId: "p9" }]);
  });

  it("records it under the id its caller names", async () => {
    const { store, run } = setUp(accepted);
    const ran = run(CREATE, { orgId: ORG, unobserved: "", requestId: "birth-1:project" });
    creation(store, "FINISHED");
    await ran;
    expect(store.state().operations.has("birth-1:project")).toBe(true);
  });

  it("stops with what ended it otherwise, uncertain only where it may have landed", async () => {
    const cases: ReadonlyArray<
      readonly [string, OperationExecutor["submit"], (store: AccountStore) => void, unknown]
    > = [
      [
        "failed by its facts",
        accepted,
        (store) => creation(store, "FAILED", "The name is taken."),
        { message: "The name is taken.", uncertain: false },
      ],
      [
        "refused",
        () => Effect.fail({ outcome: "definitive-refusal", message: "Not yours." }),
        () => {},
        { message: "Not yours.", uncertain: false },
      ],
      [
        "not taken",
        () => Effect.fail({ outcome: "transient", message: "HTTP 503" }),
        () => {},
        { message: "HTTP 503", uncertain: false },
      ],
      [
        "answer lost",
        () => Effect.fail({ outcome: "uncertain-acceptance", message: "It may have landed." }),
        () => {},
        { message: "It may have landed.", uncertain: true },
      ],
      [
        "no longer followed",
        accepted,
        (store) =>
          store.dispatch({
            kind: "stream",
            key: linkKeys.zerops(ORG),
            now: 0,
            event: { kind: "demand", demanded: false },
          }),
        { message: "Not followed.", uncertain: true },
      ],
    ];
    for (const [, submit, then, stopped] of cases) {
      const { store, run } = setUp(submit);
      const ran = run(CREATE, { orgId: ORG, unobserved: "Not followed." });
      then(store);
      expect(await failure(ran)).toEqual(stopped);
    }
  });

  it("a refusal stops with its owner's own code", async () => {
    const { run } = setUp(() =>
      Effect.fail({ outcome: "definitive-refusal", message: "Decided already.", code: "conflict" }),
    );
    await expect(run(CREATE, { orgId: ORG, unobserved: "" })).rejects.toMatchObject({
      message: "Decided already.",
      code: "conflict",
    });
  });

  it("an uncertain stop is the client's own uncertain failure", async () => {
    const { run } = setUp(() =>
      Effect.fail({ outcome: "uncertain-acceptance", message: "It may have landed." }),
    );
    await expect(run(CREATE, { orgId: ORG, unobserved: "" })).rejects.toBeInstanceOf(
      ZeropsApiError,
    );
  });
});
