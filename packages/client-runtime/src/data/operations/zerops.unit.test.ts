import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { AtomRegistry } from "effect/reactivity";
import { ZeropsApiClient } from "../../zerops/api.ts";
import { liveProjects } from "../__fixtures__/account.ts";
import { makeAccountStore, type AccountStore } from "../store.ts";
import { makeZeropsExecutor } from "./executors/zerops.ts";

function executorFor(
  client: ZeropsApiClient,
  store: AccountStore,
  registry: AtomRegistry.AtomRegistry,
  active: () => boolean,
) {
  return makeZeropsExecutor({
    client,
    hqApiOf: () => null,
    store,
    registry,
    active,
    viewerOf: () => ({ id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" }),
    readDetail: async () => false,
    demandDetail: () => () => undefined,
    revalidate: () => undefined,
    nowMs: () => 0,
    run: () => Promise.reject(new Error("No nested operation.")),
    makeId: () => "nested",
  });
}

// witness: packages/client-runtime/src/data/operations/executors/zerops.ts | source.writeProject(project, record, check) → source.writeProject(project, record)
it.effect(
  "OP22: A queued Zerops write rechecks the account's access after its source read: a closed account or a denied project writes nothing",
  () =>
    Effect.gen(function* () {
      const renameAfter = (change: "closed" | "denied" | "allowed") =>
        Effect.gen(function* () {
          const registry = AtomRegistry.make();
          const store = makeAccountStore(registry);
          for (const input of liveProjects("org", [{ id: "p", name: "Before" }]))
            store.dispatch(input);
          let active = true;
          const writes: string[] = [];
          let name = "Before";
          const client = new ZeropsApiClient({
            baseUrl: "https://api.example.test",
            fetch: async (_url, init) => {
              if (init?.method === "PUT") {
                writes.push("rename");
                name = "After";
              } else {
                if (change === "closed") active = false;
                if (change === "denied")
                  store.dispatch({ kind: "access", family: "project", id: "p", access: "denied" });
              }
              return new Response(
                JSON.stringify({ id: "p", clientId: "org", name, status: "ACTIVE", tagList: [] }),
                { status: 200 },
              );
            },
          });
          const executor = executorFor(client, store, registry, () => active);
          const result = yield* Effect.result(
            executor.submit("rename", {
              kind: "rename-project",
              orgId: "org",
              projectId: "p",
              from: "Before",
              name: "After",
            }),
          );
          if (Result.isFailure(result)) expect(result.failure.outcome).toBe("definitive-refusal");
          registry.dispose();
          return { accepted: Result.isSuccess(result), writes };
        });
      expect(yield* renameAfter("closed")).toEqual({ accepted: false, writes: [] });
      expect(yield* renameAfter("denied")).toEqual({ accepted: false, writes: [] });
      expect(yield* renameAfter("allowed")).toEqual({ accepted: true, writes: ["rename"] });
    }),
);
